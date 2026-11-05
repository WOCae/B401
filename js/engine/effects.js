// アイテムの効果(固定の語彙)。ゲーム定義の items[*].effect がここの名前を指す。
// ユーザーのスクリプトは載せず、エンジンが持つ決まった部品を、データ(量・時間)で組み合わせて使う。
// 各効果は apply(engine, item) の形。item = { effect, amount, duration, ... }。
const keepLonger = (cur, dur) => Math.max(cur === undefined ? 0 : cur.rem, dur > 0 ? dur : Infinity);

/** 時間つきの状態を付ける(再取得で残り時間を延ばす)。duration 0 = ミスするまで */
function setFx(engine, name, mult, duration) {
  const fx = engine.S.p.fx;
  fx[name] = { mult, rem: keepLonger(fx[name], duration) };
}

export const EFFECTS = {
  heal: { label: "体力を回復", apply(eng, it) { const p = eng.S.p, max = eng.maxHp(); p.hp = Math.min(max, p.hp + Math.max(1, Math.round(it.amount))); } },
  life: { label: "残機を増やす", apply(eng, it) { const S = eng.S; if (S.livesLeft !== null) S.livesLeft = Math.min(99, S.livesLeft + Math.max(1, Math.round(it.amount))); } },
  invincible: { label: "無敵", apply(eng, it) { setFx(eng, "invincible", 1, it.duration); } },
  jumpBoost: { label: "ジャンプ力アップ", apply(eng, it) { setFx(eng, "jumpBoost", it.amount, it.duration); } },
  speedBoost: { label: "移動速度アップ", apply(eng, it) { setFx(eng, "speedBoost", it.amount, it.duration); } },
  doubleJump: { label: "二段ジャンプ", apply(eng, it) { setFx(eng, "doubleJump", 1, it.duration); } },
};
