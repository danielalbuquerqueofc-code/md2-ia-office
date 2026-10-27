import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { CodexClient, type RpcMessage } from './codexClient.js';
import type { Md2Worker } from './executor.js';
import { redactMd2Text } from './sanitize.js';
import { enforce } from './securityLedger.js';
import {
  WORKER_OUTPUT_MAX_CHARS,
  type WorkerEndReason,
  type WorkerInput,
  type WorkerOutcome,
  type WorkerResult,
} from './worker.js';

/**
 * Codex worker (Phase 03C-05). Read-only sandbox, approvals never granted, MCP servers disabled,
 * one isolated directory per attempt outside the server checkout, and process-tree termination on
 * stop. Constructing it does not start anything; a real run needs separate authorization.
 */
export interface CodexWorkerOptions {
  command: string;
  /** Absolute directory that receives one sub-directory per attempt. Never inside the checkout. */
  workspaceRoot: string;
  /** Directories the workspace must never be inside (default: the server's cwd). */
  protectedRoots?: readonly string[];
  /** Overrides the app-server arguments (tests only). */
  args?: string[];
  requestTimeoutMs?: number;
  /** Operator-configured price; without it cost stays unknown (null). */
  microsPerToken?: number;
}

const DEFAULT_ARGS = [
  'app-server',
  '--listen',
  'stdio://',
  '-c',
  'mcp_servers={}',
  '-c',
  'sandbox_mode="read-only"',
  '-c',
  'approval_policy="never"',
];

function inside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function totalTokens(params: Record<string, unknown> | undefined): number | null {
  const usage = (params?.tokenUsage ?? params?.usage) as Record<string, unknown> | undefined;
  const total = (usage?.total ?? usage) as Record<string, unknown> | undefined;
  const value = total?.totalTokens ?? total?.total_tokens;
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : null;
}

export interface CodexWorker extends Md2Worker {
  run(input: WorkerInput, signal: AbortSignal): Promise<WorkerResult>;
}

export function createCodexWorker(options: CodexWorkerOptions): CodexWorker {
  const root = path.resolve(options.workspaceRoot);
  enforce(path.isAbsolute(options.workspaceRoot), 'CODEX_WORKSPACE_NOT_ABSOLUTE');
  for (const protectedRoot of options.protectedRoots ?? [process.cwd()]) {
    const guarded = path.resolve(protectedRoot);
    enforce(!inside(root, guarded) && !inside(guarded, root), 'CODEX_WORKSPACE_INSIDE_CHECKOUT');
  }
  enforce(
    options.microsPerToken === undefined ||
      (Number.isFinite(options.microsPerToken) && options.microsPerToken >= 0),
    'CODEX_INVALID_PRICING',
  );

  return {
    async run(input: WorkerInput, signal: AbortSignal): Promise<WorkerResult> {
      const result = (
        outcome: WorkerOutcome,
        reason: WorkerEndReason,
        tokens: number | null,
        output = '',
      ): WorkerResult => ({
        workId: input.workId,
        leaseId: input.leaseId,
        attemptId: input.attemptId,
        outcome,
        reason,
        consumption:
          outcome === 'not-started'
            ? { tokens: 0, costMicros: 0 }
            : {
                tokens,
                costMicros:
                  tokens !== null && options.microsPerToken !== undefined
                    ? Math.ceil(tokens * options.microsPerToken)
                    : null,
              },
        output:
          outcome === 'not-started' ? '' : redactMd2Text(output).slice(0, WORKER_OUTPUT_MAX_CHARS),
      });
      if (signal.aborted) return result('not-started', 'NOT_STARTED', 0);

      // One fresh directory per attempt, scoped by client/project.
      const scopeKey = createHash('sha256')
        .update(JSON.stringify([input.scope.clientId, input.scope.projectId]))
        .digest('hex')
        .slice(0, 16);
      const cwd = path.join(root, scopeKey, input.attemptId);
      try {
        fs.mkdirSync(path.dirname(cwd), { recursive: true });
        fs.mkdirSync(cwd); // Fails if it already exists: an attempt never reuses a directory.
        enforce(inside(fs.realpathSync(cwd), fs.realpathSync(root)), 'CODEX_WORKSPACE_ESCAPE');
      } catch {
        return result('not-started', 'NOT_STARTED', 0);
      }

      let turnStarted = false;
      let tokens: number | null = null;
      let output = '';
      let settle: (value: WorkerResult) => void = () => {};
      const done = new Promise<WorkerResult>((resolve) => (settle = resolve));
      const finish = (value: WorkerResult) => settle(value);

      const client = new CodexClient({
        command: options.command,
        args: options.args ?? DEFAULT_ARGS,
        cwd,
        requestTimeoutMs: options.requestTimeoutMs,
        onEvent: (message: RpcMessage) => {
          const params = message.params ?? {};
          if (message.method === 'item/agentMessage/delta' && typeof params.delta === 'string')
            output = (output + params.delta).slice(-WORKER_OUTPUT_MAX_CHARS * 2);
          const item = params.item as Record<string, unknown> | undefined;
          if (
            message.method === 'item/completed' &&
            item?.type === 'agentMessage' &&
            typeof item.text === 'string' &&
            !output
          )
            output = item.text;
          if (message.method.includes('tokenUsage')) {
            const measured = totalTokens(params);
            if (measured !== null) tokens = Math.max(tokens ?? 0, measured);
          }
          if (message.method === 'turn/completed') {
            const status = (params.turn as { status?: string } | undefined)?.status;
            finish(
              status === 'completed'
                ? result('completed', 'COMPLETED', tokens, output)
                : result('failed', 'AGENT_FAILED', tokens, output),
            );
          }
        },
        // No automatic approval: every escalation request is declined.
        onApproval: async (message: RpcMessage) => {
          if (
            message.method.endsWith('/requestApproval') &&
            !message.method.includes('permissions')
          )
            return { decision: 'decline' };
          throw new Error('Pedido não suportado.');
        },
        onExit: () =>
          finish(
            turnStarted
              ? result('unknown', 'PROCESS_EXITED', tokens, output)
              : result('not-started', 'NOT_STARTED', 0),
          ),
      });

      const onAbort = () => {
        const reason = signal.reason as WorkerEndReason | undefined;
        if (!turnStarted) finish(result('not-started', 'NOT_STARTED', 0));
        else if (reason === 'CANCELLED_BY_OPERATOR')
          finish(result('cancelled', 'CANCELLED_BY_OPERATOR', tokens, output));
        else
          finish(
            result('unknown', reason === 'LEASE_LOST' ? 'LEASE_LOST' : 'TIMEOUT', tokens, output),
          );
      };
      signal.addEventListener('abort', onAbort, { once: true });

      try {
        client.start();
        void (async () => {
          try {
            await client.request('initialize', {
              clientInfo: {
                name: 'md2_ia_office_worker',
                title: 'MD2 IA Office',
                version: '0.3.0',
              },
            });
            client.notify('initialized');
            const configuration = await client.request('config/read', { includeLayers: false });
            const disabled = Object.fromEntries(
              Object.keys(configuration.config?.mcp_servers ?? {}).map((name) => [
                name,
                { enabled: false },
              ]),
            );
            const thread = await client.request('thread/start', {
              cwd,
              sandbox: 'read-only',
              approvalPolicy: 'never',
              config: { mcp_servers: disabled },
            });
            enforce(typeof thread.thread?.id === 'string', 'CODEX_INVALID_THREAD');
            if (signal.aborted) return;
            turnStarted = true; // From here a model call may happen: outcomes are no longer "not started".
            await client.request('turn/start', {
              threadId: thread.thread!.id,
              input: [
                {
                  type: 'text',
                  text:
                    `Agente MD2: ${input.agentId} (${input.capability}).\n` +
                    'Responda somente com texto. Não execute comandos, não altere arquivos e não acesse a rede.\n\n' +
                    `Título: ${input.content.title}\n\n${input.content.description}`,
                },
              ],
            });
          } catch {
            finish(
              turnStarted
                ? result('unknown', 'PROCESS_EXITED', tokens, output)
                : result('not-started', 'NOT_STARTED', 0),
            );
          }
        })();
        return await done;
      } finally {
        signal.removeEventListener('abort', onAbort);
        await client.terminate();
      }
    },
  };
}
