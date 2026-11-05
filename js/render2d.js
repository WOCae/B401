// 2D描画(canvas)。段階2で 3D描画(render3d.js)と切り替え可能にする。
import { T, VW, VH } from "./engine.js";
import { DEFAULT_ENEMY_COLOR } from "./legend.js";

export function draw2d(c, eng, opts = {}) {
  const th = eng.def.theme, p = eng.S.p, S = eng.S, W = eng.W, H = eng.H, grid = eng.grid;
  c.fillStyle = th.sky; c.fillRect(0, 0, VW, VH);
  // opts.view = {camX, top, zoom}: ステージ編集用の自由視点(world座標の左端camX・上端top、拡大率zoom)
  // 指定がなければ従来どおり、プレイヤー追従・下端合わせ。
  const v = opts.view;
  c.save();
  if (v) { c.scale(v.zoom, v.zoom); c.translate(-v.camX, -v.top); }
  else { const cam = Math.round(Math.max(0, Math.min(W * T - VW, p.x + p.w / 2 - VW / 2))); c.translate(-cam, VH - H * T); }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = grid[y][x], px = x * T, py = y * T;
    if (t === "#") { c.fillStyle = th.ground; c.fillRect(px, py, T, T); if (!eng.solid(x, y - 1)) { c.fillStyle = "#4fa34f"; c.fillRect(px, py, T, 6); } }
    else if (t === "^") { c.fillStyle = "#4a4f57"; c.beginPath(); c.moveTo(px, py + T); c.lineTo(px + T / 2, py + 6); c.lineTo(px + T, py + T); c.fill(); }
    else if (t === "o" && !S.got[x + "," + y]) { c.fillStyle = "#f5b800"; c.beginPath(); c.arc(px + T / 2, py + T / 2, 8, 0, 7); c.fill(); }
    else if (eng.legend.get(t) && eng.legend.get(t).kind === "item" && !S.got[x + "," + y]) { // アイテム: 色つきの丸+頭文字(ゆらゆら浮く)
      const d = eng.legend.get(t).def, bob = Math.sin(S.t * 4 + x) * 2;
      c.fillStyle = d.color; c.beginPath(); c.arc(px + T / 2, py + T / 2 + bob, 10, 0, 7); c.fill();
      c.strokeStyle = "rgba(255,255,255,.85)"; c.lineWidth = 2; c.stroke();
      c.fillStyle = "rgba(0,0,0,.7)"; c.font = "bold 12px sans-serif"; c.textAlign = "center"; c.fillText(t, px + T / 2, py + T / 2 + 4 + bob); c.textAlign = "left";
    }
    else if (t === "G") { c.fillStyle = "#555"; c.fillRect(px + 13, py - T, 4, 2 * T); c.fillStyle = "#d9342b"; c.beginPath(); c.moveTo(px + 17, py - T); c.lineTo(px + T + 4, py - T + 10); c.lineTo(px + 17, py - T + 20); c.fill(); }
  }
  for (const e of S.en) {
    if (!e.alive) continue;
    c.fillStyle = e.color || DEFAULT_ENEMY_COLOR; c.fillRect(e.x, e.y, e.w, e.h);
    c.fillStyle = "#fff"; c.fillRect(e.x + 5, e.y + 6, 5, 5); c.fillRect(e.x + 14, e.y + 6, 5, 5);
    if (e.behavior === "fly") { c.fillStyle = "rgba(255,255,255,.9)"; const f = Math.sin(S.t * 18) * 4; c.beginPath(); c.moveTo(e.x, e.y + 8); c.lineTo(e.x - 8, e.y + 2 + f); c.lineTo(e.x, e.y + 14); c.fill(); c.beginPath(); c.moveTo(e.x + e.w, e.y + 8); c.lineTo(e.x + e.w + 8, e.y + 2 + f); c.lineTo(e.x + e.w, e.y + 14); c.fill(); }
    if (!e.stompable) { c.fillStyle = "#e8e8e8"; for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(e.x + 2 + i * 8, e.y); c.lineTo(e.x + 6 + i * 8, e.y - 6); c.lineTo(e.x + 10 + i * 8, e.y); c.fill(); } } // 踏めない敵はトゲ付き
  }
  const blink = p.iframes > 0 && Math.floor(S.t * 12) % 2 === 0; // ダメージ後の無敵中は点滅
  if (!blink) {
    c.fillStyle = th.player; c.fillRect(p.x, p.y, p.w, p.h);
    c.fillStyle = "#fff"; c.fillRect(p.x + (p.vx < -5 ? 3 : 13), p.y + 6, 6, 6);
    if (p.fx.invincible !== undefined) { c.strokeStyle = `hsl(${Math.floor(S.t * 600) % 360},90%,60%)`; c.lineWidth = 3; c.strokeRect(p.x - 2, p.y - 2, p.w + 4, p.h + 4); } // 無敵中は虹色の枠
  }
  if (opts.overlay) opts.overlay(c); // 同じ座標系で上に重ねる(グリッド・カーソルなど)
  if (opts.hitbox) { // ヒットボックス(物理の当たり判定そのもの)のデバッグ表示
    c.lineWidth = 1; c.strokeStyle = "#00ff66"; c.strokeRect(p.x + .5, p.y + .5, p.w - 1, p.h - 1);
    c.strokeStyle = "#ff3b30"; for (const e of S.en) if (e.alive) c.strokeRect(e.x + .5, e.y + .5, e.w - 1, e.h - 1);
  }
  c.restore();
}
