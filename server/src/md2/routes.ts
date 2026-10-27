import * as path from 'node:path';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { AgentStateStore } from '../agentStateStore.js';
import { bearerTokenValid, isAllowedWebSocketOrigin, normalizeHostname } from '../wsAuth.js';
import type { DemandIntent, DemandPriority } from './director.js';
import { Md2Office } from './office.js';
import type { Md2Runtime } from './runtime.js';
import { enforce, Md2SecurityError } from './securityLedger.js';

const SESSION_HEADER = 'x-md2-session';

/** Maps security codes to HTTP status without echoing inputs, tokens or secrets. */
function statusFor(code: string): number {
  if (['OPERATOR_SESSION_INVALID', 'OPERATOR_AUTH_FAILED', 'SESSION_REQUIRED'].includes(code))
    return 401;
  if (code === 'OPERATOR_AUTH_LOCKED') return 429;
  if (/DENIED|NOT_AUTHORIZED|SCOPE|REAUTH_REQUIRED/.test(code)) return 403;
  if (/NOT_FOUND/.test(code)) return 404;
  if (/BUSY|CONFLICT|NOT_AVAILABLE|ALREADY|RECONCILIATION_REQUIRED/.test(code)) return 409;
  if (/DISABLED|UNAVAILABLE/.test(code)) return 503;
  return 400;
}
async function guarded<T>(reply: FastifyReply, work: () => Promise<T> | T) {
  try {
    return await work();
  } catch (error) {
    const code =
      error instanceof Md2SecurityError
        ? error.code
        : error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
          ? error.message
          : 'MD2_REQUEST_FAILED';
    return reply.code(code === 'MD2_REQUEST_FAILED' ? 500 : statusFor(code)).send({ error: code });
  }
}
function session(request: FastifyRequest): string {
  const value = request.headers[SESSION_HEADER];
  enforce(typeof value === 'string' && value.length > 0, 'SESSION_REQUIRED');
  return value;
}
const consumptionSchema = {
  type: 'object',
  required: ['tokens', 'costMicros'],
  additionalProperties: false,
  properties: {
    tokens: { type: ['integer', 'null'], minimum: 0 },
    costMicros: { type: ['integer', 'null'], minimum: 0 },
  },
};

export function registerMd2Routes(
  app: FastifyInstance,
  options: {
    token: string;
    store: AgentStateStore;
    allowedHostnames: ReadonlySet<string>;
    office?: Md2Office;
    /**
     * undefined: MD2_EXECUTOR_ENABLED is off (legacy only). null: flag on but the runtime could not
     * be built safely — every executor route answers 503 and the legacy launch stays disabled.
     */
    runtime?: Md2Runtime | null;
  },
): void {
  const office =
    options.office ??
    new Md2Office({
      store: options.store,
      cwd: process.cwd(),
      command:
        process.env['MD2_CODEX_COMMAND'] || (process.platform === 'win32' ? 'codex.exe' : 'codex'),
      ledger: path.join(process.cwd(), '.md2-office', 'tasks.json'),
    });
  const executorMode = options.runtime !== undefined;
  app.addHook('onClose', async () => office.dispose());
  app.register(
    async (scoped) => {
      // onRequest: the server gate runs before body parsing and schema validation.
      scoped.addHook('onRequest', async (request, reply) => {
        if (!bearerTokenValid(request.headers.authorization, options.token))
          return reply.code(401).send({ error: 'Acesso de operador necessário.' });
        const hostname = normalizeHostname(request.headers.host);
        if (
          !hostname ||
          !options.allowedHostnames.has(hostname) ||
          !isAllowedWebSocketOrigin(request.headers.origin, request.headers.host)
        ) {
          return reply.code(403).send({ error: 'Origem não autorizada.' });
        }
      });
      scoped.get('/state', async () => office.snapshot());
      scoped.post<{ Body: { prompt: string } }>(
        '/tasks',
        {
          schema: {
            body: {
              type: 'object',
              required: ['prompt'],
              additionalProperties: false,
              properties: { prompt: { type: 'string', minLength: 1, maxLength: 8000 } },
            },
          },
        },
        async (request, reply) => {
          // With the executor enabled, the queue is the ONLY way to run work (global limit of 1).
          if (executorMode)
            return reply
              .code(409)
              .send({ error: 'Caminho antigo desativado: use a fila MD2 protegida.' });
          const prompt = request.body.prompt.trim();
          if (!prompt) return reply.code(400).send({ error: 'Descreva uma tarefa.' });
          if (office.snapshot().busy)
            return reply.code(409).send({ error: 'O programador já está ocupado.' });
          const task = await office.launch(prompt);
          return reply.code(202).send(task);
        },
      );
      scoped.post<{ Params: { id: string }; Body: { decision: 'accept' | 'decline' } }>(
        '/approvals/:id',
        {
          schema: {
            body: {
              type: 'object',
              required: ['decision'],
              additionalProperties: false,
              properties: { decision: { type: 'string', enum: ['accept', 'decline'] } },
            },
          },
        },
        async (request, reply) =>
          office.decide(request.params.id, request.body.decision)
            ? { ok: true }
            : reply.code(409).send({ error: 'Pedido encerrado ou expirado.' }),
      );
      scoped.post<{ Params: { id: string } }>('/tasks/:id/cancel', async (request, reply) =>
        office.cancel(request.params.id)
          ? { ok: true }
          : reply.code(409).send({ error: 'Tarefa não está em execução.' }),
      );
      if (executorMode) registerExecutorRoutes(scoped, options.runtime ?? null);
    },
    { prefix: '/api/md2' },
  );
}

function registerExecutorRoutes(app: FastifyInstance, runtime: Md2Runtime | null): void {
  const need = (): Md2Runtime => {
    enforce(runtime, 'RUNTIME_UNAVAILABLE');
    return runtime;
  };

  app.post<{ Body: { subjectId: string; secret: string } }>(
    '/operator/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['subjectId', 'secret'],
          additionalProperties: false,
          properties: {
            subjectId: { type: 'string', minLength: 1, maxLength: 80 },
            secret: { type: 'string', minLength: 1, maxLength: 1024 },
          },
        },
      },
    },
    async (request, reply) =>
      guarded(reply, async () => need().auth.login(request.body.subjectId, request.body.secret)),
  );
  app.post('/operator/logout', async (request, reply) =>
    guarded(reply, () => {
      need().auth.revoke(session(request));
      return { ok: true };
    }),
  );
  app.post('/operator/rotate', async (request, reply) =>
    guarded(reply, () => need().auth.rotate(session(request))),
  );
  app.get('/operator/me', async (request, reply) =>
    guarded(reply, () => need().auth.validate(session(request))),
  );

  app.post<{
    Body: {
      requestId: string;
      title: string;
      description: string;
      intent?: DemandIntent;
      urgency?: DemandPriority;
    };
  }>(
    '/demands',
    {
      schema: {
        body: {
          type: 'object',
          required: ['requestId', 'title', 'description'],
          additionalProperties: false,
          properties: {
            requestId: { type: 'string', minLength: 1, maxLength: 80 },
            title: { type: 'string', minLength: 1, maxLength: 200 },
            description: { type: 'string', minLength: 1, maxLength: 6000 },
            intent: { type: 'string', maxLength: 80 },
            urgency: { type: 'string', enum: ['low', 'normal', 'high'] },
          },
        },
      },
    },
    async (request, reply) =>
      guarded(reply, async () => {
        const r = need();
        const result = await r.director.receive(
          { ...request.body, scope: r.scope },
          { sessionToken: session(request) },
        );
        return reply.code(result.duplicate ? 200 : 201).send(result);
      }),
  );

  app.post<{ Body: { demandId: string } }>(
    '/queue',
    {
      schema: {
        body: {
          type: 'object',
          required: ['demandId'],
          additionalProperties: false,
          properties: { demandId: { type: 'string', minLength: 1, maxLength: 120 } },
        },
      },
    },
    async (request, reply) =>
      guarded(reply, async () => {
        const result = await need().queue.enqueue(request.body.demandId, {
          sessionToken: session(request),
        });
        return reply.code(result.duplicate ? 200 : 201).send(result);
      }),
  );
  app.get('/queue-state', async (request, reply) =>
    guarded(reply, async () => {
      const r = need();
      r.auth.authorize(session(request), 'queue.read', r.scope);
      return {
        ...(await r.queue.summary()),
        worker: r.workerMode,
        running: r.run.active !== null,
        lastReport: r.run.last,
        lastError: r.run.lastError,
      };
    }),
  );
  app.get<{ Params: { id: string } }>('/queue/:id', async (request, reply) =>
    guarded(reply, async () => {
      const r = need();
      r.auth.authorize(session(request), 'queue.read', r.scope);
      const item = await r.queue.peek(request.params.id);
      enforce(item, 'QUEUE_ITEM_NOT_FOUND');
      return item;
    }),
  );

  // Human approval bound to the exact action: the request shows the action and its digest.
  app.post<{ Params: { id: string } }>('/queue/:id/approval', async (request, reply) =>
    guarded(reply, async () => {
      const r = need();
      r.auth.authorize(session(request), 'queue.operate', r.scope);
      const action = await r.queue.actionForNextAttempt(request.params.id);
      const approval = await r.policy.requestApproval(action);
      return reply.code(201).send({
        requestId: approval.requestId,
        digest: approval.digest,
        expiresAt: approval.expiresAt,
        action: {
          agentId: action.agentId,
          capability: action.capability,
          kind: action.kind,
          parameters: action.parameters,
        },
      });
    }),
  );
  app.post<{
    Params: { id: string; requestId: string };
    Body: { decision: 'approve' | 'decline'; secret: string };
  }>(
    '/queue/:id/approval/:requestId/decide',
    {
      schema: {
        body: {
          type: 'object',
          required: ['decision', 'secret'],
          additionalProperties: false,
          properties: {
            decision: { type: 'string', enum: ['approve', 'decline'] },
            secret: { type: 'string', minLength: 1, maxLength: 1024 },
          },
        },
      },
    },
    async (request, reply) =>
      guarded(reply, async () => {
        const r = need();
        const token = session(request);
        const { id, requestId } = request.params;
        const action = await r.queue.actionForNextAttempt(id);
        const evaluated = await r.policy.evaluate(action);
        enforce(evaluated.decision === 'approval-required', 'QUEUE_APPROVAL_NOT_REQUIRED');
        // Fresh re-authentication for this exact digest and scope, consumed once.
        await r.auth.reauthenticateForApproval(
          token,
          request.body.secret,
          evaluated.digest,
          r.scope,
        );
        const { reviewerId } = r.auth.consumeApprovalGrant(token, evaluated.digest, r.scope);
        await r.policy.decide(requestId, action, request.body.decision, reviewerId);
        if (request.body.decision === 'decline') return { decision: 'decline' };
        return { decision: 'approve', item: await r.queue.attachApproval(id, requestId) };
      }),
  );

  app.post<{ Body: { wait?: boolean } | null }>('/executor/run-next', async (request, reply) =>
    guarded(reply, async () => {
      const r = need();
      const token = session(request);
      r.auth.authorize(token, 'queue.operate', r.scope);
      enforce(r.executor, 'EXECUTOR_WORKER_DISABLED');
      enforce(r.run.active === null, 'EXECUTOR_BUSY');
      r.run.lastError = null;
      const active = r.executor
        .runNext(token)
        .then((report) => {
          r.run.last = report;
          return report;
        })
        .catch((error: unknown) => {
          r.run.lastError = error instanceof Md2SecurityError ? error.code : 'EXECUTOR_FAILED';
          return null;
        })
        .finally(() => {
          r.run.active = null;
        });
      r.run.active = active;
      if (request.body?.wait === true) {
        const report = await active;
        if (r.run.lastError) throw new Md2SecurityError(r.run.lastError);
        return { report };
      }
      return reply.code(202).send({ started: true });
    }),
  );
  app.post<{ Params: { id: string } }>('/executor/cancel/:id', async (request, reply) =>
    guarded(reply, async () => {
      const r = need();
      enforce(r.executor, 'EXECUTOR_WORKER_DISABLED');
      return { state: await r.executor.cancel(session(request), request.params.id) };
    }),
  );
  app.post('/executor/recover', async (request, reply) =>
    guarded(reply, async () => {
      const r = need();
      enforce(r.executor, 'EXECUTOR_WORKER_DISABLED');
      return r.executor.recover(session(request));
    }),
  );
  app.post<{
    Params: { id: string };
    Body: {
      leaseId: string;
      outcome: 'not-started' | 'completed' | 'failed' | 'cancelled' | 'unknown';
      consumption: { tokens: number | null; costMicros: number | null };
    };
  }>(
    '/executor/reconcile/:id',
    {
      schema: {
        body: {
          type: 'object',
          required: ['leaseId', 'outcome', 'consumption'],
          additionalProperties: false,
          properties: {
            leaseId: { type: 'string', minLength: 1, maxLength: 80 },
            outcome: {
              type: 'string',
              enum: ['not-started', 'completed', 'failed', 'cancelled', 'unknown'],
            },
            consumption: consumptionSchema,
          },
        },
      },
    },
    async (request, reply) =>
      guarded(reply, async () => {
        const r = need();
        enforce(r.executor, 'EXECUTOR_WORKER_DISABLED');
        return r.executor.reconcile(
          session(request),
          request.params.id,
          request.body.leaseId,
          request.body.outcome,
          request.body.consumption,
        );
      }),
  );
}
