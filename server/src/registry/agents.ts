import fs from 'node:fs';
import path from 'node:path';

export interface Department {
  id: string; originalId: string; name: string; agents: number; knowledge: string[]; limits: string[];
}
export interface Autonomy { level: 'consultivo' | 'producao' | 'execucao_tecnica'; can: string[]; cannot: string[]; needsApproval: string[] }
export interface AgentDef {
  id: string; name: string; department: string; originalDepartmentId: string;
  /** Identidade confirmada no cadastro original (commit d4e3933). */
  role: string; description: string; originalCapabilities: string[];
  identityStatus: 'confirmado_no_cadastro_original';
  /** Competências propostas na reformulação: PENDENTES DE CONFIRMAÇÃO até aprovação do usuário. */
  competenciesStatus: 'proposta_pendente_de_confirmacao' | 'confirmado';
  specialty: string; secondaryResponsibilities: string[]; capabilities: string[];
  knowledge: string[]; skills: string[]; tools: string[]; toolsForbidden: string[]; toolNotes: string[];
  autonomy: Autonomy; receiveWhen: string[]; requestOthersWhen: Array<{ agent: string; when: string }>;
  delivery: { format: string; typical: string[] }; quality: string[]; instructions: string[]; limits: string[]; openQuestions: string[];
}
export interface AgentRegistryFile {
  alfred: { name: string; role: string; status: string; note: string };
  identityPolicy: Record<string, Record<string, string>>;
  common: { limits: string[]; outputFormat: string[] };
  departments: Department[];
  agents: AgentDef[];
}

const LEVEL: Record<Autonomy['level'], string> = {
  consultivo: 'consultivo: você analisa, recomenda e escreve documentos; não executa comandos',
  producao: 'produção: você cria arquivos de entrega no workspace; não executa comandos',
  execucao_tecnica: 'execução técnica: você pode executar comandos no workspace isolado para construir e testar; nada sai dele',
};

export class AgentRegistry {
  readonly file: AgentRegistryFile;
  private byId = new Map<string, AgentDef>();
  constructor(rootDir: string) {
    this.file = JSON.parse(fs.readFileSync(path.join(rootDir, 'agents', 'registry.json'), 'utf8'));
    for (const a of this.file.agents) {
      if (this.byId.has(a.id)) throw new Error(`Agente duplicado: ${a.id}`);
      if (!this.file.departments.some((d) => d.id === a.department)) throw new Error(`Departamento inválido em ${a.id}`);
      this.byId.set(a.id, a);
    }
  }
  list() { return this.file.agents; }
  get(id: string) { return this.byId.get(id); }
  department(id: string) { return this.file.departments.find((d) => d.id === id)!; }

  /**
   * Catálogo usado por Alfred para escolher responsáveis. Traz, por agente, o cargo original, a responsabilidade
   * principal, quando acioná-lo, o que ele entrega e as skills — informação suficiente para rotear sem o usuário
   * citar nomes e para evitar duas tarefas com a mesma entrega.
   */
  catalog(): string {
    return this.file.departments
      .map((d) => {
        const rows = this.file.agents
          .filter((a) => a.department === d.id)
          .map((a) => [
            `- **${a.id}** — ${a.name}, ${a.role}. ${a.specialty}`,
            `  Acione quando: ${a.receiveWhen.join('; ')}.`,
            `  Entrega: ${a.delivery.typical.join(', ')}. Skills: ${a.skills.join(', ') || 'nenhuma'}. Nível: ${a.autonomy.level}.`,
          ].join('\n'));
        return `### ${d.name}\n${rows.join('\n')}`;
      })
      .join('\n\n');
  }

  /** Instruções permanentes do agente (identidade, limites, autonomia, qualidade, formato de devolutiva). */
  systemPrompt(agent: AgentDef): string {
    const d = this.department(agent.department);
    const list = (xs: string[]) => xs.map((x) => `- ${x}`).join('\n');
    const peers = agent.requestOthersWhen.map((r) => `- ${this.get(r.agent)?.name ?? r.agent} (${r.agent}): quando ${r.when}`);
    return [
      `Você é ${agent.name}, ${agent.role} do departamento ${d.name} da MD2. Você trabalha sob coordenação de Alfred, o diretor de operações, que distribui as tarefas e consolida as entregas para o usuário. Você não fala com o usuário nem aciona outros agentes diretamente.`,
      `Responsabilidade principal: ${agent.specialty}`,
      agent.secondaryResponsibilities.length ? `Responsabilidades secundárias:\n${list(agent.secondaryResponsibilities)}` : '',
      `## Como você trabalha\n${list(agent.instructions)}`,
      `## Nível de autonomia\n${LEVEL[agent.autonomy.level]}.\nVocê pode:\n${list(agent.autonomy.can)}\nVocê não pode:\n${list(agent.autonomy.cannot)}${agent.autonomy.needsApproval.length ? `\nExigem aprovação humana (use solicitar_aprovacao, tipos: ${agent.autonomy.needsApproval.join(', ')}).` : ''}`,
      `## Critérios de qualidade (verificáveis)\n${list(agent.quality)}`,
      `## Limites de atuação\n${list([...agent.limits, ...d.limits, ...this.file.common.limits])}`,
      peers.length ? `## Quando outro especialista é necessário\nNão faça o trabalho dele. Registre em "Pedidos a Alfred":\n${peers.join('\n')}` : '',
      `## Formato da devolutiva\n${list(this.file.common.outputFormat)}\nFormato típico das suas entregas: ${agent.delivery.format}`,
    ].filter(Boolean).join('\n\n');
  }
}
