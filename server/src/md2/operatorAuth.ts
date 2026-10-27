import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';

import type { AuthenticatedDirectorPrincipal, DirectorAuthenticator } from './director.js';
import { redactMd2Text } from './sanitize.js';
import { enforce, Md2SecurityError } from './securityLedger.js';
import type { StorageScope } from './storage.js';
import { validId } from './storageSchema.js';

/**
 * Server-side operator identity (Phase 03C-03). No route, login page or agent is installed here.
 * Identity, roles, permissions and scopes come only from the protected operator file; a client
 * presents nothing but an opaque session token. Nothing in this module writes to logs.
 */

export type OperatorRole = 'ceo' | 'reviewer' | 'operator';
export type OperatorPermission =
  'director.submit' | 'director.read' | 'queue.read' | 'queue.operate' | 'approval.decide';

/** The most a role may ever grant. An operator only gets what the file lists explicitly. */
export const ROLE_PERMISSIONS: Readonly<Record<OperatorRole, readonly OperatorPermission[]>> =
  Object.freeze({
    ceo: ['director.submit', 'director.read', 'queue.read'],
    operator: ['queue.read', 'queue.operate'],
    reviewer: ['approval.decide', 'queue.read', 'director.read'],
  });

export interface OperatorCredential {
  algorithm: 'scrypt';
  N: number;
  r: number;
  p: number;
  salt: string;
  hash: string;
}
export interface OperatorDefinition {
  subjectId: string;
  roles: readonly OperatorRole[];
  permissions: readonly OperatorPermission[];
  scopes: readonly StorageScope[];
  credential: OperatorCredential;
}
export interface OperatorConfig {
  version: 1;
  operators: readonly OperatorDefinition[];
}
export interface OperatorPrincipal {
  subjectId: string;
  roles: readonly OperatorRole[];
  permissions: readonly OperatorPermission[];
  scopes: readonly StorageScope[];
  /** The earlier of the absolute and idle expirations at validation time. */
  expiresAt: number;
}
export interface IssuedSession {
  /** Secret bearer value. Return it to the operator once; never log or persist it. */
  token: string;
  absoluteExpiresAt: number;
}

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;
const ROLES: readonly OperatorRole[] = ['ceo', 'reviewer', 'operator'];
const PERMISSIONS: readonly OperatorPermission[] = [
  'director.submit',
  'director.read',
  'queue.read',
  'queue.operate',
  'approval.decide',
];
const KEY_LENGTH = 32;
const MIN_SECRET_LENGTH = 12;
const DIGEST = /^[a-f0-9]{64}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}
function sameScope(a: StorageScope, b: StorageScope): boolean {
  return a.clientId === b.clientId && a.projectId === b.projectId;
}
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
function maxmem(N: number, r: number): number {
  return 128 * N * r * 2;
}

function validCredential(value: unknown): value is OperatorCredential {
  if (!object(value) || !exactKeys(value, ['algorithm', 'N', 'r', 'p', 'salt', 'hash']))
    return false;
  const { N, r, p, salt, hash } = value;
  return (
    value.algorithm === 'scrypt' &&
    Number.isSafeInteger(N) &&
    (N as number) >= 16384 &&
    (N as number) <= 131072 &&
    ((N as number) & ((N as number) - 1)) === 0 &&
    r === 8 &&
    p === 1 &&
    typeof salt === 'string' &&
    BASE64.test(salt) &&
    Buffer.from(salt, 'base64').length >= 16 &&
    typeof hash === 'string' &&
    BASE64.test(hash) &&
    Buffer.from(hash, 'base64').length === KEY_LENGTH
  );
}

/** Strict validation. Any unknown field, role, permission or out-of-role grant rejects the file. */
export function validateOperatorConfig(value: unknown): OperatorConfig {
  enforce(
    object(value) &&
      exactKeys(value, ['version', 'operators']) &&
      value.version === 1 &&
      Array.isArray(value.operators) &&
      value.operators.length > 0 &&
      value.operators.length <= 50,
    'OPERATOR_CONFIG_INVALID',
  );
  const seen = new Set<string>();
  const operators = (value.operators as unknown[]).map((entry) => {
    enforce(
      object(entry) &&
        exactKeys(entry, ['subjectId', 'roles', 'permissions', 'scopes', 'credential']) &&
        validId(entry.subjectId) &&
        redactMd2Text(entry.subjectId) === entry.subjectId &&
        !seen.has(entry.subjectId) &&
        Array.isArray(entry.roles) &&
        entry.roles.length > 0 &&
        new Set(entry.roles).size === entry.roles.length &&
        entry.roles.every((role) => ROLES.includes(role)) &&
        Array.isArray(entry.permissions) &&
        new Set(entry.permissions).size === entry.permissions.length &&
        entry.permissions.every((permission) => PERMISSIONS.includes(permission)) &&
        Array.isArray(entry.scopes) &&
        entry.scopes.length > 0 &&
        entry.scopes.every(
          (scope) =>
            object(scope) &&
            exactKeys(scope, ['clientId', 'projectId']) &&
            validId(scope.clientId) &&
            validId(scope.projectId),
        ) &&
        validCredential(entry.credential),
      'OPERATOR_CONFIG_INVALID',
    );
    const roles = entry.roles as OperatorRole[];
    const permissions = entry.permissions as OperatorPermission[];
    // Escalation guard: a permission must be allowed by at least one of the operator's roles.
    enforce(
      permissions.every((permission) =>
        roles.some((role) => ROLE_PERMISSIONS[role].includes(permission)),
      ),
      'OPERATOR_PERMISSION_EXCEEDS_ROLE',
    );
    seen.add(entry.subjectId as string);
    const credential = entry.credential as OperatorCredential;
    return Object.freeze({
      subjectId: entry.subjectId as string,
      roles: Object.freeze([...roles]),
      permissions: Object.freeze([...permissions]),
      scopes: Object.freeze(
        (entry.scopes as StorageScope[]).map((scope) =>
          Object.freeze({ clientId: scope.clientId, projectId: scope.projectId }),
        ),
      ),
      credential: Object.freeze({ ...credential }),
    });
  });
  return Object.freeze({ version: 1, operators: Object.freeze(operators) });
}

/** Produces a credential entry for the operator file. The secret itself is never stored. */
export async function hashOperatorSecret(secret: string, N = 32768): Promise<OperatorCredential> {
  enforce(
    typeof secret === 'string' && secret.length >= MIN_SECRET_LENGTH && secret.length <= 1024,
    'OPERATOR_SECRET_TOO_WEAK',
  );
  const salt = randomBytes(16);
  const hash = await scrypt(secret, salt, KEY_LENGTH, { N, r: 8, p: 1, maxmem: maxmem(N, 8) });
  const credential = {
    algorithm: 'scrypt' as const,
    N,
    r: 8,
    p: 1,
    salt: salt.toString('base64'),
    hash: hash.toString('base64'),
  };
  enforce(validCredential(credential), 'OPERATOR_CONFIG_INVALID');
  return credential;
}

async function verifySecret(secret: string, credential: OperatorCredential): Promise<boolean> {
  if (typeof secret !== 'string' || secret.length === 0 || secret.length > 1024) return false;
  const expected = Buffer.from(credential.hash, 'base64');
  const actual = await scrypt(secret, Buffer.from(credential.salt, 'base64'), KEY_LENGTH, {
    N: credential.N,
    r: credential.r,
    p: credential.p,
    maxmem: maxmem(credential.N, credential.r),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export type FileProtectionCheck = (file: string) => void;

const ALLOWED_WINDOWS_SIDS = ['S-1-5-18', 'S-1-5-32-544'];
const WINDOWS_ACL_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$ProgressPreference = 'SilentlyContinue'",
  '$acl = Get-Acl -LiteralPath $env:MD2_OPERATOR_FILE',
  '$sid = [Security.Principal.SecurityIdentifier]',
  "'USER|' + [Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
  "'OWNER|' + (New-Object Security.Principal.NTAccount($acl.Owner)).Translate($sid).Value",
  'foreach ($rule in $acl.Access) {',
  "  'ACE|' + $rule.AccessControlType + '|' + $rule.IdentityReference.Translate($sid).Value",
  '}',
].join('\n');

/**
 * Fails closed unless only the current account (plus SYSTEM and Administrators on Windows)
 * can access the file. On Windows, POSIX mode bits are not trusted: the real ACL is read.
 */
export function defaultFileProtectionCheck(file: string): void {
  const stat = fs.lstatSync(file);
  enforce(stat.isFile() && !stat.isSymbolicLink(), 'OPERATOR_CONFIG_INSECURE');
  if (process.platform !== 'win32') {
    enforce(
      (stat.mode & 0o077) === 0 && (process.getuid === undefined || stat.uid === process.getuid()),
      'OPERATOR_CONFIG_INSECURE',
    );
    return;
  }
  let output: string;
  try {
    // -EncodedCommand: Windows PowerShell 5.1 does not run multi-line blocks read from stdin.
    // The path travels in an environment variable, never inside the script text. The absolute
    // System32 path avoids running another `powershell.exe` found earlier on PATH.
    const systemRoot = process.env['SystemRoot'] ?? 'C:\\Windows';
    output = execFileSync(
      path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        Buffer.from(WINDOWS_ACL_SCRIPT, 'utf16le').toString('base64'),
      ],
      {
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        timeout: 15000,
        // stderr is captured and discarded so diagnostics never reach the server's own logs.
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, MD2_OPERATOR_FILE: file },
      },
    );
  } catch {
    throw new Md2SecurityError('OPERATOR_CONFIG_ACL_UNVERIFIED');
  }
  const lines = output.split(/\r?\n/).filter(Boolean);
  const user = lines.find((line) => line.startsWith('USER|'))?.slice(5);
  const owner = lines.find((line) => line.startsWith('OWNER|'))?.slice(6);
  const aces = lines.filter((line) => line.startsWith('ACE|')).map((line) => line.split('|'));
  enforce(user && /^S-1-[0-9-]+$/.test(user) && aces.length > 0, 'OPERATOR_CONFIG_ACL_UNVERIFIED');
  const allowed = new Set([user, ...ALLOWED_WINDOWS_SIDS]);
  enforce(
    owner !== undefined &&
      allowed.has(owner) &&
      aces.every(([, type, sid]) => type === 'Deny' || (type === 'Allow' && allowed.has(sid))),
    'OPERATOR_CONFIG_INSECURE',
  );
}

/** Reads the operator file only after its protection is verified. Errors never echo contents. */
export function loadOperatorConfig(
  file: string,
  check: FileProtectionCheck = defaultFileProtectionCheck,
): OperatorConfig {
  try {
    check(file);
  } catch (error) {
    if (error instanceof Md2SecurityError) throw error;
    throw new Md2SecurityError('OPERATOR_CONFIG_INSECURE');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Md2SecurityError('OPERATOR_CONFIG_INVALID');
  }
  return validateOperatorConfig(parsed);
}

interface SessionRecord {
  subjectId: string;
  credentialHash: string;
  createdAt: number;
  lastUsedAt: number;
  absoluteExpiresAt: number;
  /** Digest-bound, single-use approval grants created by a recent re-authentication. */
  approvalGrants: Map<string, number>;
}
interface FailureRecord {
  count: number;
  firstAt: number;
  lockedUntil: number;
}
export interface OperatorAuthOptions {
  absoluteTtlMs?: number;
  idleTtlMs?: number;
  reauthTtlMs?: number;
  maxSessionsPerOperator?: number;
  maxFailures?: number;
  lockoutMs?: number;
  now?: () => number;
}

/** In-memory sessions: only SHA-256 hashes of tokens are kept; a restart revokes every session. */
export class Md2OperatorAuth {
  private config: OperatorConfig;
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly failures = new Map<string, FailureRecord>();
  private readonly absoluteTtlMs: number;
  private readonly idleTtlMs: number;
  private readonly reauthTtlMs: number;
  private readonly maxSessions: number;
  private readonly maxFailures: number;
  private readonly lockoutMs: number;
  private readonly now: () => number;
  private dummy: Promise<OperatorCredential> | undefined;

  constructor(config: OperatorConfig, options: OperatorAuthOptions = {}) {
    this.config = validateOperatorConfig(config);
    this.absoluteTtlMs = options.absoluteTtlMs ?? 8 * 3600000;
    this.idleTtlMs = options.idleTtlMs ?? 30 * 60000;
    this.reauthTtlMs = options.reauthTtlMs ?? 5 * 60000;
    this.maxSessions = options.maxSessionsPerOperator ?? 5;
    this.maxFailures = options.maxFailures ?? 5;
    this.lockoutMs = options.lockoutMs ?? 15 * 60000;
    this.now = options.now ?? Date.now;
    const positive = (value: number, max: number) =>
      Number.isSafeInteger(value) && value > 0 && value <= max;
    enforce(
      positive(this.absoluteTtlMs, 24 * 3600000) &&
        positive(this.idleTtlMs, this.absoluteTtlMs) &&
        positive(this.reauthTtlMs, 15 * 60000) &&
        positive(this.maxSessions, 20) &&
        positive(this.maxFailures, 20) &&
        positive(this.lockoutMs, 24 * 3600000),
      'OPERATOR_AUTH_INVALID_OPTIONS',
    );
  }

  /** Replaces the operator file. Sessions of removed operators or changed credentials stop working. */
  reload(config: OperatorConfig): void {
    this.config = validateOperatorConfig(config);
  }

  reviewerIds(): string[] {
    return this.config.operators
      .filter((operator) => operator.permissions.includes('approval.decide'))
      .map((operator) => operator.subjectId);
  }

  /** Verifies a server-configured secret and issues a new session. No route exposes this yet. */
  async login(subjectId: string, secret: string): Promise<IssuedSession> {
    const operator = await this.verify(subjectId, secret);
    const now = this.now();
    const owned = [...this.sessions.entries()]
      .filter(([, session]) => session.subjectId === operator.subjectId)
      .sort((a, b) => a[1].createdAt - b[1].createdAt);
    for (const [hash] of owned.slice(0, Math.max(0, owned.length - this.maxSessions + 1)))
      this.sessions.delete(hash);
    return this.issue({
      subjectId: operator.subjectId,
      credentialHash: operator.credential.hash,
      createdAt: now,
      lastUsedAt: now,
      absoluteExpiresAt: now + this.absoluteTtlMs,
      approvalGrants: new Map(),
    });
  }

  /** Validates a session token and returns the server-side principal. Deny by default. */
  validate(token: unknown): OperatorPrincipal {
    const { record, operator } = this.lookup(token);
    return {
      subjectId: operator.subjectId,
      roles: [...operator.roles],
      permissions: [...operator.permissions],
      scopes: operator.scopes.map((scope) => ({ ...scope })),
      expiresAt: Math.min(record.absoluteExpiresAt, record.lastUsedAt + this.idleTtlMs),
    };
  }

  /** Requires an explicitly granted permission on the exact client/project scope. */
  authorize(
    token: unknown,
    permission: OperatorPermission,
    scope: StorageScope,
  ): OperatorPrincipal {
    const principal = this.validate(token);
    enforce(principal.permissions.includes(permission), 'OPERATOR_PERMISSION_DENIED');
    enforce(
      object(scope) && principal.scopes.some((granted) => sameScope(granted, scope)),
      'OPERATOR_SCOPE_DENIED',
    );
    return principal;
  }

  /** Issues a new token for the same session and revokes the old one. Expiry is not extended. */
  rotate(token: unknown): IssuedSession {
    const { hash, record } = this.lookup(token);
    this.sessions.delete(hash);
    return this.issue({ ...record, lastUsedAt: this.now(), approvalGrants: new Map() });
  }

  revoke(token: unknown): void {
    if (typeof token === 'string') this.sessions.delete(hashToken(token));
  }

  revokeOperator(subjectId: string): void {
    for (const [hash, session] of this.sessions)
      if (session.subjectId === subjectId) this.sessions.delete(hash);
  }

  revokeAll(): void {
    this.sessions.clear();
  }

  /**
   * Re-authentication for one sensitive approval: the session owner's secret is checked again
   * and a single-use grant bound to the exact action digest is created.
   */
  async reauthenticateForApproval(
    token: unknown,
    secret: string,
    digest: string,
    scope: StorageScope,
  ): Promise<void> {
    enforce(typeof digest === 'string' && DIGEST.test(digest), 'OPERATOR_INVALID_DIGEST');
    const principal = this.authorize(token, 'approval.decide', scope);
    await this.verify(principal.subjectId, secret);
    const { record } = this.lookup(token);
    const now = this.now();
    for (const [key, expiresAt] of record.approvalGrants)
      if (expiresAt <= now) record.approvalGrants.delete(key);
    record.approvalGrants.set(this.grantKey(digest, scope), now + this.reauthTtlMs);
  }

  /** Consumes the grant for this digest and scope. Returns the reviewer identity for Md2Policy. */
  consumeApprovalGrant(
    token: unknown,
    digest: string,
    scope: StorageScope,
  ): { reviewerId: string } {
    enforce(typeof digest === 'string' && DIGEST.test(digest), 'OPERATOR_INVALID_DIGEST');
    const principal = this.authorize(token, 'approval.decide', scope);
    const { record } = this.lookup(token);
    const key = this.grantKey(digest, scope);
    const expiresAt = record.approvalGrants.get(key);
    record.approvalGrants.delete(key);
    enforce(expiresAt !== undefined && this.now() < expiresAt, 'OPERATOR_REAUTH_REQUIRED');
    return { reviewerId: principal.subjectId };
  }

  /**
   * DirectorAuthenticator backed only by the session. The context may carry a `sessionToken`;
   * any other field (subjectId, role, scopes...) is ignored.
   */
  directorAuthenticator(): DirectorAuthenticator {
    return async (context) => {
      if (!object(context) || typeof context.sessionToken !== 'string') return null;
      let principal: OperatorPrincipal;
      try {
        principal = this.validate(context.sessionToken);
      } catch {
        return null;
      }
      if (!principal.roles.includes('ceo')) return null;
      const permissions = principal.permissions.filter(
        (permission): permission is 'director.submit' | 'director.read' =>
          permission === 'director.submit' || permission === 'director.read',
      );
      if (!permissions.length) return null;
      const result: AuthenticatedDirectorPrincipal = {
        subjectId: principal.subjectId,
        role: 'ceo',
        scopes: principal.scopes,
        permissions,
        expiresAt: principal.expiresAt,
      };
      return result;
    };
  }

  private grantKey(digest: string, scope: StorageScope): string {
    return JSON.stringify([digest, scope.clientId, scope.projectId]);
  }

  private issue(record: SessionRecord): IssuedSession {
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(hashToken(token), record);
    return { token, absoluteExpiresAt: record.absoluteExpiresAt };
  }

  private lookup(token: unknown): {
    hash: string;
    record: SessionRecord;
    operator: OperatorDefinition;
  } {
    enforce(
      typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token),
      'OPERATOR_SESSION_INVALID',
    );
    const hash = hashToken(token);
    const record = this.sessions.get(hash);
    enforce(record, 'OPERATOR_SESSION_INVALID');
    const now = this.now();
    const operator = this.config.operators.find((item) => item.subjectId === record.subjectId);
    if (
      now >= record.absoluteExpiresAt ||
      now - record.lastUsedAt >= this.idleTtlMs ||
      !operator ||
      operator.credential.hash !== record.credentialHash
    ) {
      this.sessions.delete(hash);
      throw new Md2SecurityError('OPERATOR_SESSION_INVALID');
    }
    record.lastUsedAt = Math.max(record.lastUsedAt, now);
    return { hash, record, operator };
  }

  private async verify(subjectId: string, secret: string): Promise<OperatorDefinition> {
    const now = this.now();
    const key = typeof subjectId === 'string' ? subjectId.slice(0, 80) : '';
    const failure = this.failures.get(key);
    enforce(!failure || failure.lockedUntil <= now, 'OPERATOR_AUTH_LOCKED');
    const operator = this.config.operators.find((item) => item.subjectId === subjectId);
    // Unknown operators still pay the full key-derivation cost, so timing does not reveal them.
    this.dummy ??= hashOperatorSecret(randomBytes(24).toString('base64'));
    const valid = await verifySecret(secret, operator?.credential ?? (await this.dummy));
    if (operator && valid) {
      this.failures.delete(key);
      return operator;
    }
    if (this.failures.size >= 1000 && !this.failures.has(key)) this.failures.clear();
    const current =
      failure && now - failure.firstAt < this.lockoutMs
        ? failure
        : { count: 0, firstAt: now, lockedUntil: 0 };
    current.count += 1;
    if (current.count >= this.maxFailures) current.lockedUntil = now + this.lockoutMs;
    this.failures.set(key, current);
    throw new Md2SecurityError('OPERATOR_AUTH_FAILED');
  }
}
