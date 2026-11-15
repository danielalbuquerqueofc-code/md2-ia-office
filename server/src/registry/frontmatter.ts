/** Parser mínimo de frontmatter YAML (chave: valor, listas inline [a, b] e listas com "- item"). */
export function parseFrontmatter(raw: string): { meta: Record<string, string | string[]>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!m) return { meta: {}, body: raw };
  const meta: Record<string, string | string[]> = {};
  let listKey: string | null = null;
  for (const line of m[1].split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      (meta[listKey] as string[]).push(unquote(item[1]));
      continue;
    }
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, value] = kv;
    if (value === '') {
      meta[key] = [];
      listKey = key;
    } else if (value.startsWith('[') && value.endsWith(']')) {
      meta[key] = value.slice(1, -1).split(',').map((s) => unquote(s.trim())).filter(Boolean);
      listKey = null;
    } else {
      meta[key] = unquote(value);
      listKey = null;
    }
  }
  return { meta, body: raw.slice(m[0].length) };
}
const unquote = (s: string) => s.replace(/^["']|["']$/g, '');
export const asList = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : v ? [v] : []);
export const asText = (v: string | string[] | undefined): string => (Array.isArray(v) ? v.join(', ') : (v ?? ''));
