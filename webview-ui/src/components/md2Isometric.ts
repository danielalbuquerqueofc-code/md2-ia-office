import { MD2_DEPARTMENTS } from '../../../core/src/md2Foundation.js';

/** Equal-length axes at 30 degrees: genuine isometric projection, upright sprites. */
export function projectOffice(x: number, y: number, z = 0) {
  return { x: ((x - y) * Math.sqrt(3)) / 2, y: (x + y) / 2 - z };
}

const placements: Record<string, [number, number]> = {
  commercial: [135, 108],
  marketing: [135, 326],
  operations: [135, 544],
  strategy: [885, 108],
  finance: [885, 326],
  technology: [885, 544],
  support: [510, 376],
};
export const ISOMETRIC_ROOMS = MD2_DEPARTMENTS.map((department) => ({
  ...department,
  x: placements[department.id][0],
  y: placements[department.id][1],
}));

export function workstationPositions(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    x: count === 1 ? 95 : 47 + (index % 2) * 100,
    y: count <= 2 ? 53 : 28 + Math.floor(index / 2) * 57,
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
