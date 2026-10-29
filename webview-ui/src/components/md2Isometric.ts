import { MD2_DEPARTMENTS } from '../../../core/src/md2Foundation.js';

/** Equal-length axes at 30 degrees: genuine isometric projection, upright sprites. */
export function projectOffice(x: number, y: number, z = 0) {
  return { x: ((x - y) * Math.sqrt(3)) / 2, y: (x + y) / 2 - z };
}

/** The reference uses a front cutaway camera, with shallow depth and upright walls. */
export function projectReferenceOffice(x: number, y: number, z = 0) {
  return { x: x - y * 0.14, y: y * 0.65 - z };
}

const placements: Record<string, [number, number]> = {
  commercial: [38, 95],
  marketing: [38, 290],
  operations: [38, 485],
  strategy: [790, 95],
  finance: [790, 290],
  technology: [790, 485],
  support: [405, 330],
};
export const ISOMETRIC_ROOMS = MD2_DEPARTMENTS.map((department) => ({
  ...department,
  x: placements[department.id][0],
  y: placements[department.id][1],
}));

export function workstationPositions(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    x: count === 1 ? 145 : count === 3 ? 48 + index * 95 : 70 + (index % 2) * 140,
    y: count === 1 ? 100 : count < 4 ? 120 : 60 + Math.floor(index / 2) * 80,
  }));
}

export type IsometricTask = { id: string; status: string; agentId?: number; threadId?: string };
export function liveProgrammer(tasks: IsometricTask[]) {
  return tasks.find(
    (task) =>
      ['running', 'approval'].includes(task.status) &&
      typeof task.agentId === 'number' &&
      typeof task.threadId === 'string' &&
      task.threadId.length > 0,
  );
}
