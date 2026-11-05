// 新しい形式(v2)のスキーマ: 自動変換(v1→v2)・一覧型(敵の種類/アイテム)・記号の重複処理・正規化の安定性
import { readFileSync } from "node:fs";
import { validateGame, clone } from "../js/schema.js";
import { legendOf, brushOrder } from "../js/legend.js";
const schema = JSON.parse(readFileSync(new URL("../schema/game.schema.json", import.meta.url)));
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { (c ? pass++ : fail++); console.log((c ? "  ok  " : "  NG  ") + n + (c ? "" : "  " + JSON.stringify(x))); };
const LV = ["P..#", "####"];
const v = (extra = {}, level = LV) => validateGame({ level, ...extra }, schema);
const codes = r => r.warnings.map(w => w.code);

// ---- v1 → v2 の自動変換
let r = v({ enemy: { speed: 80 }, physics: { gravity: 1000 } });
ok("v1: enemy.speed が enemyTypes.walker.speed に移る", r.ok && r.game.enemyTypes.walker.speed === 80 && !("enemy" in r.game) && r.warnings.length === 0, [r.game && r.game.enemyTypes, r.warnings]);
ok("v1: 他の設定はそのまま・formatVersion=2が付く", r.game.physics.gravity === 1000 && r.game.formatVersion === 2);
ok("v1: 既定の敵の種類・アイテムが補われる", Object.keys(r.game.enemyTypes).join() === "walker,flyer,spiky" && Object.keys(r.game.items).join() === "heart,star,boots,wings,life");
ok("v1: 体力・残機などの既定値(元の挙動)", r.game.player.hp === 1 && r.game.player.lives === 0 && r.game.player.doubleJump === false);
r = v({ enemy: { speed: 9999 } }); ok("v1: 範囲外の敵の速度は丸められる", r.game.enemyTypes.walker.speed === 150 && codes(r).includes("clamped"));
r = v({ formatVersion: 1, level: LV }); ok("formatVersion:1 も v1 として扱う", r.ok && r.game.formatVersion === 2);
r = v({ formatVersion: 3 }); ok("未来の形式(v3)は、エラーで案内する", !r.ok && r.errors[0].code === "future_version", r.errors);
r = v({ formatVersion: 2, enemy: { speed: 80 } }); ok("v2 で残った enemy.speed は未対応として警告", r.ok && codes(r).includes("unknown_key"), r.warnings);
// ---- 安定性(正規化済みを再度通しても同じ)
const base = v({}).game; r = validateGame(clone(base), schema); ok("正規化は冪等(もう一度通しても同じ・警告なし)", JSON.stringify(r.game) === JSON.stringify(base) && r.warnings.length === 0, r.warnings);
// ---- 一覧型: 敵の種類
r = v({ enemyTypes: { a1: { symbol: "Z", label: "Z敵", behavior: "fly", speed: 60, amp: 2, stompable: false, color: "#112233" } } });
ok("敵の種類を自分で定義できる(他の種類は入らない)", r.ok && Object.keys(r.game.enemyTypes).join() === "a1" && r.game.enemyTypes.a1.symbol === "Z" && r.game.enemyTypes.a1.color === "#112233", r.game && r.game.enemyTypes);
r = v({ enemyTypes: {} }); ok("空の一覧(敵なし)も許す", r.ok && Object.keys(r.game.enemyTypes).length === 0);
r = v({ enemyTypes: { x: { symbol: "#" }, y: { symbol: "G" }, z: { symbol: "o" }, w: { symbol: "P" } } });
const syms = Object.values(r.game.enemyTypes).map(e => e.symbol); ok("予約された記号(# G o P)は使えず、空いている記号に置き換わる", new Set(syms).size === 4 && syms.every(c => !"#GoP.^".includes(c)) && codes(r).filter(c => c === "symbol_changed").length === 4, [syms, codes(r)]);
ok("自動割り当ては、他の項目が明示した記号(アイテムの B など)を横取りしない", Object.values(r.game.items).map(i => i.symbol).join("") === "H*BWL" && !syms.includes("B") && !syms.includes("H"), [syms, Object.values(r.game.items).map(i => i.symbol).join("")]);
r = v({ enemyTypes: { a: { symbol: "Q" }, b: { symbol: "Q" } }, items: { c: { symbol: "Q" } } });
const q = [r.game.enemyTypes.a.symbol, r.game.enemyTypes.b.symbol, r.game.items.c.symbol]; ok("記号の重複(敵とアイテムをまたいでも)は、後のものが別の記号になる", q[0] === "Q" && new Set(q).size === 3, q);
r = v({ enemyTypes: { a: { symbol: "ab" }, b: { symbol: 5 }, c: {} } }); ok("不正・未指定の記号は自動で割り当てる", Object.values(r.game.enemyTypes).every(e => /^[A-Z0-9*+=~!@%&?$]$/.test(e.symbol)) && new Set(Object.values(r.game.enemyTypes).map(e => e.symbol)).size === 3);
r = v({ enemyTypes: { "Bad-ID": { symbol: "Q" }, good_1: { symbol: "R" }, "": { symbol: "S" } } }); ok("不正なIDは無視される", Object.keys(r.game.enemyTypes).join() === "good_1" && codes(r).filter(c => c === "bad_id").length === 2, [Object.keys(r.game.enemyTypes), codes(r)]);
const many = Object.fromEntries(Array.from({ length: 15 }, (_, i) => ["t" + i, { symbol: "ABCDEFHIJKLMNOQ"[i] }])); r = v({ enemyTypes: many }); ok("上限(12種類)を超えた分は無視される", Object.keys(r.game.enemyTypes).length === 12 && codes(r).filter(c => c === "too_many").length === 3);
r = v({ enemyTypes: { a: { symbol: "Q", speed: 9999, behavior: "swim", foo: 1, stompable: "yes" } } });
ok("種類の中身も範囲丸め・型チェック・未知キー警告", r.game.enemyTypes.a.speed === 150 && r.game.enemyTypes.a.behavior === "walk" && r.game.enemyTypes.a.stompable === true && codes(r).includes("unknown_key"), r.warnings.map(w => w.code));
r = v({ enemyTypes: [1, 2] }); ok("一覧がオブジェクトでなければ既定値", r.ok && Object.keys(r.game.enemyTypes).length === 3 && codes(r).includes("type"));
r = v({ items: { i1: "x", i2: { symbol: "Q", effect: "heal" } } }); ok("中身がオブジェクトでない項目は無視される", Object.keys(r.game.items).join() === "i2");
// ---- アイテム
r = v({ items: { m: { symbol: "M", effect: "speedBoost", amount: 99, duration: -5, color: "red" } } });
ok("アイテム: 量・時間は丸め、色は既定に", r.game.items.m.amount === 5 && r.game.items.m.duration === 0 && r.game.items.m.color === "#ff4d6d" && codes(r).includes("clamped") && codes(r).includes("type"), r.game.items.m);
r = v({ items: { m: { symbol: "M", effect: "teleport" } } }); ok("未知の効果は既定の効果に", r.game.items.m.effect === "heal");
// ---- ステージの記号は一覧から決まる
let L = ["P..H*FXE", "#########"]; r = v({}, L); ok("既定の記号(アイテム H*、敵 F X E)はステージに置ける", r.ok && r.game.level[0] === "P..H*FXE" && codes(r).length === 0, [r.game && r.game.level, codes(r)]);
r = v({ enemyTypes: { a: { symbol: "Z" } } }, L); ok("一覧に無い記号(F X E)は空きになる(警告つき)、一覧にある Z は置ける", r.game.level[0] === "P..H*..." && codes(r).includes("level_unknown_tile") && v({ enemyTypes: { a: { symbol: "Z" } } }, ["PZ", "##"]).game.level[0] === "PZ", r.game.level[0]);
r = v({ items: {} }, ["P.H*", "####"]); ok("アイテムを全部消すと、そのタイルは空きになる", r.game.level[0] === "P..." && codes(r).includes("level_unknown_tile"));
const lg = legendOf(base); ok("凡例: 基本記号+敵+アイテム", lg.get("E").kind === "enemy" && lg.get("H").kind === "item" && lg.get("#").kind === "solid" && lg.get("G").kind === "goal" && lg.size === 6 + 3 + 5, lg.size);
ok("ブラシの並び: 空・ブロック・トゲ・コイン・敵・アイテム・ゴール・開始位置", brushOrder(base).join("") === ".#^oEFXH*BWLGP", brushOrder(base).join(""));
// 旧形式(enemyTypesなし)のゲームでも凡例が作れる(サーバー保存モード)
const legacy = legendOf({ enemy: { speed: 70 }, level: ["P"] }); ok("旧形式でも凡例が作れる(歩く敵 E)", legacy.get("E").def.speed === 70 && legacy.size === 7);
console.log(`\n${pass} 件成功 / ${fail} 件失敗`); process.exit(fail ? 1 : 0);
