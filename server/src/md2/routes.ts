import * as path from 'node:path';

import type { FastifyInstance } from 'fastify';

import type { AgentStateStore } from '../agentStateStore.js';
import { bearerTokenValid, isAllowedWebSocketOrigin, normalizeHostname } from '../wsAuth.js';
import { Md2Office } from './office.js';

export function registerMd2Routes(
  app: FastifyInstance,
  options: {
    token: string;
    store: AgentStateStore;
    allowedHostnames: ReadonlySet<string>;
    office?: Md2Office;
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
  app.addHook('onClose', async () => office.dispose());
  app.register(
    async (scoped) => {
      scoped.addHook('preHandler', async (request, reply) => {
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
    },
    { prefix: '/api/md2' },
  );
}
