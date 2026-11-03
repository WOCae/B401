// ステージ(level: 文字列の配列)を編集する純粋関数。DOM・fetchに依存しない(Nodeでテストできる)。
// どの関数も新しい配列を返し、引数は書き換えない。開始位置 P は常に1個だけ(消去は不可・移動のみ)。
export const BRUSHES = [".", "#", "^", "o", "E", "G", "P"];

/** 全行を同じ幅にそろえる(足りない分は空き '.') */
export function pad(rows) {
  const w = Math.max(1, ...rows.map(r => Array.from(r).length));
  return rows.map(r => { const a = Array.from(r); while (a.length < w) a.push("."); return a.join(""); });
}
export const size = rows => ({ w: Math.max(0, ...rows.map(r => Array.from(r).length)), h: rows.length });
export const inside = (rows, x, y) => y >= 0 && y < rows.length && x >= 0 && x < Array.from(rows[0] || "").length;

/** 1マスを書き換える。戻り値: {rows, changed} */
export function setTile(rows, x, y, ch) {
  if (!inside(rows, x, y)) return { rows, changed: false };
  const cur = Array.from(rows[y])[x];
  if (cur === ch) return { rows, changed: false };
  if (cur === "P" && ch !== "P") return { rows, changed: false }; // 開始位置は消せない(別の場所に置くと移動)
  let out = rows.map(r => Array.from(r));
  if (ch === "P") out = out.map(r => r.map(c => (c === "P" ? "." : c))); // Pは1個だけ
  out[y][x] = ch;
  return { rows: out.map(r => r.join("")), changed: true };
}

/** 複数マスに同じ記号を置く */
export function paint(rows, cells, ch) {
  let cur = rows, changed = false;
  for (const [x, y] of cells) { const r = setTile(cur, x, y, ch); if (r.changed) { cur = r.rows; changed = true; } }
  return { rows: cur, changed };
}

/** 2点を対角とする長方形のマス一覧 */
export function rectCells(a, b) {
  const out = [];
  for (let y = Math.min(a[1], b[1]); y <= Math.max(a[1], b[1]); y++) for (let x = Math.min(a[0], b[0]); x <= Math.max(a[0], b[0]); x++) out.push([x, y]);
  return out;
}

/** 2点を結ぶ線上のマス一覧(ブレゼンハム)。ドラッグが速くても隙間が空かないように */
export function lineCells(a, b) {
  const out = []; let [x0, y0] = a; const [x1, y1] = b;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return out;
}

/** 同じ記号でつながった領域を塗りつぶす(4近傍)。P を塗る/P の上を塗るのは不可 */
export function fill(rows, x, y, ch) {
  if (!inside(rows, x, y)) return { rows, changed: false };
  const grid = rows.map(r => Array.from(r)), from = grid[y][x];
  if (from === ch || from === "P" || ch === "P") return { rows, changed: false };
  const stack = [[x, y]];
  while (stack.length) {
    const [cx, cy] = stack.pop();
    if (cy < 0 || cy >= grid.length || cx < 0 || cx >= grid[0].length || grid[cy][cx] !== from) continue;
    grid[cy][cx] = ch;
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
  return { rows: grid.map(r => r.join("")), changed: true };
}

/**
 * 外周に行・列を足す/削る。d = {top, bottom, left, right}(正=追加、負=削除)。
 * 戻り値: {rows} または {error}(Pが消える・小さすぎる・上限超え)
 */
export function resize(rows, d, limits = { maxRows: 60, maxCols: 400 }) {
  let g = pad(rows).map(r => Array.from(r));
  const t = d.top || 0, b = d.bottom || 0, l = d.left || 0, r = d.right || 0;
  const w = g[0].length + l + r, h = g.length + t + b;
  if (w < 1 || h < 1) return { error: "これ以上小さくできません" };
  if (w > limits.maxCols) return { error: `幅の上限(${limits.maxCols})を超えます` };
  if (h > limits.maxRows) return { error: `高さの上限(${limits.maxRows})を超えます` };
  if (t < 0) g = g.slice(-t); if (b < 0) g = g.slice(0, g.length + b);
  if (l < 0) g = g.map(row => row.slice(-l)); if (r < 0) g = g.map(row => row.slice(0, row.length + r));
  const W = g[0].length;
  if (t > 0) g = [...Array.from({ length: t }, () => Array(W).fill(".")), ...g];
  if (b > 0) g = [...g, ...Array.from({ length: b }, () => Array(W).fill("."))];
  if (l > 0) g = g.map(row => [...Array(l).fill("."), ...row]);
  if (r > 0) g = g.map(row => [...row, ...Array(r).fill(".")]);
  const out = g.map(row => row.join(""));
  if (!out.join("").includes("P")) return { error: "開始位置(P)が消えてしまうため、その大きさにはできません" };
  return { rows: out };
}
