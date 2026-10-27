import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { inspect } from 'node:util';

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Md2Director } from '../src/md2/director.js';
import {
  defaultFileProtectionCheck,
  hashOperatorSecret,
  loadOperatorConfig,
  Md2OperatorAuth,
  type OperatorConfig,
  type OperatorCredential,
  validateOperatorConfig,
} from '../src/md2/operatorAuth.js';
import { Md2Policy } from '../src/md2/policy.js';
import { Md2Storage } from '../src/md2/storage.js';

const A = { clientId: 'client-a', projectId: 'project-a' };
const B = { clientId: 'client-b', projectId: 'project-b' };
const SECRETS = {
  ceo: 'ceo-secret-for-tests-only',
  reviewer: 'reviewer-secret-for-tests-only',
  operator: 'operator-secret-for-tests-only',
};
const DIGEST = 'a'.repeat(64);
const OTHER_DIGEST = 'b'.repeat(64);
const zero = { maxAttempts: 0, maxTokens: 0, maxCostMicros: 0 };

let credentials: Record<keyof typeof SECRETS, OperatorCredential>;
function config(overrides: Partial<Record<'ceo' | 'reviewer' | 'operator', object>> = {}) {
  return {
    version: 1,
    operators: [
      {
        subjectId: 'daniel-ceo',
        roles: ['ceo'],
        permissions: ['director.submit', 'director.read', 'queue.read'],
        scopes: [A],
        credential: credentials.ceo,
        ...overrides.ceo,
      },
      {
        subjectId: 'rita-reviewer',
        roles: ['reviewer'],
        permissions: ['approval.decide', 'queue.read'],
        scopes: [A],
        credential: credentials.reviewer,
        ...overrides.reviewer,
      },
      {
        // The operator role would allow queue.operate, but the file does not grant it.
        subjectId: 'otto-operator',
        roles: ['operator'],
        permissions: ['queue.read'],
        scopes: [B],
        credential: credentials.operator,
        ...overrides.operator,
      },
    ],
  } as unknown as OperatorConfig;
}

describe('MD2 operator authentication (server-side sessions, no routes)', () => {
  let t: number;
  let auth: Md2OperatorAuth;
  beforeAll(async () => {
    credentials = {
      ceo: await hashOperatorSecret(SECRETS.ceo, 16384),
      reviewer: await hashOperatorSecret(SECRETS.reviewer, 16384),
      operator: await hashOperatorSecret(SECRETS.operator, 16384),
    };
  });
  beforeEach(() => {
    t = 1_000_000;
    auth = new Md2OperatorAuth(config(), { now: () => t });
  });
  afterEach(() => vi.restoreAllMocks());

  it('issues random sessions, keeps only their hashes and returns the configured principal', async () => {
    const first = await auth.login('daniel-ceo', SECRETS.ceo);
    const second = await auth.login('daniel-ceo', SECRETS.ceo);
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.token).not.toBe(second.token);
    expect(auth.validate(first.token)).toEqual({
      subjectId: 'daniel-ceo',
      roles: ['ceo'],
      permissions: ['director.submit', 'director.read', 'queue.read'],
      scopes: [A],
      expiresAt: t + 30 * 60000,
    });
    const dump = inspect(auth, { depth: 10 });
    expect(dump).not.toContain(first.token);
    expect(dump).not.toContain(SECRETS.ceo);
  });

  it('rejects wrong secrets and unknown operators alike, then locks out', async () => {
    await expect(auth.login('daniel-ceo', 'wrong-secret-value')).rejects.toMatchObject({
      code: 'OPERATOR_AUTH_FAILED',
    });
    await expect(auth.login('nobody', SECRETS.ceo)).rejects.toMatchObject({
      code: 'OPERATOR_AUTH_FAILED',
    });
    for (let n = 0; n < 4; n++)
      await expect(auth.login('daniel-ceo', 'wrong-secret-value')).rejects.toThrow();
    await expect(auth.login('daniel-ceo', SECRETS.ceo)).rejects.toMatchObject({
      code: 'OPERATOR_AUTH_LOCKED',
    });
    t += 15 * 60000;
    expect((await auth.login('daniel-ceo', SECRETS.ceo)).token).toBeTruthy();
  });

  it('rejects malformed, unknown and client-invented tokens', async () => {
    for (const token of [undefined, '', 'x', 'Bearer abc', 42, { token: 'x' }, 'A'.repeat(43)])
      expect(() => auth.validate(token)).toThrow(
        expect.objectContaining({ code: 'OPERATOR_SESSION_INVALID' }),
      );
  });

  it('enforces idle and absolute expiration without extending the absolute limit', async () => {
    const idle = await auth.login('daniel-ceo', SECRETS.ceo);
    t += 30 * 60000;
    expect(() => auth.validate(idle.token)).toThrow(
      expect.objectContaining({ code: 'OPERATOR_SESSION_INVALID' }),
    );
    const active = await auth.login('daniel-ceo', SECRETS.ceo);
    for (let elapsed = 0; elapsed < 8 * 3600000 - 20 * 60000; elapsed += 20 * 60000) {
      t += 20 * 60000;
      auth.validate(active.token);
    }
    t = active.absoluteExpiresAt;
    expect(() => auth.validate(active.token)).toThrow(
      expect.objectContaining({ code: 'OPERATOR_SESSION_INVALID' }),
    );
  });

  it('revokes single sessions, an operator, or everything, and rotates safely', async () => {
    const a = await auth.login('daniel-ceo', SECRETS.ceo);
    const b = await auth.login('daniel-ceo', SECRETS.ceo);
    const r = await auth.login('rita-reviewer', SECRETS.reviewer);
    auth.revoke(a.token);
    expect(() => auth.validate(a.token)).toThrow();
    t += 1000;
    const rotated = auth.rotate(b.token);
    expect(rotated.absoluteExpiresAt).toBe(b.absoluteExpiresAt);
    expect(() => auth.validate(b.token)).toThrow();
    expect(auth.validate(rotated.token).subjectId).toBe('daniel-ceo');
    auth.revokeOperator('daniel-ceo');
    expect(() => auth.validate(rotated.token)).toThrow();
    expect(auth.validate(r.token).subjectId).toBe('rita-reviewer');
    auth.revokeAll();
    expect(() => auth.validate(r.token)).toThrow();
  });

  it('caps sessions per operator by evicting the oldest', async () => {
    const tokens: string[] = [];
    for (let n = 0; n < 6; n++) {
      t += 1;
      tokens.push((await auth.login('daniel-ceo', SECRETS.ceo)).token);
    }
    expect(() => auth.validate(tokens[0])).toThrow();
    for (const token of tokens.slice(1)) expect(auth.validate(token).subjectId).toBe('daniel-ceo');
  });

  it('invalidates sessions when an operator is removed or its credential changes', async () => {
    const ceo = await auth.login('daniel-ceo', SECRETS.ceo);
    const reviewer = await auth.login('rita-reviewer', SECRETS.reviewer);
    const replaced = await hashOperatorSecret('a-brand-new-secret-value', 16384);
    auth.reload(config({ ceo: { credential: replaced } }));
    expect(() => auth.validate(ceo.token)).toThrow();
    const current = config();
    auth.reload({ ...current, operators: current.operators.slice(0, 1) } as OperatorConfig);
    expect(() => auth.validate(reviewer.token)).toThrow();
  });

  it('denies by default: ungranted permissions and other client/project scopes', async () => {
    const operator = await auth.login('otto-operator', SECRETS.operator);
    const reviewer = await auth.login('rita-reviewer', SECRETS.reviewer);
    expect(auth.authorize(operator.token, 'queue.read', B).subjectId).toBe('otto-operator');
    expect(() => auth.authorize(operator.token, 'queue.operate', B)).toThrow(
      expect.objectContaining({ code: 'OPERATOR_PERMISSION_DENIED' }),
    );
    expect(() => auth.authorize(operator.token, 'queue.read', A)).toThrow(
      expect.objectContaining({ code: 'OPERATOR_SCOPE_DENIED' }),
    );
    expect(() =>
      auth.authorize(operator.token, 'queue.read', { clientId: B.clientId, projectId: 'other' }),
    ).toThrow(expect.objectContaining({ code: 'OPERATOR_SCOPE_DENIED' }));
    expect(() => auth.authorize(reviewer.token, 'director.submit', A)).toThrow(
      expect.objectContaining({ code: 'OPERATOR_PERMISSION_DENIED' }),
    );
  });

  it('rejects configuration that escalates beyond a role or is malformed', () => {
    expect(() =>
      validateOperatorConfig(config({ operator: { permissions: ['approval.decide'] } })),
    ).toThrow(expect.objectContaining({ code: 'OPERATOR_PERMISSION_EXCEEDS_ROLE' }));
    for (const bad of [
      { roles: ['admin'] },
      { roles: [] },
      { permissions: ['everything'] },
      { scopes: [{ clientId: '*', projectId: '*' }] },
      { scopes: [] },
      { subjectId: 'rita-reviewer' },
      { password: 'plain-text' },
      { credential: { ...credentials.ceo, N: 1024 } },
    ])
      expect(() => validateOperatorConfig(config({ ceo: bad }))).toThrow(
        expect.objectContaining({ code: 'OPERATOR_CONFIG_INVALID' }),
      );
  });

  it('builds director principals only from the validated session', async () => {
    const ceo = await auth.login('daniel-ceo', SECRETS.ceo);
    const reviewer = await auth.login('rita-reviewer', SECRETS.reviewer);
    const authenticate = auth.directorAuthenticator();
    expect(
      await authenticate({
        sessionToken: ceo.token,
        subjectId: 'intruder',
        role: 'ceo',
        scopes: [B],
        permissions: ['director.submit'],
      }),
    ).toEqual({
      subjectId: 'daniel-ceo',
      role: 'ceo',
      scopes: [A],
      permissions: ['director.submit', 'director.read'],
      expiresAt: t + 30 * 60000,
    });
    for (const context of [
      { subjectId: 'daniel-ceo', role: 'ceo', scopes: [A] },
      { sessionToken: reviewer.token },
      { sessionToken: 'A'.repeat(43) },
      null,
      ceo.token,
    ])
      expect(await authenticate(context)).toBeNull();
  });

  it('isolates clients end-to-end through Md2Director', async () => {
    const root = fs.mkdtempSync(path.join(tmpdir(), 'md2-operator-'));
    try {
      const directors: Md2Director[] = [];
      for (const scope of [A, B]) await new Md2Storage({ root, scope }).initialize();
      // Md2Director checks expiry against the real clock, so this test uses it too.
      auth = new Md2OperatorAuth(config());
      directors.length = 0;
      for (const scope of [A, B]) {
        const store = new Md2Storage({ root, scope });
        directors.push(
          new Md2Director(store, {
            scope,
            policy: new Md2Policy(store, { scope }),
            limits: { task: zero, agent: zero, project: zero },
            authenticate: auth.directorAuthenticator(),
          }),
        );
      }
      const ceo = await auth.login('daniel-ceo', SECRETS.ceo);
      const demand = (scope: typeof A, requestId: string) => ({
        requestId,
        scope,
        title: 'Rascunho de código',
        description: 'Preparar uma proposta técnica para revisão.',
        intent: 'technology.code' as const,
      });
      const received = await directors[0].receive(demand(A, 'request-a'), {
        sessionToken: ceo.token,
      });
      expect(received.demand.submittedBy).toBe('daniel-ceo');
      await expect(
        directors[1].receive(demand(B, 'request-b'), { sessionToken: ceo.token }),
      ).rejects.toMatchObject({ code: 'DIRECTOR_SCOPE_NOT_AUTHORIZED' });
      await expect(
        directors[0].receive(demand(A, 'request-forged'), {
          subjectId: 'daniel-ceo',
          role: 'ceo',
          scopes: [A],
          permissions: ['director.submit'],
          expiresAt: Date.now() + 60000,
        }),
      ).rejects.toThrow();
      expect(
        await directors[0]
          .get(received.demand.id, { sessionToken: 'A'.repeat(43) })
          .catch((error: { code?: string }) => error.code),
      ).toBe('DIRECTOR_NOT_AUTHORIZED');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('requires a recent, digest-bound, single-use re-authentication for approvals', async () => {
    const reviewer = await auth.login('rita-reviewer', SECRETS.reviewer);
    const ceo = await auth.login('daniel-ceo', SECRETS.ceo);
    expect(auth.reviewerIds()).toEqual(['rita-reviewer']);
    expect(() => auth.consumeApprovalGrant(reviewer.token, DIGEST, A)).toThrow(
      expect.objectContaining({ code: 'OPERATOR_REAUTH_REQUIRED' }),
    );
    await expect(
      auth.reauthenticateForApproval(reviewer.token, 'wrong-secret-value', DIGEST, A),
    ).rejects.toMatchObject({ code: 'OPERATOR_AUTH_FAILED' });
    await expect(
      auth.reauthenticateForApproval(ceo.token, SECRETS.ceo, DIGEST, A),
    ).rejects.toMatchObject({ code: 'OPERATOR_PERMISSION_DENIED' });
    await expect(
      auth.reauthenticateForApproval(reviewer.token, SECRETS.reviewer, DIGEST, B),
    ).rejects.toMatchObject({ code: 'OPERATOR_SCOPE_DENIED' });
    await expect(
      auth.reauthenticateForApproval(reviewer.token, SECRETS.reviewer, 'not-a-digest', A),
    ).rejects.toMatchObject({ code: 'OPERATOR_INVALID_DIGEST' });

    await auth.reauthenticateForApproval(reviewer.token, SECRETS.reviewer, DIGEST, A);
    expect(() => auth.consumeApprovalGrant(reviewer.token, OTHER_DIGEST, A)).toThrow(
      expect.objectContaining({ code: 'OPERATOR_REAUTH_REQUIRED' }),
    );
    expect(auth.consumeApprovalGrant(reviewer.token, DIGEST, A)).toEqual({
      reviewerId: 'rita-reviewer',
    });
    expect(() => auth.consumeApprovalGrant(reviewer.token, DIGEST, A)).toThrow(
      expect.objectContaining({ code: 'OPERATOR_REAUTH_REQUIRED' }),
    );

    await auth.reauthenticateForApproval(reviewer.token, SECRETS.reviewer, DIGEST, A);
    t += 5 * 60000;
    expect(() => auth.consumeApprovalGrant(reviewer.token, DIGEST, A)).toThrow(
      expect.objectContaining({ code: 'OPERATOR_REAUTH_REQUIRED' }),
    );

    await auth.reauthenticateForApproval(reviewer.token, SECRETS.reviewer, DIGEST, A);
    const rotated = auth.rotate(reviewer.token);
    expect(() => auth.consumeApprovalGrant(rotated.token, DIGEST, A)).toThrow(
      expect.objectContaining({ code: 'OPERATOR_REAUTH_REQUIRED' }),
    );
  });

  it('never writes tokens or secrets to the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    const session = await auth.login('rita-reviewer', SECRETS.reviewer);
    await auth.login('rita-reviewer', 'wrong-secret-value').catch(() => {});
    await auth.reauthenticateForApproval(session.token, SECRETS.reviewer, DIGEST, A);
    auth.consumeApprovalGrant(session.token, DIGEST, A);
    auth.revokeAll();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  describe('operator file protection', () => {
    let dir: string;
    let file: string;
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(tmpdir(), 'md2-operator-file-'));
      file = path.join(dir, 'operators.json');
      fs.writeFileSync(file, JSON.stringify(config()));
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('loads only after the protection check and never echoes file contents', () => {
      expect(loadOperatorConfig(file, () => {}).operators).toHaveLength(3);
      expect(() =>
        loadOperatorConfig(file, () => {
          throw new Error('permissions too open');
        }),
      ).toThrow(expect.objectContaining({ code: 'OPERATOR_CONFIG_INSECURE' }));
      fs.writeFileSync(file, `{"version":1,"operators":[{"password":"${SECRETS.ceo}"`);
      try {
        loadOperatorConfig(file, () => {});
        expect.unreachable();
      } catch (error) {
        expect(error).toMatchObject({ code: 'OPERATOR_CONFIG_INVALID' });
        expect(String((error as Error).message)).not.toContain(SECRETS.ceo);
      }
    });

    it.runIf(process.platform === 'win32')(
      'reads the real Windows ACL and refuses access for other principals',
      () => {
        // Absolute System32 paths: a POSIX `whoami` on PATH (Git Bash) has other flags.
        const system32 = path.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32');
        const icacls = (...args: string[]) =>
          execFileSync(path.join(system32, 'icacls.exe'), [file, ...args]);
        const sid = execFileSync(
          path.join(system32, 'whoami.exe'),
          ['/user', '/fo', 'csv', '/nh'],
          { encoding: 'utf8' },
        )
          .trim()
          .split(',')[1]
          .replace(/"/g, '');
        icacls('/inheritance:r', '/grant:r', `*${sid}:F`, '*S-1-5-18:F');
        expect(() => defaultFileProtectionCheck(file)).not.toThrow();
        expect(loadOperatorConfig(file).operators).toHaveLength(3);
        icacls('/grant', '*S-1-1-0:R');
        expect(() => defaultFileProtectionCheck(file)).toThrow(
          expect.objectContaining({ code: 'OPERATOR_CONFIG_INSECURE' }),
        );
        icacls('/remove:g', '*S-1-1-0', '/grant', '*S-1-5-32-545:R');
        expect(() => defaultFileProtectionCheck(file)).toThrow(
          expect.objectContaining({ code: 'OPERATOR_CONFIG_INSECURE' }),
        );
      },
      30000,
    );

    it.runIf(process.platform !== 'win32')('requires owner-only POSIX permissions', () => {
      fs.chmodSync(file, 0o600);
      expect(() => defaultFileProtectionCheck(file)).not.toThrow();
      fs.chmodSync(file, 0o644);
      expect(() => defaultFileProtectionCheck(file)).toThrow(
        expect.objectContaining({ code: 'OPERATOR_CONFIG_INSECURE' }),
      );
    });

    it('refuses a symbolic link as the operator file', () => {
      const link = path.join(dir, 'link.json');
      try {
        fs.symlinkSync(file, link);
      } catch {
        return; // Creating symlinks may need privileges on Windows.
      }
      expect(() => defaultFileProtectionCheck(link)).toThrow(
        expect.objectContaining({ code: 'OPERATOR_CONFIG_INSECURE' }),
      );
    });
  });
});
