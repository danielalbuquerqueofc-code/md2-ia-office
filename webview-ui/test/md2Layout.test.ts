import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { MD2_DEPARTMENTS } from '../../core/src/md2Foundation.js';
import { fitOfficeZoom } from '../src/office/components/md2Viewport.js';

const layout = JSON.parse(
  readFileSync(new URL('../public/assets/md2-layout.json', import.meta.url), 'utf8'),
);
type Furniture = { uid: string; type: string; col: number; row: number };
describe('MD2 native office layout', () => {
  it('provides exactly 20 departmental seats and one exclusive CEO seat', () => {
    const seats = layout.furniture.filter(
      (f: Furniture) => f.type === 'CUSHIONED_BENCH',
    ) as Furniture[];
    expect(seats).toHaveLength(21);
    for (const department of MD2_DEPARTMENTS) {
      expect(
        seats.filter(
          (seat) => layout.areaTiles[seat.row * layout.cols + seat.col] === department.name,
        ),
      ).toHaveLength(department.positions);
    }
    expect(
      seats.filter((seat) => layout.areaTiles[seat.row * layout.cols + seat.col] === 'CEO · Você'),
    ).toHaveLength(1);
    expect(new Set(layout.furniture.map((f: Furniture) => f.uid)).size).toBe(
      layout.furniture.length,
    );
  });
  it('connects every workstation to the central corridor without crossing walls', () => {
    const start = 8 * layout.cols + 15;
    const visited = new Set<number>([start]);
    const queue = [start];
    for (let i = 0; i < queue.length; i++) {
      const cell = queue[i];
      const x = cell % layout.cols;
      const y = Math.floor(cell / layout.cols);
      for (const [c, r] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ]) {
        const index = r * layout.cols + c;
        if (
          c >= 0 &&
          c < layout.cols &&
          r >= 0 &&
          r < layout.rows &&
          layout.tiles[index] !== 0 &&
          !visited.has(index)
        ) {
          visited.add(index);
          queue.push(index);
        }
      }
    }
    for (const seat of layout.furniture.filter((f: Furniture) => f.type === 'CUSHIONED_BENCH')) {
      expect(visited.has(seat.row * layout.cols + seat.col)).toBe(true);
    }
  });
  it.each([
    [1366, 679],
    [980, 720],
    [390, 844],
  ])('keeps the whole map within a %sx%s screen', (width, height) => {
    const availableWidth = width - (width <= 600 ? 80 : width <= 980 ? 166 : 414);
    const availableHeight = height - (width <= 600 ? 235 : height <= 760 ? 296 : 334);
    const zoom = fitOfficeZoom(1, availableWidth, availableHeight, layout.cols, layout.rows, 16);
    expect(layout.cols * 16 * zoom).toBeLessThanOrEqual(availableWidth);
    expect(layout.rows * 16 * zoom).toBeLessThanOrEqual(availableHeight);
    expect(Number.isInteger(zoom * 16)).toBe(true);
  });
});
