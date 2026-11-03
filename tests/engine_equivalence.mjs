// reference/platformer-maker.html のロジック(DEF〜step)を取り出し、js/engine.js と
// 同じ入力列で数千ステップ走らせて状態を比較する。
import { readFileSync } from "node:fs";
import { Engine, DT } from "../js/engine.js";
import { validateGame } from "../js/schema.js";

const html = readFileSync(new URL("../reference/platformer-maker.html", import.meta.url), "utf8").split("\n");
const take = (a, b) => html.slice(a - 1, b).join("\n");   // 行番号は 1 始まり
// 73-93: 定数とDEF / 103: clone / 106: 状態変数 / 108-164: reset〜step(104,105行目のDOM参照は除く)
const src = take(73, 93) + "\n" + take(103, 103) + "\n" + take(106, 106) + "\n" + take(108, 164) +
  "\nreturn {DEF, get S(){return S}, get G(){return G}, set G(v){G=v}, reset, step, keys};";
const mk = () => new Function(src)();

const schema = JSON.parse(readFileSync(new URL("../schema/game.schema.json", import.meta.url)));
const rnd = seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;

function run(levelOverride, seed, steps) {
  const ref = mk();
  const def = JSON.parse(JSON.stringify(ref.DEF));
  if (levelOverride) def.level = levelOverride;
  ref.G = def; ref.reset(true);
  const v = validateGame(def, schema);
  if (!v.ok) throw new Error(JSON.stringify(v.errors));
  const eng = new Engine(v.game);
  const kRef = ref.keys, kNew = { l: 0, r: 0, j: 0, jp: false };
  const r = rnd(seed);
  let maxDiff = 0, deaths = 0, won = false, hold = 0;
  for (let i = 0; i < steps; i++) {
    { // 簡易ボット: 右へ進み、穴・トゲ・敵の手前でジャンプ。seedでタイミングを揺らす
      const P = ref.S.p, T = 32, grid = ref.S.grid ?? null; void grid;
      const lv = (ref.G.level), W = Math.max(...lv.map(x => x.length));
      const at = (px, py) => { const x = Math.floor(px / T), y = Math.floor(py / T); return (lv[y] || "")[x] || (x >= W ? "#" : "."); };
      const fy = P.y + P.h + 2, look = 4 + Math.floor(r() * 16);
      const hole = at(P.x + P.w + look, fy) !== "#";
      const spike = at(P.x + P.w + look, P.y + P.h - 4) === "^";
      const enemy = ref.S.en.some(e => e.alive && e.x > P.x && e.x - (P.x + P.w) < 50 + r() * 30 && Math.abs(e.y - P.y) < 40);
      kRef.l = kNew.l = 0; kRef.r = kNew.r = r() < .97 ? 1 : 0;
      if (P.on && (hole || spike || enemy) && !kRef.j) { kRef.jp = kNew.jp = true; kRef.j = kNew.j = 1; hold = 36 + Math.floor(r() * 10); }
      if (kRef.j && --hold <= 0) kRef.j = kNew.j = 0;
    }
    if (process.env.DBG && i < 120 && i % 10 === 0) console.log(i, ref.S.p.x.toFixed(0), ref.S.p.on, kRef.j, kRef.jp, ref.S.p.y.toFixed(0));
    ref.step(DT); eng.step(DT, kNew);
    const A = ref.S, B = eng.S;
    const pa = [A.p.x, A.p.y, A.p.vx, A.p.vy, A.coins, A.deaths, A.t, +A.won, A.en.length, ...A.en.flatMap(e => [e.x, +e.alive])];
    const pb = [B.p.x, B.p.y, B.p.vx, B.p.vy, B.coins, B.deaths, B.t, +B.won, B.en.length, ...B.en.flatMap(e => [e.x, +e.alive])];
    pa.forEach((x, k) => { maxDiff = Math.max(maxDiff, Math.abs(x - pb[k])); });
    deaths = B.deaths; won ||= B.won;
  }
  return { maxDiff, deaths, won, coins: eng.S.coins };
}
// ボットが通れる生成ステージ(空中ブロックなし): 穴・トゲ・敵・コイン・ゴール
function genLevel(seed) {
  const r = rnd(seed * 7919 + 13), H = 8, rows = Array.from({ length: H }, () => []);
  const put = (x, y, c) => { rows[y][x] = c; };
  let x = 0;
  const ground = n => { for (let i = 0; i < n; i++, x++) { put(x, H - 2, "#"); put(x, H - 1, "#"); } };
  ground(8);
  for (let k = 0; k < 9; k++) {
    const t = r();
    if (t < .3) { x += 2 + Math.floor(r() * 2); ground(6); }                       // 穴
    else if (t < .5) { ground(3); put(x, H - 3, "^"); ground(1); ground(5); }       // トゲ
    else if (t < .8) { ground(4); put(x, H - 3, "E"); ground(8); }                  // 敵
    else { for (let i = 0; i < 4; i++) { put(x, H - 3, "o"); ground(1); } ground(3); }
  }
  ground(6); put(x - 3, H - 3, "G");
  put(1, H - 3, "P");
  const W = x;
  return rows.map(r => Array.from({ length: W }, (_, i) => r[i] || ".").join(""));
}
let bad = 0, totals = { won: 0, coins: 0, deaths: 0 };
const cases = [[null, 3000], ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(s => [genLevel(s), 3600])];
cases.forEach(([lv, steps], i) => {
  const res = run(lv, i + 1, steps);
  totals.won += res.won; totals.coins += res.coins; totals.deaths += res.deaths;
  console.log(`${lv ? "生成" + i : "既定  "}: 最大差 ${res.maxDiff}  ミス ${res.deaths}  コイン ${res.coins}  クリア ${res.won}`);
  if (res.maxDiff > 0) bad++;
});
console.log(`合計: クリア ${totals.won}/${cases.length} コイン ${totals.coins} ミス ${totals.deaths}`);
console.log(bad ? "不一致あり" : "元プロトタイプと完全に同じ挙動(差 0)");
process.exit(bad ? 1 : 0);
