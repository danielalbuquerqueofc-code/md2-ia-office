import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentRegistry } from '../src/registry/agents.js';
import { ROOT } from './helpers.js';

interface OriginalAgent { id: string; name: string; departmentId: string; role: string; description: string; capabilities: string[]; initialState: string }
const original = JSON.parse(fs.readFileSync(path.join(ROOT, 'agents/original-registry.json'), 'utf8')) as {
  source: { commit: string }; departments: Array<{ id: string; name: string; agents: number }>; agents: OriginalAgent[];
};
const registry = new AgentRegistry(ROOT);

describe('identidade dos agentes contra o cadastro original (commit d4e3933)', () => {
  it('o cadastro original extraído tem 22 agentes e 10 departamentos na distribuição informada', () => {
    expect(original.source.commit).toBe('d4e3933');
    expect(original.agents).toHaveLength(22);
    expect(original.departments.map((d) => d.agents)).toEqual([1, 3, 4, 4, 2, 2, 2, 2, 1, 1]);
  });

  it('o registro atual tem exatamente os mesmos 22 agentes: nenhum inventado, nenhum faltando', () => {
    expect(registry.list().map((a) => a.id).sort()).toEqual(original.agents.map((a) => a.id).sort());
    expect(registry.get('alfred')).toBeUndefined();
  });

  it('nome, departamento, cargo, descrição e capacidades originais estão intactos em todos', () => {
    const deptOf = new Map(registry.file.departments.map((d) => [d.originalId, d.id]));
    for (const o of original.agents) {
      const a = registry.get(o.id)!;
      expect(a.name, `${o.id} nome`).toBe(o.name);
      expect(a.department, `${o.id} departamento`).toBe(deptOf.get(o.departmentId));
      expect(a.originalDepartmentId, `${o.id} departamento original`).toBe(o.departmentId);
      expect(a.role, `${o.id} cargo`).toBe(o.role);
      expect(a.description, `${o.id} descrição`).toBe(o.description);
      expect(a.originalCapabilities, `${o.id} capacidades`).toEqual(o.capabilities);
      expect(a.identityStatus).toBe('confirmado_no_cadastro_original');
    }
  });

  it('a distribuição por departamento bate com a original', () => {
    for (const d of original.departments) {
      const mine = registry.file.departments.find((x) => x.originalId === d.id)!;
      expect(registry.list().filter((a) => a.department === mine.id), d.name).toHaveLength(d.agents);
      expect(mine.agents).toBe(d.agents);
    }
  });

  it('competências ampliadas continuam marcadas como pendentes até aprovação do usuário', () => {
    for (const a of registry.list()) expect(a.competenciesStatus, a.id).toBe('proposta_pendente_de_confirmacao');
  });
});
