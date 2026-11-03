// ステージの縮小図(テンプレート選択などで使う)。ゲームJSONのlevelとthemeだけから描く。
const COLOR = { "^": "#4a4f57", o: "#f5b800", E: "#7a3fb0", G: "#d9342b" };

export function drawThumb(canvas, game) {
  const rows = game.level.map(r => Array.from(r)), W = Math.max(...rows.map(r => r.length)), H = rows.length;
  const k = canvas.width / W;
  canvas.height = Math.max(1, Math.round(H * k));
  const c = canvas.getContext("2d");
  c.fillStyle = game.theme.sky; c.fillRect(0, 0, canvas.width, canvas.height);
  rows.forEach((r, y) => r.forEach((ch, x) => {
    if (ch === ".") return;
    c.fillStyle = ch === "#" ? game.theme.ground : ch === "P" ? game.theme.player : COLOR[ch];
    if (!c.fillStyle) return;
    const px = Math.floor(x * k), py = Math.floor(y * k);
    if (ch === "o") { c.beginPath(); c.arc(px + k / 2, py + k / 2, Math.max(1, k * 0.35), 0, 7); c.fill(); }
    else c.fillRect(px, py, Math.ceil(k), Math.ceil(k));
  }));
}
