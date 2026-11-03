// 2D描画(canvas)。段階2で 3D描画(render3d.js)と切り替え可能にする。
import { T, VW, VH } from "./engine.js";

export function draw2d(c, eng) {
  const th = eng.def.theme, p = eng.S.p, S = eng.S, W = eng.W, H = eng.H, grid = eng.grid;
  c.fillStyle = th.sky; c.fillRect(0, 0, VW, VH);
  const cam = Math.round(Math.max(0, Math.min(W * T - VW, p.x + p.w / 2 - VW / 2)));
  c.save(); c.translate(-cam, VH - H * T);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = grid[y][x], px = x * T, py = y * T;
    if (t === "#") { c.fillStyle = th.ground; c.fillRect(px, py, T, T); if (!eng.solid(x, y - 1)) { c.fillStyle = "#4fa34f"; c.fillRect(px, py, T, 6); } }
    else if (t === "^") { c.fillStyle = "#4a4f57"; c.beginPath(); c.moveTo(px, py + T); c.lineTo(px + T / 2, py + 6); c.lineTo(px + T, py + T); c.fill(); }
    else if (t === "o" && !S.got[x + "," + y]) { c.fillStyle = "#f5b800"; c.beginPath(); c.arc(px + T / 2, py + T / 2, 8, 0, 7); c.fill(); }
    else if (t === "G") { c.fillStyle = "#555"; c.fillRect(px + 13, py - T, 4, 2 * T); c.fillStyle = "#d9342b"; c.beginPath(); c.moveTo(px + 17, py - T); c.lineTo(px + T + 4, py - T + 10); c.lineTo(px + 17, py - T + 20); c.fill(); }
  }
  for (const e of S.en) if (e.alive) { c.fillStyle = "#7a3fb0"; c.fillRect(e.x, e.y, e.w, e.h); c.fillStyle = "#fff"; c.fillRect(e.x + 5, e.y + 6, 5, 5); c.fillRect(e.x + 14, e.y + 6, 5, 5); }
  c.fillStyle = th.player; c.fillRect(p.x, p.y, p.w, p.h);
  c.fillStyle = "#fff"; c.fillRect(p.x + (p.vx < -5 ? 3 : 13), p.y + 6, 6, 6);
  c.restore();
}
