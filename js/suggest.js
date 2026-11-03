// 規則ベースの調整提案(デモ)。結果は「JSON差分(ops)」で返すだけで、適用はしない。
// 本番ではここをLLM(PHP中継/MCP)に置き換える。形式は同じ: {title, ops}
import { getPath } from "./schema.js";

const field = (schema, path) => schema.fields.find(f => f.path === path);
const num = (schema, path, game, f) => {
  const m = field(schema, path), v = Math.min(m.max, Math.max(m.min, f(getPath(game, path))));
  return { op: "replace", path: "/" + path.split(".").join("/"), value: +v.toFixed(2) };
};

export const SUGGESTIONS = {
  "もう少し簡単に": (game, schema) => ({ title: "もう少し簡単に", ops: [
    num(schema, "physics.jumpVelocity", game, v => v * 1.08),
    num(schema, "physics.coyoteTime", game, v => v + .04),
    num(schema, "enemy.speed", game, v => v * .8)] }),
  "もう少し難しく": (game, schema) => ({ title: "もう少し難しく", ops: [
    num(schema, "physics.jumpVelocity", game, v => v * .94),
    num(schema, "physics.coyoteTime", game, v => Math.max(0, v - .03)),
    num(schema, "enemy.speed", game, v => v * 1.3 + 5)] }),
  "敵を増やす": (game, schema, engine) => {
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
