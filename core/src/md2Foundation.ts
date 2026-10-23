/** Planning metadata only: declaring a role never starts an AI process. */
export const MD2_DEPARTMENTS = [
  { id: 'commercial', name: 'Comercial e Vendas', positions: 4, icon: '◈' },
  { id: 'marketing', name: 'Marketing', positions: 3, icon: '▥' },
  { id: 'operations', name: 'Operações', positions: 3, icon: '▤' },
  { id: 'strategy', name: 'Diretoria e Estratégia', positions: 2, icon: '◇' },
  { id: 'finance', name: 'Financeiro', positions: 2, icon: '▣' },
  { id: 'technology', name: 'Tecnologia', positions: 4, icon: '⌘' },
  { id: 'support', name: 'Atendimento', positions: 2, icon: '☏' },
] as const;

export const MD2_PROGRAMMER = {
  id: 'codex-programmer',
  name: 'Programador Codex',
  departmentId: 'technology',
  provider: 'codex',
} as const;
