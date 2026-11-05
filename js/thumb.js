// ステージの縮小図(テンプレート選択などで使う)。ゲームJSONのlevel・theme・凡例(敵/アイテムの色)から描く。
import { legendOf, DEFAULT_ENEMY_COLOR } from "./legend.js";
const COLOR = { "^": "#4a4f57", o: "#f5b800", G: "#d9342b" };

export function drawThumb(canvas, game) {
  const rows = game.level.map(r => Array.from(r)), W = Math.max(...rows.map(r => r.length)), H = rows.length, lg = legendOf(game);
  const k = canvas.width / W;
  canvas.height = Math.max(1, Math.round(H * k));
  const c = canvas.getContext("2d");
  c.fillStyle = game.theme.sky; c.fillRect(0, 0, canvas.width, canvas.height);
  rows.forEach((r, y) => r.forEach((ch, x) => {
    if (ch === ".") return;
    const l = lg.get(ch);
    c.fillStyle = ch === "#" ? game.theme.ground : ch === "P" ? game.theme.player : l && l.kind === "enemy" ? (l.def.color || DEFAULT_ENEMY_COLOR) : l && l.kind === "item" ? l.def.color : COLOR[ch];
    if (!l) return; // 未知の記号は描かない
    const px = Math.floor(x * k), py = Math.floor(y * k);
    if (ch === "o" || (l && l.kind === "item")) { c.beginPath(); c.arc(px + k / 2, py + k / 2, Math.max(1, k * 0.35), 0, 7); c.fill(); }
    else c.fillRect(px, py, Math.ceil(k), Math.ceil(k));
  }));
}
