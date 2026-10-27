import { describe, expect, it } from 'vitest';

import {
  canTransitionRun,
  validateWorkerResult,
  WORKER_OUTPUT_MAX_CHARS,
  type WorkerInput,
  type WorkerResult,
} from '../src/md2/worker.js';

const input: WorkerInput = {
  workId: 'work-' + 'a'.repeat(40),
  leaseId: 'lease-1',
  attemptId: 'attempt-1',
  ownerId: 'owner-1',
  agentId: 'andre',
  capability: 'code.draft',
  kind: 'internal.draft',
  scope: { clientId: 'client', projectId: 'project' },
  content: { title: 'Título', description: 'Descrição' },
  allocation: { tokens: 10, costMicros: 10 },
  leaseExpiresAt: 2000,
  deadlineAt: 5000,
  authorization: { actionId: 'authorization-1' },
};
function result(overrides: Partial<WorkerResult> = {}): WorkerResult {
  return {
    workId: input.workId,
    leaseId: input.leaseId,
    attemptId: input.attemptId,
    outcome: 'completed',
    reason: 'COMPLETED',
    consumption: { tokens: 5, costMicros: 7 },
    output: 'Resumo pronto.',
    ...overrides,
  };
}

describe('MD2 worker contract (types and validation only)', () => {
  it('accepts a coherent result and returns a detached copy', () => {
    const raw = result();
    const validated = validateWorkerResult(raw, input);
    expect(validated).toEqual(raw);
    expect(validated.consumption).not.toBe(raw.consumption);
  });

  it('keeps unknown consumption as null instead of estimating it', () => {
    expect(
      validateWorkerResult(
        result({
          outcome: 'unknown',
          reason: 'LEASE_LOST',
          consumption: { tokens: null, costMicros: null },
        }),
        input,
      ).consumption,
    ).toEqual({ tokens: null, costMicros: null });
  });

  it('rejects results for another lease, attempt or work item', () => {
    for (const overrides of [
      { leaseId: 'lease-2' },
      { attemptId: 'attempt-2' },
      { workId: 'work-' + 'b'.repeat(40) },
    ])
      expect(() => validateWorkerResult(result(overrides), input)).toThrow(
        expect.objectContaining({ code: 'WORKER_RESULT_MISMATCH' }),
      );
  });

  it('rejects incoherent outcome and reason pairs', () => {
    expect(() =>
      validateWorkerResult(result({ outcome: 'completed', reason: 'TIMEOUT' }), input),
    ).toThrow(expect.objectContaining({ code: 'WORKER_INVALID_OUTCOME' }));
    expect(() =>
      validateWorkerResult(
        result({ outcome: 'retry' as WorkerResult['outcome'], reason: 'COMPLETED' }),
        input,
      ),
    ).toThrow(expect.objectContaining({ code: 'WORKER_INVALID_OUTCOME' }));
  });

  it('requires zero consumption and no output for not-started', () => {
    expect(() =>
      validateWorkerResult(
        result({ outcome: 'not-started', reason: 'NOT_STARTED', output: '' }),
        input,
      ),
    ).toThrow(expect.objectContaining({ code: 'WORKER_INVALID_NOT_STARTED' }));
    expect(
      validateWorkerResult(
        result({
          outcome: 'not-started',
          reason: 'NOT_STARTED',
          output: '',
          consumption: { tokens: 0, costMicros: 0 },
        }),
        input,
      ).outcome,
    ).toBe('not-started');
  });

  it('rejects extra keys, invalid consumption, oversized or sensitive output', () => {
    expect(() => validateWorkerResult({ ...result(), extra: true }, input)).toThrow(
      expect.objectContaining({ code: 'WORKER_INVALID_RESULT' }),
    );
    expect(() =>
      validateWorkerResult(result({ consumption: { tokens: -1, costMicros: 0 } }), input),
    ).toThrow(expect.objectContaining({ code: 'WORKER_INVALID_CONSUMPTION' }));
    expect(() =>
      validateWorkerResult(result({ output: 'x'.repeat(WORKER_OUTPUT_MAX_CHARS + 1) }), input),
    ).toThrow(expect.objectContaining({ code: 'WORKER_INVALID_OUTPUT' }));
    expect(() => validateWorkerResult(result({ output: 'password=example-value' }), input)).toThrow(
      expect.objectContaining({ code: 'WORKER_INVALID_OUTPUT' }),
    );
  });

  it('only allows forward run-state transitions, with settled terminal', () => {
    expect(canTransitionRun('preparing', 'started')).toBe(true);
    expect(canTransitionRun('preparing', 'settled')).toBe(true);
    expect(canTransitionRun('started', 'running')).toBe(true);
    expect(canTransitionRun('running', 'settling')).toBe(true);
    expect(canTransitionRun('settling', 'settled')).toBe(true);
    expect(canTransitionRun('running', 'started')).toBe(false);
    expect(canTransitionRun('started', 'settled')).toBe(false);
    expect(canTransitionRun('settled', 'preparing')).toBe(false);
  });
});
