// 古い形式(v1)のファイルが、いまのツールでも開けること(後方互換)のテスト。
// tests/golden/ にあるファイルは、v1 の時点のツールが実際に書き出したもの。内容は書き換えないこと。
import { readFileSync, readdirSync } from "node:fs";
import { validateGame, clone } from "../js/schema.js";
import { parseProjectBytes } from "../js/project.js";
import { inspectGlb, modelRefs } from "../js/glb.js";
import { Engine } from "../js/engine.js";
const dir = new URL("./golden/", import.meta.url), schema = JSON.parse(readFileSync(new URL("../schema/game.schema.json", import.meta.url)));
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { (c ? pass++ : fail++); console.log((c ? "  ok  " : "  NG  ") + n + (c ? "" : "  " + JSON.stringify(x))); };
const bytes = f => new Uint8Array(readFileSync(new URL(f, dir)));

// ---- v1 のテンプレート(単体のゲーム定義JSON)
for (const f of readdirSync(new URL("v1_templates/", dir)).sort()) {
  const raw = JSON.parse(readFileSync(new URL("v1_templates/" + f, dir))), r = validateGame(raw, schema);
  ok(`v1 ${f}: そのまま開ける(エラー・警告なし)`, r.ok && r.warnings.length === 0, [...r.errors, ...r.warnings].map(e => e.message));
  if (!r.ok) continue;
  ok(`v1 ${f}: ステージ・テーマ・タイトルが変わらない`, JSON.stringify(r.game.level) === JSON.stringify(raw.level) && r.game.meta.title === raw.meta.title && (!raw.theme || Object.entries(raw.theme).every(([k, v]) => r.game.theme[k] === v)));
  ok(`v1 ${f}: 遊び方の設定が元のまま(体力1・残機なし・二段ジャンプなし)`, r.game.player.hp === 1 && r.game.player.lives === 0 && !r.game.player.doubleJump);
  const again = validateGame(clone(r.game), schema); ok(`v1 ${f}: 変換後を保存して開き直しても同じ`, JSON.stringify(again.game) === JSON.stringify(r.game) && again.warnings.length === 0);
  const e = new Engine(r.game); ok(`v1 ${f}: エンジンで動く`, e.S.en.length === raw.level.join("").split("E").length - 1 && e.S.p.hp === 1);
}
// ---- v1 のプロジェクトファイル(JSON と PNG)
for (const f of ["v1_project.pfmk.json", "v1_project.pfmk.png"]) {
  let p; try { p = parseProjectBytes(bytes(f).buffer); } catch (e) { ok(`${f}: 読み取れる`, false, e.message); continue; }
  const r = validateGame(p.game, schema);
  ok(`${f}: 読み取れて、ゲームが検証を通る`, p.format === "platformer-maker-project" && p.version === 1 && r.ok && r.warnings.length === 0, [...r.errors, ...r.warnings].map(e => e.message));
  ok(`${f}: 同梱のGLBが壊れていない(1個)`, p.assets.length === 1 && inspectGlb(Uint8Array.from(Buffer.from(p.assets[0].data, "base64"))).ok);
  ok(`${f}: ゲームが参照するモデルが同梱されている`, Object.keys(modelRefs(r.game)).filter(x => x.startsWith("uploads/")).every(x => p.assets.some(a => a.path === x)));
  ok(`${f}: 敵の速度などの設定が引き継がれる`, r.game.enemyTypes.walker.speed === (p.game.enemy ? p.game.enemy.speed : 50));
}
const a = parseProjectBytes(bytes("v1_project.pfmk.json").buffer), b = parseProjectBytes(bytes("v1_project.pfmk.png").buffer);
ok("同じ時点のJSONとPNGは、検証後に同じゲームになる(物理設定は保存時から変更あり)", validateGame(a.game, schema).game.level.join() === validateGame(b.game, schema).game.level.join());
console.log(`\n${pass} 件成功 / ${fail} 件失敗`); process.exit(fail ? 1 : 0);
