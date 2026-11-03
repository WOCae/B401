// JSON差分(RFC 6902 のサブセット: replace / add / remove)の適用。
// AIも人もこの形式で変更を提案する。適用後は必ず validateGame を通すこと。
// PHP側 api/lib/schema.php の apply_patch_ops() と同じ規則。
import { isObj, clone, getPath } from "./schema.js";

export class PatchError extends Error {}
const BAD = new Set(["__proto__", "constructor", "prototype"]);
const IDX = /^(0|[1-9]\d*)$/;

export function applyPatchOps(game, ops) {
  if (!Array.isArray(ops) || ops.length < 1 || ops.length > 200) throw new PatchError("ops は1〜200個の配列にしてください");
  const doc = clone(game);
  ops.forEach((op, i) => {
    const at = `ops[${i}]`;
    if (!isObj(op) || !["replace", "add", "remove"].includes(op.op)) throw new PatchError(`${at}: op は replace / add / remove のいずれかです`);
    if (typeof op.path !== "string" || !op.path.startsWith("/") || op.path.length < 2) throw new PatchError(`${at}: path は "/physics/gravity" の形式にしてください`);
    if (op.op !== "remove" && !Object.hasOwn(op, "value")) throw new PatchError(`${at}: value が必要です`);
    const toks = op.path.slice(1).split("/").map(t => t.replace(/~1/g, "/").replace(/~0/g, "~"));
    if (toks.some(t => BAD.has(t))) throw new PatchError(`${at}: 使えない path です`);
    let cur = doc;
    for (const t of toks.slice(0, -1)) {
      if (Array.isArray(cur)) { if (!IDX.test(t) || +t >= cur.length) throw new PatchError(`${at}: path が存在しません`); cur = cur[+t]; }
      else if (isObj(cur)) { if (!Object.hasOwn(cur, t)) throw new PatchError(`${at}: path が存在しません`); cur = cur[t]; }
      else throw new PatchError(`${at}: path が存在しません`);
    }
    const last = toks[toks.length - 1];
    const val = op.op === "remove" ? undefined : clone({ v: op.value }).v;
    if (Array.isArray(cur)) {
      const idx = (last === "-" && op.op === "add") ? cur.length : (IDX.test(last) ? +last : -1);
      if (idx < 0) throw new PatchError(`${at}: 配列の添字が不正です`);
      if (op.op === "add") { if (idx > cur.length) throw new PatchError(`${at}: 添字が範囲外です`); cur.splice(idx, 0, val); }
      else {
        if (idx >= cur.length) throw new PatchError(`${at}: 添字が範囲外です`);
        if (op.op === "replace") cur[idx] = val; else cur.splice(idx, 1);
      }
    } else if (isObj(cur)) {
      if (op.op !== "add" && !Object.hasOwn(cur, last)) throw new PatchError(`${at}: path が存在しません`);
      if (op.op === "remove") delete cur[last]; else cur[last] = val;
    } else throw new PatchError(`${at}: path が存在しません`);
  });
  return doc;
}

/** 差分を人が読める1行にする(UI表示用) */
export function describeOp(op, game, schema) {
  const dot = op.path.slice(1).split("/").join(".");
  const f = schema.fields.find(x => x.path === dot);
  const old = getPath(game, dot);
  if (f && op.op === "replace") return `${f.label}: ${old} → ${op.value}`;
  const m = /^\/level\/(\d+)$/.exec(op.path);
  if (m && op.op === "replace" && typeof op.value === "string") {
    const y = +m[1], before = game.level[y] || "", out = [];
    const n = Math.max(before.length, op.value.length);
    for (let x = 0; x < n; x++) {
      const a = before[x] || ".", b = op.value[x] || ".";
      if (a !== b) out.push(`${x + 1}列目・${y + 1}行目: ${a} → ${b}`);
    }
    return out.join(" / ") || `${y + 1}行目(変更なし)`;
  }
  return `${op.op} ${op.path}${op.op === "remove" ? "" : " = " + JSON.stringify(op.value)}`;
}
