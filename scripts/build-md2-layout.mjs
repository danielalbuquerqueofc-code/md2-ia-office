import { readFileSync, writeFileSync } from 'node:fs';

const palette = JSON.parse(
  readFileSync(new URL('../core/src/assets/md2-palette.json', import.meta.url), 'utf8'),
);

// Native Pixel Agents furniture and layout format; no image overlay or AI calls.
const cols = 46;
const rows = 23;
const layout = {
  version: 1,
  cols,
  rows,
  layoutRevision: 2,
  tiles: Array(cols * rows).fill(7),
  areaTiles: Array(cols * rows).fill(null),
  areas: [],
  furniture: [],
};
const rooms = [
  ['Comercial e Vendas', palette[0], 1, 1, 14, 7, 4],
  ['Marketing', palette[1], 1, 8, 14, 7, 3],
  ['Operações', palette[2], 1, 15, 14, 7, 3],
  ['Diretoria e Estratégia', palette[3], 31, 1, 14, 7, 2],
  ['Financeiro', palette[4], 31, 8, 14, 7, 2],
  ['Tecnologia', palette[5], 31, 15, 14, 7, 4],
  ['CEO · Você', palette[6], 17, 1, 12, 7, 1],
  ['Atendimento', palette[7], 17, 9, 12, 9, 2],
];
function put(type, col, row) {
  layout.furniture.push({ uid: `md2-${layout.furniture.length + 1}`, type, col, row });
}
for (const [label, color, x, y, w, h, positions] of rooms) {
  layout.areas.push({ label, color });
  for (let r = y; r < y + h; r++)
    for (let c = x; c < x + w; c++) {
      const wall = r === y || r === y + h - 1 || c === x || c === x + w - 1;
      layout.tiles[r * cols + c] = wall ? 0 : 7;
      if (!wall) layout.areaTiles[r * cols + c] = label;
    }
  const door = x === 1 ? x + w - 1 : x;
  for (let r = y + 3; r <= y + 4; r++) layout.tiles[r * cols + door] = 7;
  if (x === 17) for (let c = x + 4; c < x + 8; c++) layout.tiles[(y + h - 1) * cols + c] = 7;
  for (let k = 0; k < positions; k++) {
    const c = label.startsWith('CEO') ? x + 4 : x + 1 + k * 3;
    put('DESK_FRONT', c, y + 1);
    put('PC_FRONT_OFF', c + 1, y + 1);
    put('CUSHIONED_BENCH', c + 1, y + 3);
  }
  put('PLANT', x + w - 3, y + h - 3);
  put('DOUBLE_BOOKSHELF', x + 1, y - 1);
}
put('SOFA_FRONT', 19, 19);
put('SOFA_FRONT', 25, 19);
put('COFFEE_TABLE', 22, 19);
for (let c = 0; c < cols; c++) layout.tiles[c] = layout.tiles[(rows - 1) * cols + c] = 0;
for (let r = 0; r < rows; r++) layout.tiles[r * cols] = layout.tiles[r * cols + cols - 1] = 0;
writeFileSync(
  new URL('../webview-ui/public/assets/md2-layout.json', import.meta.url),
  JSON.stringify(layout, null, 2) + '\n',
);
