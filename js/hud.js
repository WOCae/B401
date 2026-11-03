// HUD(コイン数・ミス・時間・クリア表示)。2D/3Dどちらの表示でも同じものを上に重ねる。
import { VW, VH } from "./engine.js";
export function drawHud(c, eng) {
  const S = eng.S;
  c.clearRect(0, 0, VW, VH);
  c.fillStyle = "rgba(0,0,0,.55)"; c.fillRect(8, 8, 236, 24);
  c.fillStyle = "#fff"; c.font = "14px sans-serif";
  c.fillText("コイン " + S.coins + "/" + S.total + "   ミス " + S.deaths + "   " + S.t.toFixed(1) + "秒", 16, 25);
  if (S.won) { c.fillStyle = "rgba(0,0,0,.6)"; c.fillRect(0, VH / 2 - 40, VW, 80); c.fillStyle = "#fff"; c.font = "bold 24px sans-serif"; c.textAlign = "center"; c.fillText("クリア! " + S.t.toFixed(1) + "秒 / ミス " + S.deaths, VW / 2, VH / 2 + 8); c.textAlign = "left"; }
}
