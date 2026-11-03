// ゲーム定義JSONの検証。ルールは schema/game.schema.json に集約し、
// PHP側(api/lib/schema.php)も同じファイルを読んで同じ処理を行う。
// 純粋関数のみ(DOM・fetch・fs に依存しない)。

export const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
export const clone = o => JSON.parse(JSON.stringify(o));

export function getPath(o, path) {
  let cur = o;
  for (const k of path.split(".")) {
    if (cur === null || typeof cur !== "object" || !Object.hasOwn(cur, k)) return undefined;
    cur = cur[k];
  }
  return cur;
}
export function setPath(o, path, v) {
  const ks = path.split("."), last = ks.pop();
  let cur = o;
  for (const k of ks) { if (!isObj(cur[k])) cur[k] = {}; cur = cur[k]; }
  cur[last] = v;
}

const issue = (path, code, message) => ({ path, code, message });
const COLOR = /^#[0-9a-fA-F]{6}$/;

function findUnknown(obj, prefix, leaf, branch, out) {
  for (const k of Object.keys(obj)) {
    const p = prefix ? prefix + "." + k : k;
    if (leaf.has(p)) continue;
    if (branch.has(p) && isObj(obj[k])) findUnknown(obj[k], p, leaf, branch, out);
    else out.push(p);
  }
}

/**
 * ゲーム定義を検証して正規化する。
 * 戻り値: { ok, errors:[{path,code,message}], warnings:[...], game|null }
 * - 範囲外の数値は丸め(warning)、型違いは既定値(warning)
 * - 構造が壊れている場合は errors(game=null)
 */
export function validateGame(input, schema) {
  const errors = [], warnings = [];
  if (!isObj(input)) {
    return { ok: false, errors: [issue("", "not_object", "ゲーム定義はJSONオブジェクトにしてください")], warnings, game: null };
  }
  const game = {};
  for (const f of schema.fields) {
    const raw = getPath(input, f.path);
    let v;
    if (raw === undefined) {
      v = f.default;
    } else if (raw === null && f.nullable) {
      v = null;
    } else if (f.type === "enum") {
      if (typeof raw === "string" && f.values.includes(raw)) v = raw;
      else {
        warnings.push(issue(f.path, "type", `${f.path}: ${f.values.join(" / ")} のいずれかにしてください。既定値 ${f.default} を使います`));
        v = f.default;
      }
    } else if (f.type === "bool") {
      if (typeof raw === "boolean") v = raw;
      else {
        warnings.push(issue(f.path, "type", `${f.path}: true / false にしてください。既定値 ${f.default} を使います`));
        v = f.default;
      }
    } else if (f.type === "number") {
      if (typeof raw !== "number" || !Number.isFinite(raw)) {
        warnings.push(issue(f.path, "type", `${f.path}: 数値ではないため既定値 ${f.default} を使います`));
        v = f.default;
      } else {
        v = Math.min(f.max, Math.max(f.min, raw));
        if (v !== raw) warnings.push(issue(f.path, "clamped", `${f.path}: ${raw} は範囲外のため ${v} に丸めました(${f.min}〜${f.max})`));
      }
    } else if (f.type === "color") {
      if (typeof raw === "string" && COLOR.test(raw)) v = raw;
      else {
        warnings.push(issue(f.path, "type", `${f.path}: #rrggbb 形式ではないため既定値 ${f.default} を使います`));
        v = f.default;
      }
    } else if (f.type === "string") {
      if (typeof raw !== "string") {
        warnings.push(issue(f.path, "type", `${f.path}: 文字列ではないため既定値を使います`));
        v = f.default;
      } else if (raw === "") {
        v = f.default;
      } else if (f.pattern) { // パス等: 切り詰めず、長すぎ・不正は既定値に戻す
        if (Array.from(raw).length <= f.maxLength && new RegExp(f.pattern).test(raw)) v = raw;
        else {
          warnings.push(issue(f.path, "bad_format", `${f.path}: 使えない形式です(例: assets/samples/player.glb)。既定値に戻します`));
          v = f.default;
        }
      } else {
        const chars = Array.from(raw);
        if (chars.length > f.maxLength) {
          v = chars.slice(0, f.maxLength).join("");
          warnings.push(issue(f.path, "too_long", `${f.path}: ${f.maxLength}文字に切り詰めました`));
        } else v = raw;
      }
    }
    setPath(game, f.path, v);
  }

  // level
  const L = schema.level, lv = input.level;
  if (!Array.isArray(lv) || lv.length === 0 || !lv.every(r => typeof r === "string")) {
    errors.push(issue("level", "level_shape", "level は1行以上の文字列の配列にしてください"));
  } else if (lv.length > L.maxRows) {
    errors.push(issue("level", "level_rows", `level の行数が上限(${L.maxRows})を超えています`));
  } else {
    let replaced = 0, tooWide = false;
    const rows = lv.map(r => Array.from(r).map(c => {
      if (Object.hasOwn(schema.tiles, c)) return c;
      replaced++; return ".";
    }));
    if (rows.some(r => r.length > L.maxCols)) tooWide = true;
    if (tooWide) errors.push(issue("level", "level_cols", `level の1行の長さが上限(${L.maxCols})を超えています`));
    else if (Math.max(...rows.map(r => r.length)) === 0) errors.push(issue("level", "level_empty", "level が空です"));
    else {
      const joined = rows.map(r => r.join(""));
      for (const t of L.requiredTiles) {
        if (!joined.join("").includes(t)) errors.push(issue("level", "level_missing_tile", `${schema.tiles[t].name}(${t})がありません`));
      }
      if (replaced) warnings.push(issue("level", "level_unknown_tile", `未知の記号 ${replaced} 個を "." に置き換えました`));
      const pCount = joined.join("").split("P").length - 1;
      if (pCount > 1) warnings.push(issue("level", "level_multi_start", `開始位置 P が ${pCount} 個あります(最後のものを使います)`));
      game.level = joined;
    }
  }

  // 未知のキー
  const leaf = new Set(schema.fields.map(f => f.path)), branch = new Set();
  leaf.add("level");
  for (const f of schema.fields) { const ks = f.path.split("."); for (let i = 1; i < ks.length; i++) branch.add(ks.slice(0, i).join(".")); }
  const unknown = [];
  findUnknown(input, "", leaf, branch, unknown);
  for (const p of unknown) warnings.push(issue(p, "unknown_key", `${p}: 未対応の項目なので無視しました`));

  const ok = errors.length === 0;
  return { ok, errors, warnings, game: ok ? game : null };
}
