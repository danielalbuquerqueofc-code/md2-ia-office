import path from 'node:path';
import { BackupService } from './backup.js';
import type { Config } from './config.js';
import { Db } from './db.js';
import { EventBus } from './events.js';
import { Deliverables } from './orchestrator/deliverables.js';
import { Engine } from './orchestrator/engine.js';
import type { Services } from './orchestrator/engine.js';
import { AgentRegistry } from './registry/agents.js';
import { KnowledgeEngine } from './registry/knowledge.js';
import { SkillRegistry } from './registry/skills.js';
import { ToolRegistry } from './registry/tools.js';
import type { AgentRuntime } from './runtime/types.js';

/** Monta todos os serviços. O runtime é injetado: produção usa ClaudeAgentRuntime; testes usam um dublê explícito. */
export function bootstrap(config: Config, runtime: AgentRuntime) {
  const db = new Db(path.join(config.dataDir, 'md2.sqlite'));
  const bus = new EventBus(db);
  const services: Services = {
    config, db, bus, runtime,
    agents: new AgentRegistry(config.rootDir),
    knowledge: new KnowledgeEngine(config.rootDir),
    skills: new SkillRegistry(config.rootDir),
    tools: new ToolRegistry(config),
    deliverables: new Deliverables(db, config.dataDir),
    backups: new BackupService(db, config.dataDir, config.backupDir, config.backupKeep),
  };
  return { services, engine: new Engine(services) };
}
