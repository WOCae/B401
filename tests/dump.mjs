// JS側: cases.json を処理して結果をJSONで出力(PHP側 dump.php と比較する)
import { readFileSync } from "node:fs";
import { validateGame, clone } from "../js/schema.js";
import { diagnose } from "../js/diagnose.js";
import { applyPatchOps } from "../js/patch.js";
const schema = JSON.parse(readFileSync(new URL("../schema/game.schema.json", import.meta.url)));
const cases = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url)));
const gen = c => {
  if (c.gen === "rows61") return { level: Array.from({ length: 61 }, (_, i) => i ? "." : "P") };
  if (c.gen === "cols401") return { level: ["P" + ".".repeat(400)] };
  return c.input;
};
const out = { validate: {}, patch: {} };
for (const c of cases.validate) {
  const r = validateGame(gen(c), schema);
  out.validate[c.name] = { ok: r.ok, game: r.game, errors: r.errors.map(i => [i.path, i.code]), warnings: r.warnings.map(i => [i.path, i.code]), diag: r.ok ? diagnose(r.game, schema) : null };
}
const base = validateGame(schema.defaultGame, schema).game;
for (const c of cases.patch) {
  try { out.patch[c.name] = { ok: true, game: applyPatchOps(base, c.ops) }; }
  catch (e) { out.patch[c.name] = { ok: false, error: e.constructor.name }; }
}
console.log(JSON.stringify(out));
