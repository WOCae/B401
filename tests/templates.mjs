// テンプレート(templates/*.json)の検証: スキーマ・診断・一覧との整合、そしてボットで実際にクリアできるか。
import { readFileSync, readdirSync } from "node:fs";
import { validateGame } from "../js/schema.js";
import { diagnose } from "../js/diagnose.js";
import { Engine, DT, T } from "../js/engine.js";
const dir = new URL("../templates/", import.meta.url), schema = JSON.parse(readFileSync(new URL("../schema/game.schema.json", import.meta.url)));
const idx = JSON.parse(readFileSync(new URL("index.json", dir)));
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { (c ? pass++ : fail++); console.log((c ? "  ok  " : "  NG  ") + n + (c ? "" : "  " + x)); };

/** 壁・穴・トゲ・敵に反応して進むボット(横の壁は上り下りできる高さならジャンプ) */
function play(game, seed, maxSec = 180) {
  const eng = new Engine(game), keys = { l: 0, r: 1, j: 0, jp: false };
  let s = seed, hold = 0; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let i = 0; i < maxSec * 60; i++) {
    const S = eng.S, p = S.p, look = 6 + Math.floor(rnd() * 14);
    const at = (x, y) => { const tx = Math.floor(x / T), ty = Math.floor(y / T); return tx < 0 || tx >= eng.W ? "#" : (eng.grid[ty] || [])[tx] || "."; };
    const aheadX = p.x + p.w + look;
    const wall = at(aheadX, p.y + p.h - 4) === "#" || at(aheadX, p.y + p.h / 2) === "#";
    const hole = at(aheadX, p.y + p.h + 2) !== "#" && at(aheadX, p.y + p.h + 40) !== "#";
    const spike = at(aheadX, p.y + p.h - 4) === "^";
    const enemy = S.en.some(e => e.alive && e.x > p.x && e.x - (p.x + p.w) < 55 + rnd() * 30 && Math.abs(e.y - p.y) < 40);
    if (p.on && (wall || hole || spike || enemy) && !keys.j) { keys.jp = true; keys.j = 1; hold = 30 + Math.floor(rnd() * 14); }
    if (keys.j && --hold <= 0) keys.j = 0;
    eng.step(DT, keys);
    if (S.won) return { won: true, sec: +(S.t).toFixed(1), deaths: S.deaths };
    if (eng.S !== S) { /* 死亡で状態が作り直された */ }
  }
  return { won: false, deaths: eng.S.deaths };
}

ok("index.json にテンプレートがある", idx.templates.length >= 5, idx.templates.length);
const files = readdirSync(dir).filter(f => f.endsWith(".json") && f !== "index.json");
ok("一覧とファイルが一致(欠け・余りなし)", JSON.stringify(idx.templates.map(t => t.file).sort()) === JSON.stringify(files.sort()), files);
for (const t of idx.templates) {
  const raw = JSON.parse(readFileSync(new URL(t.file, dir))), v = validateGame(raw, schema);
  ok(`${t.name}: スキーマ検証(エラー・警告なし)`, v.ok && v.warnings.length === 0, JSON.stringify([...v.errors, ...v.warnings].map(e => e.message)));
  if (!v.ok) continue;
  const lv = v.game.level.join("");
  ok(`${t.name}: 開始位置とゴールがある`, lv.includes("P") && lv.includes("G"));
  ok(`${t.name}: 名前・説明が入っている`, v.game.meta.title === t.name && t.description.length >= 10, v.game.meta.title);
  ok(`${t.name}: すべての穴を飛び越せる(診断)`, diagnose(v.game, schema).gapsClearable);
  ok(`${t.name}: 全行が同じ幅`, new Set(v.game.level.map(r => Array.from(r).length)).size === 1);
  let best = null; for (const seed of [1, 2, 3, 4, 5, 6]) { const r = play(v.game, seed); if (r.won && (!best || r.deaths < best.deaths)) best = r; }
  ok(`${t.name}: ボットがゴールまでクリアできる(ミス15回以内)`, !!best && best.deaths <= 15, best ? `ミス${best.deaths}回` : "6つのseedすべてでクリア不可");
  if (best) console.log(`        クリア ${best.sec}秒 ミス${best.deaths}`);
}
console.log(`\n${pass} 件成功 / ${fail} 件失敗`); process.exit(fail ? 1 : 0);
