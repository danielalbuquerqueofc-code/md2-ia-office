import type { StorageChanges, StorageData } from './storageSchema.js';

/** Best-effort redaction, not a substitute for supplying credential-free data. */
export function redactMd2Text(value: string): string {
  return value
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
      '[REDACTED]',
    )
    .replace(/\b(?:Bearer|Basic)\s+[a-zA-Z0-9+/_.=~-]+/gi, '[REDACTED]')
    .replace(
      /\b(?:sk-(?:proj-)?[a-zA-Z0-9_-]{16,}|gh[pousr]_[a-zA-Z0-9]{16,}|github_pat_[a-zA-Z0-9_]{16,}|AKIA[A-Z0-9]{16})\b/g,
      '[REDACTED]',
    )
    .replace(/\b[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(
      /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|token|password|senha|secret|authorization)["']?\s*[=:]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s&,;}]+)/gi,
      '[REDACTED]',
    )
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

/** Existing records on disk are never rewritten by sanitation. Immutable fields stay exact. */
export function sanitizeMd2Changes(changes: StorageChanges, existing: StorageData): StorageChanges {
  const copied = structuredClone(changes);
  if (Array.isArray(copied?.tasks))
    for (const task of copied.tasks) {
      if (!task || typeof task !== 'object') continue;
      if (
        !existing.tasks.some((record) => record.id === task.id) &&
        typeof task.prompt === 'string'
      )
        task.prompt = redactMd2Text(task.prompt);
      if (typeof task.output === 'string') task.output = redactMd2Text(task.output);
    }
  if (Array.isArray(copied?.events))
    for (const event of copied.events) {
      if (event && typeof event.message === 'string') event.message = redactMd2Text(event.message);
    }
  if (Array.isArray(copied?.approvals))
    for (const approval of copied.approvals) {
      if (
        approval &&
        !existing.approvals.some((record) => record.id === approval.id) &&
        typeof approval.summary === 'string'
      )
        approval.summary = redactMd2Text(approval.summary);
    }
  return copied;
}
