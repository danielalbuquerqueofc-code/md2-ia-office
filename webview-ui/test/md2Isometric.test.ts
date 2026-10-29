import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  ISOMETRIC_ROOMS,
  liveProgrammer,
  projectOffice,
  projectReferenceOffice,
  workstationPositions,
} from '../src/components/md2Isometric.js';
import { Md2IsometricOffice } from '../src/components/Md2IsometricOffice.js';

describe('MD2 isometric scene foundation', () => {
  it.each(['running', 'approval'])(
    'renders one real session and preserves planned roles in %s',
    (status) => {
      const html = renderToStaticMarkup(
        createElement(Md2IsometricOffice, {
          tasks: [{ id: 'task', status, agentId: 7, threadId: 'connected' }],
          onOpen: () => {},
        }),
      );
      expect(html.match(/data-character-kind="session"/g)).toHaveLength(1);
      expect(html.match(/data-character-kind="planned"/g)).toHaveLength(20);
      if (status === 'approval') {
        expect(html).toContain('iso-person-await');
        expect(html).not.toContain('class="iso-typing"');
      } else expect(html).toContain('class="iso-typing"');
    },
  );
  it('uses equal-length projected axes separated by 120 degrees', () => {
    const x = projectOffice(1, 0);
    const y = projectOffice(0, 1);
    expect(Math.hypot(x.x, x.y)).toBeCloseTo(1);
    expect(Math.hypot(y.x, y.y)).toBeCloseTo(1);
    expect(x.x * y.x + x.y * y.y).toBeCloseTo(-0.5);
    expect(projectOffice(0, 0, 10)).toEqual({ x: 0, y: -10 });
  });
  it('keeps the reference camera front-facing with upright height and shallow depth', () => {
    expect(projectReferenceOffice(300, 0)).toEqual({ x: 300, y: 0 });
    expect(projectReferenceOffice(0, 180).x).toBeCloseTo(-25.2);
    expect(projectReferenceOffice(0, 180).y).toBeCloseTo(117);
    expect(projectReferenceOffice(0, 0, 92)).toEqual({ x: 0, y: -92 });
  });
  it('preserves seven departments and exactly 20 planned workstations', () => {
    expect(ISOMETRIC_ROOMS).toHaveLength(7);
    expect(new Set(ISOMETRIC_ROOMS.map((room) => room.id)).size).toBe(7);
    expect(ISOMETRIC_ROOMS.reduce((sum, room) => sum + room.positions, 0)).toBe(20);
    for (const room of ISOMETRIC_ROOMS) {
      const seats = workstationPositions(room.positions);
      expect(new Set(seats.map((seat) => `${seat.x}:${seat.y}`)).size).toBe(room.positions);
      for (const seat of seats) {
        expect(seat.x).toBeGreaterThan(29);
        expect(seat.x + 40).toBeLessThan(300);
        expect(seat.y + 22).toBeLessThan(180);
      }
    }
  });
  it('does not represent planned, completed or disconnected work as a real session', () => {
    expect(liveProgrammer([{ id: 'planned', status: 'running' }])).toBeUndefined();
    expect(
      liveProgrammer([{ id: 'old', status: 'completed', agentId: 1, threadId: 'thread' }]),
    ).toBeUndefined();
    expect(
      liveProgrammer([{ id: 'empty', status: 'running', agentId: 1, threadId: '' }]),
    ).toBeUndefined();
  });
  it.each(['running', 'approval'])(
    'binds the real programmer in the %s state to its task',
    (status) => {
      const task = { id: 'task-real', status, agentId: 7, threadId: 'session-id' };
      expect(liveProgrammer([task])).toBe(task);
    },
  );
});
