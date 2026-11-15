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

/** Business organization only; the legacy visual departments above stay independent. */
export const MD2_BUSINESS_DEPARTMENTS = [
  { id: 'general-management', name: 'Direção-Geral', agents: 1 },
  { id: 'commercial', name: 'Comercial', agents: 3 },
  { id: 'marketing', name: 'Marketing', agents: 4 },
  { id: MD2_PROGRAMMER.departmentId, name: 'Tecnologia', agents: 4 },
  { id: 'support', name: 'Atendimento', agents: 2 },
  { id: 'finance', name: 'Financeiro', agents: 2 },
  { id: 'operations', name: 'Operações e Projetos', agents: 2 },
  { id: 'production', name: 'Produção e Conteúdo', agents: 2 },
  { id: 'legal', name: 'Jurídico', agents: 1 },
  { id: 'administration', name: 'Administrativo', agents: 1 },
] as const;

export type Md2BusinessDepartmentId = (typeof MD2_BUSINESS_DEPARTMENTS)[number]['id'];

/** Declarative activities over supplied information, never executable tool grants. */
export const MD2_DEPARTMENT_CAPABILITIES = {
  'general-management': ['strategy.plan', 'work.review'],
  commercial: ['leads.analyze', 'proposals.draft'],
  marketing: ['campaigns.plan', 'marketing.analyze'],
  technology: ['software.design', 'code.draft', 'tests.plan'],
  support: ['support.triage', 'replies.draft'],
  finance: ['finance.analyze', 'finance.reports.draft'],
  operations: ['projects.plan', 'deliveries.review'],
  production: ['content.draft', 'content.review'],
  legal: ['legal.review', 'legal.documents.draft'],
  administration: ['records.organize', 'administration.plan'],
} as const satisfies Record<Md2BusinessDepartmentId, readonly string[]>;

export type Md2Capability = (typeof MD2_DEPARTMENT_CAPABILITIES)[Md2BusinessDepartmentId][number];
