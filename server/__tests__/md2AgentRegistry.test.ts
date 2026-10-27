import { describe, expect, it } from 'vitest';

import { MD2_AGENT_REGISTRY, validateMd2AgentRegistry } from '../../core/src/md2AgentRegistry.js';
import {
  MD2_BUSINESS_DEPARTMENTS,
  MD2_DEPARTMENT_CAPABILITIES,
  MD2_DEPARTMENTS,
  MD2_PROGRAMMER,
} from '../../core/src/md2Foundation.js';

function copyRegistry() {
  return MD2_AGENT_REGISTRY.map((agent) => ({ ...agent, capabilities: [...agent.capabilities] }));
}

describe('MD2 business agent registry', () => {
  it('declares exactly 22 stable, uniquely named identities in the required organization', () => {
    expect(MD2_AGENT_REGISTRY).toHaveLength(22);
    expect(new Set(MD2_AGENT_REGISTRY.map((agent) => agent.id)).size).toBe(22);
    expect(new Set(MD2_AGENT_REGISTRY.map((agent) => agent.name)).size).toBe(22);
    expect(
      Object.fromEntries(MD2_AGENT_REGISTRY.map((agent) => [agent.id, agent.departmentId])),
    ).toEqual({
      carlos: 'general-management',
      lucas: 'commercial',
      fernanda: 'commercial',
      rafael: 'commercial',
      mariana: 'marketing',
      beatriz: 'marketing',
      gabriel: 'marketing',
      pedro: 'marketing',
      andre: 'technology',
      camila: 'technology',
      diego: 'technology',
      sofia: 'technology',
      juliana: 'support',
      bruno: 'support',
      renata: 'finance',
      eduardo: 'finance',
      thiago: 'operations',
      amanda: 'operations',
      isabela: 'production',
      vinicius: 'production',
      helena: 'legal',
      patricia: 'administration',
    });
    expect(
      MD2_AGENT_REGISTRY.filter((agent) =>
        [
          'carlos',
          'lucas',
          'fernanda',
          'rafael',
          'mariana',
          'beatriz',
          'gabriel',
          'pedro',
          'helena',
          'patricia',
        ].includes(agent.id),
      ).map((agent) => agent.name),
    ).toEqual([
      'Carlos',
      'Lucas',
      'Fernanda',
      'Rafael',
      'Mariana',
      'Beatriz',
      'Gabriel',
      'Pedro',
      'Helena',
      'Patrícia',
    ]);
  });

  it('matches all ten departmental headcounts', () => {
    expect(MD2_BUSINESS_DEPARTMENTS).toHaveLength(10);
    for (const department of MD2_BUSINESS_DEPARTMENTS) {
      expect(
        MD2_AGENT_REGISTRY.filter((agent) => agent.departmentId === department.id),
      ).toHaveLength(department.agents);
    }
  });

  it('starts every identity inactive with descriptive fields and only declared capabilities', () => {
    for (const agent of MD2_AGENT_REGISTRY) {
      expect(agent.initialState).toBe('inactive');
      expect(agent.role.trim().length).toBeGreaterThan(0);
      expect(agent.description.trim().length).toBeGreaterThan(0);
      expect(agent.capabilities.length).toBeGreaterThan(0);
      const allowed: readonly string[] = MD2_DEPARTMENT_CAPABILITIES[agent.departmentId];
      expect(agent.capabilities.every((capability) => allowed.includes(capability))).toBe(true);
    }
  });

  it('keeps the existing visual roster and programmer independent', () => {
    expect(MD2_DEPARTMENTS).toHaveLength(7);
    expect(MD2_DEPARTMENTS.reduce((sum, department) => sum + department.positions, 0)).toBe(20);
    expect(MD2_PROGRAMMER.id).toBe('codex-programmer');
    expect(MD2_AGENT_REGISTRY.some((agent) => agent.id === MD2_PROGRAMMER.id)).toBe(false);
    expect(
      MD2_AGENT_REGISTRY.every((agent) => !('provider' in agent) && !('agentId' in agent)),
    ).toBe(true);
  });

  it('returns immutable copies so callers cannot activate or escalate registered agents', () => {
    const input = copyRegistry();
    const validated = validateMd2AgentRegistry(input);
    input[0].capabilities.length = 0;
    input[0].name = 'Alterado';
    expect(validated[0].name).toBe('Carlos');
    expect(validated[0].capabilities).toContain('strategy.plan');
    expect(Object.isFrozen(validated)).toBe(true);
    expect(
      validated.every((agent) => Object.isFrozen(agent) && Object.isFrozen(agent.capabilities)),
    ).toBe(true);
  });

  it.each([
    null,
    {},
    [],
    MD2_AGENT_REGISTRY.slice(1),
    [...MD2_AGENT_REGISTRY, MD2_AGENT_REGISTRY[0]],
  ])('rejects invalid registry shape or count (%#)', (input) => {
    expect(() => validateMd2AgentRegistry(input)).toThrow('exatamente 22');
  });

  it.each([
    ['duplicate ID', { id: 'lucas' }],
    ['duplicate name', { name: 'Lucas' }],
    ['normalized duplicate name', { name: 'LÚCAS' }],
    ['invalid ID', { id: 'Carlos Silva' }],
    ['empty name', { name: '' }],
    ['empty role', { role: ' ' }],
    ['empty description', { description: '' }],
    ['unknown department', { departmentId: 'unknown' }],
    ['wrong headcount', { departmentId: 'marketing', capabilities: ['campaigns.plan'] }],
    ['external capability', { capabilities: ['whatsapp.send'] }],
    ['cross-department capability', { capabilities: ['code.draft'] }],
    ['duplicate capability', { capabilities: ['strategy.plan', 'strategy.plan'] }],
    ['empty capabilities', { capabilities: [] }],
    ['non-string capability', { capabilities: [42] }],
    ['active state', { initialState: 'active' }],
    ['external tool binding', { tools: ['external-service'] }],
  ])('rejects %s', (_label, change) => {
    const input: unknown[] = copyRegistry();
    input[0] = { ...MD2_AGENT_REGISTRY[0], ...change };
    expect(() => validateMd2AgentRegistry(input)).toThrow();
  });

  it('rejects missing fields and non-object records', () => {
    const input: unknown[] = copyRegistry();
    input[0] = { id: 'carlos' };
    expect(() => validateMd2AgentRegistry(input)).toThrow();
    input[0] = null;
    expect(() => validateMd2AgentRegistry(input)).toThrow();
  });
});
