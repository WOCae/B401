// 新しいエンジン機能の動作テスト: 体力・残機・ダメージ後の無敵・二段ジャンプ・アイテム効果・敵の種類。
// 決まった入力で動かし、結果を確かめる(エンジンは決定的なので毎回同じ結果になる)。
import { readFileSync } from "node:fs";
import { validateGame } from "../js/schema.js";
import { Engine, DT, T } from "../js/engine.js";
const schema = JSON.parse(readFileSync(new URL("../schema/game.schema.json", import.meta.url)));
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { (c ? pass++ : fail++); console.log((c ? "  ok  " : "  NG  ") + n + (c ? "" : "  " + JSON.stringify(x))); };
const game = (rows, patch = {}) => { const v = validateGame({ level: rows, ...patch }, schema); if (!v.ok) throw new Error(JSON.stringify(v.errors)); return v.game; };
const K = (r = 0, j = 0) => ({ l: 0, r, j, jp: false });
const run = (eng, sec, keys = K()) => { for (let i = 0; i < Math.round(sec * 60); i++) eng.step(DT, keys); };
/** 最初のミスが起きた瞬間(次のフレーム)で止める */
const untilDeath = (eng, n = 1, keys = K(1)) => { for (let i = 0; i < 60 * 20 && eng.S.deaths < n && !eng.S.over; i++) eng.step(DT, keys); };
/** 平らな地面(下2行)の細長いステージ。row3 に開始位置 */
const flat = (mid, W = 30) => { const rows = Array.from({ length: 6 }, () => ".".repeat(W).split("")); for (let x = 0; x < W; x++) { rows[4][x] = "#"; rows[5][x] = "#"; } for (const [x, y, c] of mid) rows[y][x] = c; return rows.map(r => r.join("")); };
const apex = (eng, jumpKeys) => { let minY = eng.S.p.y; const y0 = minY; for (let i = 0; i < 200; i++) { eng.step(DT, jumpKeys(i)); minY = Math.min(minY, eng.S.p.y); } return y0 - minY; };
const pressAt = frames => i => ({ l: 0, r: 0, j: 1, jp: frames.includes(i) });

// ---- 元の挙動(体力1・残機なし)は変わらない
let e = new Engine(game(flat([[1, 3, "P"], [4, 3, "^"]])));
untilDeath(e); ok("体力1: トゲに触れるとミス(元の挙動)", e.S.deaths === 1 && !e.S.over && e.S.p.x < 3 * T, [e.S.deaths, e.S.over]);
// ---- 体力
e = new Engine(game(flat([[1, 3, "P"], [4, 3, "^"]]), { player: { hp: 3 } }));
run(e, 0.6, K(1));
ok("体力3: トゲでダメージ(体力2)・ミスにならない", e.S.p.hp === 2 && e.S.deaths === 0, [e.S.p.hp, e.S.deaths]);
ok("ダメージ後は無敵時間が始まる", e.S.p.iframes > 0, e.S.p.iframes);
const hpNow = e.S.p.hp; run(e, 0.2, K(1));
ok("無敵時間中の再接触では減らない", e.S.p.hp === hpNow, e.S.p.hp);
e = new Engine(game(flat([[1, 3, "P"], [4, 3, "^"], [5, 3, "^"], [6, 3, "^"]]), { player: { hp: 2, hurtInvincible: 0 } }));
run(e, 3, K(1)); ok("無敵時間0・体力2: 連続で当たると体力が尽きてミス", e.S.deaths >= 1, [e.S.deaths, e.S.p.hp]);
// ---- 残機
e = new Engine(game(flat([[1, 3, "P"], [4, 3, "^"]]), { player: { lives: 2 } }));
ok("残機2: 開始時の残機", e.S.livesLeft === 2, e.S.livesLeft);
untilDeath(e, 1); ok("1回目のミス: 残機1で再開", e.S.livesLeft === 1 && !e.S.over && e.S.deaths === 1, [e.S.livesLeft, e.S.over]);
untilDeath(e, 2); ok("2回目のミス: ゲームオーバー", e.S.over === true && e.S.livesLeft === 0 && e.S.deaths === 2, [e.S.livesLeft, e.S.over, e.S.deaths]);
const px = e.S.p.x; run(e, 1, K(1)); ok("ゲームオーバー後は動かない", e.S.p.x === px);
e.restart(); ok("リスタートで残機が戻り、ゲームオーバーが解除される", e.S.livesLeft === 2 && !e.S.over && e.S.deaths === 0);
e = new Engine(game(flat([[1, 3, "P"], [4, 3, "^"]])));
for (let i = 0; i < 5; i++) run(e, 2, K(1)); ok("残機0(無制限): 何度ミスしてもゲームオーバーにならない", !e.S.over && e.S.deaths >= 5, [e.S.deaths, e.S.over]);
// ---- 二段ジャンプ
const jumpOnce = () => { const g = new Engine(game(flat([[1, 3, "P"]]))); run(g, 0.3); return apex(g, pressAt([0])); };
const jumpTwice = (extra) => { const g = new Engine(game(flat([[1, 3, "P"]]), extra)); run(g, 0.3); return apex(g, pressAt([0, 24])); };
const single = jumpOnce(), noAbility = jumpTwice({}), dbl = jumpTwice({ player: { doubleJump: true } });
ok("能力なしでは、空中で押しても高く飛べない", Math.abs(noAbility - single) < 2, [single, noAbility]);
ok("二段ジャンプ有効: 空中でもう一度跳べて、より高くなる", dbl > single * 1.3, [single, dbl]);
const triple = (() => { const g = new Engine(game(flat([[1, 3, "P"]]), { player: { doubleJump: true } })); run(g, 0.3); return apex(g, pressAt([0, 24, 48])); })();
ok("二段まで(3回目は効かない)", Math.abs(triple - dbl) < 6 || triple < dbl * 1.25, [dbl, triple]);
// ---- アイテム
e = new Engine(game(flat([[1, 3, "P"], [2, 3, "*"], [8, 3, "E"]])));
run(e, 0.3, K(1)); ok("スター: 取ると無敵(残り時間つき)になり、アイテムは消える", e.S.p.fx.invincible && e.S.p.fx.invincible.rem > 0 && Object.keys(e.S.got).length === 1, e.S.p.fx);
run(e, 3, K(1)); ok("無敵中は、触れた敵を倒せる(自分は無事)", !e.S.en[0].alive && e.S.deaths === 0, [e.S.en[0].alive, e.S.deaths]);
e = new Engine(game(flat([[1, 3, "P"], [2, 3, "*"], [5, 3, "^"], [6, 3, "^"]])));
run(e, 2.5, K(1)); ok("無敵中はトゲでダメージを受けない", e.S.deaths === 0, e.S.deaths);
e = new Engine(game(flat([[1, 3, "P"], [2, 3, "*"]]))); run(e, 0.2, K(1)); run(e, 9); ok("スターの効果は8秒で切れる", e.S.p.fx.invincible === undefined, e.S.p.fx);
const withBoots = (() => { const g = new Engine(game(flat([[1, 3, "P"], [2, 3, "B"]]))); run(g, 0.3, K(1)); run(g, 1); return apex(g, pressAt([0])); })();
ok("ブーツ: ジャンプ力アップで、より高く跳べる", withBoots > single * 1.3, [single, withBoots]);
const wings = new Engine(game(flat([[1, 3, "P"], [2, 3, "W"]]))); run(wings, 0.3, K(1)); run(wings, 0.5);
ok("つばさ: 取ると二段ジャンプが使える(時間つき)", wings.S.p.fx.doubleJump !== undefined);
const wingsApex = apex(wings, pressAt([0, 24])); ok("つばさ中は実際に高く跳べる", wingsApex > single * 1.3, [single, wingsApex]);
run(wings, 20); ok("つばさの効果は時間で切れる", wings.S.p.fx.doubleJump === undefined);
e = new Engine(game(flat([[1, 3, "P"], [4, 3, "^"], [8, 3, "H"]]), { player: { hp: 3 } }));
run(e, 0.7, K(1)); const hpAfterSpike = e.S.p.hp; run(e, 1.5, K(1));
ok("ハート: 体力が回復する(上限は最大体力)", hpAfterSpike === 2 && e.S.p.hp === 3, [hpAfterSpike, e.S.p.hp]);
e = new Engine(game(flat([[1, 3, "P"], [2, 3, "L"]]), { player: { lives: 2 } })); run(e, 0.3, K(1));
ok("1UP: 残機が増える", e.S.livesLeft === 3, e.S.livesLeft);
e = new Engine(game(flat([[1, 3, "P"], [2, 3, "L"]]))); run(e, 0.3, K(1)); ok("残機の制限がないときの1UPは何も起きない", e.S.livesLeft === null);
e = new Engine(game(flat([[1, 3, "P"], [2, 3, "B"], [10, 3, "^"]]))); run(e, 0.3, K(1)); const hadBoots = !!e.S.p.fx.jumpBoost; untilDeath(e);
ok("ミスで効果は消え、アイテムは復活する", hadBoots && e.S.deaths === 1 && e.S.p.fx.jumpBoost === undefined && Object.keys(e.S.got).length === 0, [hadBoots, e.S.deaths, e.S.got]);
// ---- 敵の種類
e = new Engine(game(flat([[1, 3, "P"], [12, 2, "F"]], 30)));
const fl = e.S.en[0]; let minY = fl.y, maxY = fl.y, minX = fl.x, maxX = fl.x; for (let i = 0; i < 60 * 8; i++) { e.step(DT, K()); minY = Math.min(minY, fl.y); maxY = Math.max(maxY, fl.y); minX = Math.min(minX, fl.x); maxX = Math.max(maxX, fl.x); }
ok("飛ぶ敵: 横に動き、上下にゆれる(出発点より下には行かない)", fl.behavior === "fly" && maxX - minX > 50 && maxY - minY > 20 && maxY <= fl.y0 + 0.001, [maxX - minX, maxY - minY]);
const fwall = new Engine(game(flat([[1, 3, "P"], [12, 3, "F"], [10, 3, "#"], [10, 2, "#"], [14, 3, "#"], [14, 2, "#"]]))); const f2 = fwall.S.en[0]; for (let i = 0; i < 60 * 6; i++) fwall.step(DT, K());
ok("飛ぶ敵は壁で反転する(壁の中に入らない)", f2.x > 10 * T && f2.x + f2.w < 14 * T + T, f2.x / T);
const stompOn = (rows, p = {}) => { const g = new Engine(game(rows, p)); const en = g.S.en[0]; g.S.p.x = en.x - 2; g.S.p.y = en.y - 40; g.S.p.vy = 200; for (let i = 0; i < 40; i++) g.step(DT, K()); return g; };
let st = stompOn(flat([[1, 3, "P"], [12, 3, "E"]])); ok("歩く敵は上から踏んで倒せる", !st.S.en[0].alive && st.S.deaths === 0);
st = stompOn(flat([[1, 3, "P"], [12, 3, "X"]])); ok("トゲの敵は踏めない(踏むとダメージ=体力1ならミス)", st.S.en[0].alive && st.S.deaths >= 1, [st.S.en[0].alive, st.S.deaths]);
st = stompOn(flat([[1, 3, "P"], [12, 3, "X"]]), { player: { hp: 3 } }); ok("トゲの敵: 体力3なら踏んでもミスにならずダメージ", st.S.deaths === 0 && st.S.p.hp === 2, [st.S.deaths, st.S.p.hp]);
st = stompOn(flat([[1, 3, "P"], [12, 3, "F"]])); ok("飛ぶ敵も踏んで倒せる", !st.S.en[0].alive);
// ---- 敵の種類の設定が反映される
const custom = game(flat([[1, 3, "P"], [8, 3, "E"]]), { enemyTypes: { walker: { symbol: "E", speed: 150 } } }); const ce = new Engine(custom); const cx0 = ce.S.en[0].x; run(ce, 0.5);
ok("敵の速度の設定が反映される(速度150)", Math.abs(ce.S.en[0].x - cx0) > 40, ce.S.en[0].x - cx0);
const sym = game(flat([[1, 3, "P"], [8, 3, "Z"]]), { enemyTypes: { zed: { symbol: "Z", behavior: "walk", speed: 20, label: "Z敵" } } }); ok("新しく作った敵の種類が、その記号で配置される", new Engine(sym).S.en.length === 1 && new Engine(sym).S.en[0].type === "zed");
console.log(`\n${pass} 件成功 / ${fail} 件失敗`); process.exit(fail ? 1 : 0);
