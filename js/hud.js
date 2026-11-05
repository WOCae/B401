// HUD(コイン数・ミス・時間・体力・残機・効果・クリア/ゲームオーバー表示)。2D/3Dどちらの表示でも同じものを上に重ねる。
import { VW, VH } from "./engine.js";
import { EFFECTS } from "./engine/effects.js";

const FX_LABEL = { invincible: "★無敵", jumpBoost: "↑ジャンプ", speedBoost: "→スピード", doubleJump: "二段ジャンプ" };

export function drawHud(c, eng) {
  const S = eng.S, p = S.p, maxHp = eng.maxHp(), showStatus = maxHp > 1 || S.livesLeft !== null || Object.keys(p.fx).length > 0;
  c.clearRect(0, 0, VW, VH);
  c.fillStyle = "rgba(0,0,0,.55)"; c.fillRect(8, 8, 236, 24);
  c.fillStyle = "#fff"; c.font = "14px sans-serif";
  c.fillText("コイン " + S.coins + "/" + S.total + "   ミス " + S.deaths + "   " + S.t.toFixed(1) + "秒", 16, 25);
  if (showStatus) { // 体力・残機・効果(元の1ヒットのゲームでは出さない)
    const fx = Object.entries(p.fx), w = 12 + (maxHp > 1 ? 22 * maxHp : 0) + (S.livesLeft !== null ? 74 : 0) + fx.length * 96;
    c.fillStyle = "rgba(0,0,0,.55)"; c.fillRect(8, 36, Math.max(60, w), 24);
    let x = 14; c.font = "16px sans-serif";
    if (maxHp > 1) for (let i = 0; i < maxHp; i++, x += 22) { c.fillStyle = i < p.hp ? "#ff4d6d" : "rgba(255,255,255,.3)"; c.fillText("♥", x, 54); }
    c.font = "13px sans-serif"; c.fillStyle = "#fff";
    if (S.livesLeft !== null) { c.fillText("残機 " + S.livesLeft, x + 2, 53); x += 74; }
    for (const [k, f] of fx) { c.fillStyle = k === "invincible" ? "#ffd60a" : "#8ce99a"; c.fillText((FX_LABEL[k] || (EFFECTS[k] && EFFECTS[k].label) || k) + (f.rem === Infinity ? "" : " " + Math.ceil(f.rem) + "s"), x, 53); x += 96; }
  }
  const banner = (t, sub) => { c.fillStyle = "rgba(0,0,0,.6)"; c.fillRect(0, VH / 2 - 40, VW, 80); c.fillStyle = "#fff"; c.font = "bold 24px sans-serif"; c.textAlign = "center"; c.fillText(t, VW / 2, VH / 2 + 4); if (sub) { c.font = "13px sans-serif"; c.fillText(sub, VW / 2, VH / 2 + 28); } c.textAlign = "left"; };
  if (S.won) banner("クリア! " + S.t.toFixed(1) + "秒 / ミス " + S.deaths);
  else if (S.over) banner("ゲームオーバー", "「リスタート」ボタンでもう一度");
}
