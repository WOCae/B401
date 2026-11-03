// 規則ベースの調整提案(デモ)。結果は「JSON差分(ops)」で返すだけで、適用はしない。
// ゲーム性・カメラ・アセット設定のどれも同じ形: { title, ops } / { message }(提案なしの理由) / null
// 本番ではここをLLM(PHP中継/MCP)に置き換える。propose_patch に渡す形は同じ。
import { getPath } from "./schema.js";

const field = (schema, path) => schema.fields.find(f => f.path === path);
const ptr = path => "/" + path.split(".").join("/");

/** 現在値と違うときだけ replace を返す(数値は範囲に丸める) */
function setOp(schema, game, path, value) {
  const f = field(schema, path);
  let v = value;
  if (f && f.type === "number") v = +Math.min(f.max, Math.max(f.min, value)).toFixed(2);
  return getPath(game, path) === v ? null : { op: "replace", path: ptr(path), value: v };
}
const ops = list => list.filter(Boolean);
const numOps = (schema, game, items) => ops(items.map(([path, f]) => setOp(schema, game, path, f(getPath(game, path)))));

/* ---------- ゲーム性 ---------- */
const GAME = {
  "もう少し簡単に": (game, schema) => ({ title: "もう少し簡単に", ops: numOps(schema, game, [
    ["physics.jumpVelocity", v => v * 1.08], ["physics.coyoteTime", v => v + .04], ["enemy.speed", v => v * .8]]) }),
  "もう少し難しく": (game, schema) => ({ title: "もう少し難しく", ops: numOps(schema, game, [
    ["physics.jumpVelocity", v => v * .94], ["physics.coyoteTime", v => Math.max(0, v - .03)], ["enemy.speed", v => v * 1.3 + 5]]) }),
  "敵を増やす": (game, schema, { engine }) => {
    const H = engine.H, W = engine.W, row = H - 3, cs = [];
    if (row < 0) return null;
    for (let x = 7; x < W - 4; x++) {
      if (engine.grid[row][x] === "." && engine.solid(x, row + 1) && engine.solid(x - 1, row + 1) && engine.solid(x + 1, row + 1)
        && !engine.S.en.some(e => Math.abs(e.x / 32 - x) < 4) && !cs.some(c => Math.abs(c - x) < 5)) cs.push(x);
    }
    const pick = cs.sort(() => Math.random() - .5).slice(0, 2);
    if (!pick.length) return null;
    const chars = engine.grid[row].slice();
    for (const x of pick) chars[x] = "E";
    return { title: "敵を増やす", ops: [{ op: "replace", path: `/level/${row}`, value: chars.join("") }] };
  },
};

/* ---------- カメラ・表示 ---------- */
const CAMERA = {
  "3Dで見下ろし気味に": (game, schema) => ({ title: "3Dで見下ろし気味のカメラに", ops: ops([
    setOp(schema, game, "render.mode", "3d"), setOp(schema, game, "render.camera.type", "perspective"),
    setOp(schema, game, "render.camera.angle", 20), setOp(schema, game, "render.camera.distance", 14)]) }),
  "カメラを寄せる": (game, schema) => ({ title: "カメラを寄せる", ops: numOps(schema, game, [["render.camera.distance", v => v - 4]]) }),
  "カメラを引く": (game, schema) => ({ title: "カメラを引く", ops: numOps(schema, game, [["render.camera.distance", v => v + 4]]) }),
};

/* ---------- アセット ---------- */
const HINTS = { player: ["player"], enemy: ["enemy"], "#": ["block", "wall", "ground"], "^": ["spike"], o: ["coin"], G: ["goal", "flag"] };
const MODEL_PATH = { player: "assets.player.model", enemy: "assets.enemy.model", "#": "assets.tiles.#.model", "^": "assets.tiles.^.model", o: "assets.tiles.o.model", G: "assets.tiles.G.model" };
const CLIP_WORDS = { // クリップ名に含まれる語から対応づける(大小無視)
  idle: ["idle", "stand", "wait", "rest"], run: ["run", "walk", "sprint", "move"], jump: ["jump", "hop", "leap"], fall: ["fall", "air", "drop"], walk: ["walk", "run", "move"],
};

/** アップロード済み→サンプルの順に、名前のヒントで合うGLBを選ぶ */
function pickAsset(assets, hints) {
  const all = [...assets.uploads, ...assets.samples].filter(a => a.valid);
  for (const h of hints) { const a = all.find(x => x.name.toLowerCase().includes(h)); if (a) return a; }
  return null;
}
function matchClip(clips, key) {
  const lower = clips.map(c => c.toLowerCase());
  for (const w of CLIP_WORDS[key]) { const i = lower.findIndex(c => c.includes(w)); if (i >= 0) return clips[i]; }
  return null;
}

const ASSET = {
  "モデルを自動で割り当て": (game, schema, { assets }) => {
    if (!assets) return { message: "アセット一覧を読み込み中です。" };
    const list = Object.entries(HINTS).map(([k, hints]) => { const a = pickAsset(assets, hints); return a ? setOp(schema, game, MODEL_PATH[k], a.path) : null; });
    return { title: "名前の合うGLBをモデルに割り当てる", ops: ops(list), message: "割り当てられる新しいモデルがありません(名前に player / enemy / block / spike / coin / goal を含むGLBが必要です)。" };
  },
  "アニメ名を自動割り当て": (game, schema, { clips }) => {
    const out = [];
    for (const [kind, keys] of [["player", ["idle", "run", "jump", "fall"]], ["enemy", ["walk"]]]) {
      const cl = clips(kind);
      if (!cl.length) continue;
      for (const k of keys) { const m = matchClip(cl, k); if (m) out.push(setOp(schema, game, `assets.${kind}.anim.${k}`, m)); }
    }
    return { title: "アニメーションのクリップ名を割り当てる", ops: ops(out), message: "3D表示でモデルを読み込んだ状態で実行してください(クリップ名が必要です)。" };
  },
  "ヒットボックスをモデルに合わせる": (game, schema, { bounds }) => {
    const out = [];
    for (const kind of ["player", "enemy"]) {
      const b = bounds(kind);
      if (!b) continue;
      out.push(setOp(schema, game, `assets.${kind}.hitbox.w`, Math.round(b.w * 0.8)), setOp(schema, game, `assets.${kind}.hitbox.h`, Math.round(b.h)));
    }
    return { title: "ヒットボックスをモデルの大きさに合わせる(幅は80%)", ops: ops(out), message: "3D表示でモデルを読み込んだ状態で実行してください(モデルの大きさが必要です)。" };
  },
};

export const SUGGESTION_GROUPS = [["ゲーム性", GAME], ["カメラ・表示", CAMERA], ["アセット", ASSET]];
export { matchClip, pickAsset };
