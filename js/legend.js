// 記号の対応表(凡例): ステージ文字列の1文字が何を表すか。
// 基本の記号(. # ^ o G P)はエンジン固定、敵とアイテムはゲーム定義の一覧(enemyTypes / items)から決まる。
// 純粋関数。エンジン・描画・エディタ・サムネイルが同じ凡例を使う。
export const BASE_LEGEND = {
  ".": { kind: "empty", label: "空" }, "#": { kind: "solid", label: "地面/ブロック" }, "^": { kind: "hazard", label: "トゲ" },
  o: { kind: "coin", label: "コイン" }, G: { kind: "goal", label: "ゴール" }, P: { kind: "spawn", label: "開始位置" },
};
export const DEFAULT_ENEMY_COLOR = "#7a3fb0";

/** 旧形式(サーバー保存モードのv1)には enemyTypes が無いので、従来の歩く敵 'E' を1種類だけ用意する */
export function enemyTypesOf(game) {
  if (game.enemyTypes) return game.enemyTypes;
  const sp = game.enemy && typeof game.enemy.speed === "number" ? game.enemy.speed : 50;
  return { walker: { symbol: "E", label: "歩く敵", behavior: "walk", speed: sp, amp: 1, stompable: true, color: null } };
}

/** @returns {Map<string,{kind:string,id?:string,def?:object,label:string}>} 記号 → 意味 */
export function legendOf(game) {
  const m = new Map(Object.entries(BASE_LEGEND).map(([k, v]) => [k, { ...v }]));
  for (const [id, def] of Object.entries(enemyTypesOf(game))) m.set(def.symbol, { kind: "enemy", id, def, label: def.label });
  for (const [id, def] of Object.entries(game.items || {})) m.set(def.symbol, { kind: "item", id, def, label: def.label });
  return m;
}

/** ステージエディタ等で並べる順序: 空・ブロック・トゲ・コイン・敵(種類順)・アイテム・ゴール・開始位置 */
export function brushOrder(game) {
  const lg = legendOf(game), out = [".", "#", "^", "o"];
  for (const [s, v] of lg) if (v.kind === "enemy") out.push(s);
  for (const [s, v] of lg) if (v.kind === "item") out.push(s);
  out.push("G", "P");
  return out;
}
