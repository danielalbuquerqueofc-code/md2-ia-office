import {
  MD2_BUSINESS_DEPARTMENTS,
  MD2_DEPARTMENT_CAPABILITIES,
  type Md2BusinessDepartmentId,
  type Md2Capability,
} from './md2Foundation.js';

/** An operational identity, independent of a sprite, session, provider or running process. */
export interface Md2BusinessAgent {
  readonly id: string;
  readonly name: string;
  readonly departmentId: Md2BusinessDepartmentId;
  readonly role: string;
  readonly description: string;
  readonly capabilities: readonly Md2Capability[];
  readonly initialState: 'inactive';
}

const fields = [
  'id',
  'name',
  'departmentId',
  'role',
  'description',
  'capabilities',
  'initialState',
];

/** Validate untrusted data and return an immutable copy; registration never launches agents. */
export function validateMd2AgentRegistry(input: unknown): readonly Md2BusinessAgent[] {
  if (!Array.isArray(input) || input.length !== 22)
    throw new Error('O registro MD2 deve conter exatamente 22 agentes.');
  const ids = new Set<string>();
  const names = new Set<string>();
  const counts = new Map<string, number>();
  const agents = input.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Agente MD2 inválido.');
    const agent = value as Record<string, unknown>;
    if (
      Object.keys(agent).length !== fields.length ||
      !fields.every((field) => Object.prototype.hasOwnProperty.call(agent, field))
    )
      throw new Error('Campos de agente MD2 inválidos.');
    for (const field of ['id', 'name', 'departmentId', 'role', 'description']) {
      if (
        typeof agent[field] !== 'string' ||
        !agent[field].trim() ||
        agent[field] !== agent[field].trim()
      )
        throw new Error(`Campo MD2 inválido: ${field}.`);
    }
    const id = agent.id as string;
    const name = agent.name as string;
    const normalizedName = name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id) || ids.has(id) || names.has(normalizedName))
      throw new Error('ID ou nome de agente MD2 inválido ou duplicado.');
    ids.add(id);
    names.add(normalizedName);
    const department = MD2_BUSINESS_DEPARTMENTS.find((item) => item.id === agent.departmentId);
    if (!department) throw new Error('Departamento MD2 desconhecido.');
    const allowed: readonly string[] = MD2_DEPARTMENT_CAPABILITIES[department.id];
    const capabilities = agent.capabilities;
    if (
      !Array.isArray(capabilities) ||
      !capabilities.length ||
      new Set(capabilities).size !== capabilities.length ||
      !capabilities.every(
        (capability: unknown) => typeof capability === 'string' && allowed.includes(capability),
      )
    )
      throw new Error('Capacidades MD2 inválidas para o departamento.');
    if (agent.initialState !== 'inactive') throw new Error('Agente MD2 deve iniciar inativo.');
    counts.set(department.id, (counts.get(department.id) ?? 0) + 1);
    return Object.freeze({
      id,
      name,
      departmentId: department.id,
      role: agent.role as string,
      description: agent.description as string,
      capabilities: Object.freeze([...capabilities]) as readonly Md2Capability[],
      initialState: 'inactive' as const,
    });
  });
  if (
    MD2_BUSINESS_DEPARTMENTS.some((department) => counts.get(department.id) !== department.agents)
  )
    throw new Error('Distribuição de agentes MD2 por departamento inválida.');
  return Object.freeze(agents);
}

function defineAgent(
  id: string,
  name: string,
  departmentId: Md2BusinessDepartmentId,
  role: string,
  description: string,
  capabilities: readonly Md2Capability[],
): Md2BusinessAgent {
  return { id, name, departmentId, role, description, capabilities, initialState: 'inactive' };
}

/** No binding to MD2_PROGRAMMER or visual characters is implied by this business roster. */
export const MD2_AGENT_REGISTRY = validateMd2AgentRegistry([
  defineAgent(
    'carlos',
    'Carlos',
    'general-management',
    'Diretor-geral',
    'Planeja a estratégia e revisa prioridades empresariais.',
    ['strategy.plan', 'work.review'],
  ),
  defineAgent(
    'lucas',
    'Lucas',
    'commercial',
    'Analista de prospecção',
    'Analisa oportunidades a partir de informações fornecidas.',
    ['leads.analyze'],
  ),
  defineAgent(
    'fernanda',
    'Fernanda',
    'commercial',
    'Analista de qualificação',
    'Avalia necessidades e adequação de potenciais clientes.',
    ['leads.analyze'],
  ),
  defineAgent(
    'rafael',
    'Rafael',
    'commercial',
    'Analista de propostas',
    'Elabora minutas de propostas para revisão.',
    ['proposals.draft'],
  ),
  defineAgent(
    'mariana',
    'Mariana',
    'marketing',
    'Estrategista de marketing',
    'Planeja campanhas e posicionamento.',
    ['campaigns.plan'],
  ),
  defineAgent(
    'beatriz',
    'Beatriz',
    'marketing',
    'Analista de marca',
    'Planeja comunicação e consistência de marca.',
    ['campaigns.plan'],
  ),
  defineAgent(
    'gabriel',
    'Gabriel',
    'marketing',
    'Analista de desempenho',
    'Analisa indicadores de marketing fornecidos.',
    ['marketing.analyze'],
  ),
  defineAgent(
    'pedro',
    'Pedro',
    'marketing',
    'Planejador de mídia',
    'Elabora planos de mídia sem publicar campanhas.',
    ['campaigns.plan', 'marketing.analyze'],
  ),
  defineAgent(
    'andre',
    'André',
    'technology',
    'Programador',
    'Elabora propostas de código para revisão.',
    ['code.draft'],
  ),
  defineAgent(
    'camila',
    'Camila',
    'technology',
    'Arquiteta de software',
    'Desenha soluções e contratos técnicos.',
    ['software.design'],
  ),
  defineAgent(
    'diego',
    'Diego',
    'technology',
    'Analista de automação',
    'Desenha fluxos de automação sem conectar serviços.',
    ['software.design', 'code.draft'],
  ),
  defineAgent(
    'sofia',
    'Sofia',
    'technology',
    'Analista de qualidade',
    'Planeja cenários de teste e critérios de aceite.',
    ['tests.plan'],
  ),
  defineAgent(
    'juliana',
    'Juliana',
    'support',
    'Analista de suporte',
    'Classifica solicitações e prepara respostas.',
    ['support.triage', 'replies.draft'],
  ),
  defineAgent(
    'bruno',
    'Bruno',
    'support',
    'Analista de relacionamento',
    'Prepara respostas de acompanhamento e retenção.',
    ['replies.draft'],
  ),
  defineAgent(
    'renata',
    'Renata',
    'finance',
    'Analista financeiro',
    'Analisa informações financeiras fornecidas.',
    ['finance.analyze'],
  ),
  defineAgent(
    'eduardo',
    'Eduardo',
    'finance',
    'Analista de controle financeiro',
    'Elabora relatórios financeiros para revisão.',
    ['finance.reports.draft'],
  ),
  defineAgent(
    'thiago',
    'Thiago',
    'operations',
    'Coordenador de projetos',
    'Planeja atividades, dependências e entregas.',
    ['projects.plan'],
  ),
  defineAgent(
    'amanda',
    'Amanda',
    'operations',
    'Analista de entregas',
    'Revisa entregas segundo critérios fornecidos.',
    ['deliveries.review'],
  ),
  defineAgent(
    'isabela',
    'Isabela',
    'production',
    'Redatora',
    'Elabora conteúdo a partir de briefings.',
    ['content.draft'],
  ),
  defineAgent(
    'vinicius',
    'Vinícius',
    'production',
    'Editor de conteúdo',
    'Revisa clareza e consistência do conteúdo.',
    ['content.review'],
  ),
  defineAgent(
    'helena',
    'Helena',
    'legal',
    'Analista jurídico',
    'Prepara análises e minutas para revisão humana.',
    ['legal.review', 'legal.documents.draft'],
  ),
  defineAgent(
    'patricia',
    'Patrícia',
    'administration',
    'Analista administrativo',
    'Organiza registros e planeja rotinas administrativas.',
    ['records.organize', 'administration.plan'],
  ),
]);
