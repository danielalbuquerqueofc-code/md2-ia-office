import fs from 'node:fs';
import path from 'node:path';

export interface Department {
  id: string; name: string; knowledge: string[]; limits: string[];
}
export interface AgentDef {
  id: string; name: string; department: string; role: string; specialty: string;
  capabilities: string[]; instructions: string[]; limits: string[]; quality: string[];
  skills: string[]; tools: string[]; provisionalName?: boolean;
}
export interface AgentRegistryFile {
  alfred: { name: string; role: string };
  common: { limits: string[]; outputFormat: string[] };
  departments: Department[];
  agents: AgentDef[];
}

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

  /** Catálogo compacto usado por Alfred para escolher responsáveis. */
  catalog(): string {
    return this.file.departments
      .map((d) => {
        const rows = this.file.agents
          .filter((a) => a.department === d.id)
          .map((a) => `- ${a.id} — ${a.name}, ${a.role}. ${a.specialty} Skills: ${a.skills.join(', ') || 'nenhuma'}.`);
        return `### ${d.name}\n${rows.join('\n')}`;
      })
      .join('\n\n');
  }

  /** Instruções permanentes do agente (identidade, limites, qualidade, formato de devolutiva). */
  systemPrompt(agent: AgentDef): string {
    const d = this.department(agent.department);
    const list = (xs: string[]) => xs.map((x) => `- ${x}`).join('\n');
    return [
      `Você é ${agent.name}, ${agent.role} do departamento ${d.name} da MD2. Você trabalha sob coordenação de Alfred, o diretor de operações, que distribui as tarefas e consolida as entregas para o usuário.`,
      `Especialidade: ${agent.specialty}`,
      `## Como você trabalha\n${list(agent.instructions)}`,
      `## Critérios de qualidade\n${list(agent.quality)}`,
      `## Limites de atuação\n${list([...agent.limits, ...d.limits, ...this.file.common.limits])}`,
      `## Formato da devolutiva\n${list(this.file.common.outputFormat)}`,
    ].join('\n\n');
  }
}
