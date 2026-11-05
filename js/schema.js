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
const ID_RE = /^[a-z][a-z0-9_]{0,23}$/;

/** 1つの値を検証して(丸め・既定値で)正規化する。fields と collections の itemFields で共通 */
function checkField(f, raw, path, warnings) {
  if (raw === undefined) return f.default;
  if (raw === null && f.nullable) return null;
  if (f.type === "enum") {
    if (typeof raw === "string" && f.values.includes(raw)) return raw;
    warnings.push(issue(path, "type", `${path}: ${f.values.join(" / ")} のいずれかにしてください。既定値 ${f.default} を使います`));
    return f.default;
  }
  if (f.type === "bool") {
    if (typeof raw === "boolean") return raw;
    warnings.push(issue(path, "type", `${path}: true / false にしてください。既定値 ${f.default} を使います`));
    return f.default;
  }
  if (f.type === "number") {
    if (typeof raw !== "number" || !Number.isFinite(raw)) { warnings.push(issue(path, "type", `${path}: 数値ではないため既定値 ${f.default} を使います`)); return f.default; }
    const v = Math.min(f.max, Math.max(f.min, raw));
    if (v !== raw) warnings.push(issue(path, "clamped", `${path}: ${raw} は範囲外のため ${v} に丸めました(${f.min}〜${f.max})`));
    return v;
  }
  if (f.type === "color") {
    if (typeof raw === "string" && COLOR.test(raw)) return raw;
    warnings.push(issue(path, "type", `${path}: #rrggbb 形式ではないため既定値 ${f.default} を使います`));
    return f.default;
  }
  if (f.type === "symbol") return raw; // 記号は一覧全体の整合(重複・予約)を見てから決める
  // string
  if (typeof raw !== "string") { warnings.push(issue(path, "type", `${path}: 文字列ではないため既定値を使います`)); return f.default; }
  if (raw === "") return f.default;
  if (f.pattern) { // パス等: 切り詰めず、長すぎ・不正は既定値に戻す
    if (Array.from(raw).length <= f.maxLength && new RegExp(f.pattern).test(raw)) return raw;
    warnings.push(issue(path, "bad_format", `${path}: 使えない形式です(例: assets/samples/player.glb)。既定値に戻します`));
    return f.default;
  }
  const chars = Array.from(raw);
  if (chars.length > f.maxLength) { warnings.push(issue(path, "too_long", `${path}: ${f.maxLength}文字に切り詰めました`)); return chars.slice(0, f.maxLength).join(""); }
  return raw;
}

function findUnknown(obj, prefix, leaf, branch, out) {
  for (const k of Object.keys(obj)) {
    const p = prefix ? prefix + "." + k : k;
    if (leaf.has(p)) continue;
    if (branch.has(p) && isObj(obj[k])) findUnknown(obj[k], p, leaf, branch, out);
    else out.push(p);
  }
}

/**
 * 古い形式のゲーム定義を新しい形式へ変換する(入力は書き換えない)。
 *   v1 → v2: enemy.speed を enemyTypes.walker.speed へ移す(敵の種類が一覧になったため)
 * schemaVersion が 1 のスキーマ(サーバー保存モード)では何もしない。
 */
export function migrate(input, schema) {
  if (!isObj(input) || (schema.schemaVersion || 1) < 2) return input;
  const v = input.formatVersion;
  if (typeof v === "number" && v >= 2) return input;
  const o = clone(input);
  if (isObj(o.enemy) && o.enemy.speed !== undefined && o.enemyTypes === undefined) {
    const coll = schema.collections.find(c => c.path === "enemyTypes");
    o.enemyTypes = clone(coll.defaultValue);
    o.enemyTypes.walker.speed = o.enemy.speed;
    delete o.enemy.speed;
    if (!Object.keys(o.enemy).length) delete o.enemy;
  }
  o.formatVersion = 2;
  return o;
}

/** 一覧(enemyTypes / items)の検証。記号は、全ての一覧がそろってから resolveSymbols で決める */
function checkCollection(coll, raw, schema, warnings) {
  const out = {};
  const src = raw === undefined ? coll.defaultValue : raw;
  if (!isObj(src)) { warnings.push(issue(coll.path, "type", `${coll.path}: オブジェクトではないため既定値を使います`)); return checkCollection(coll, undefined, schema, warnings); }
  let n = 0;
  for (const [id, entry] of Object.entries(src)) {
    const at = `${coll.path}.${id}`;
    if (!ID_RE.test(id)) { warnings.push(issue(at, "bad_id", `${at}: ID は英小文字で始まる英小文字・数字・_ の24文字以内にしてください。無視しました`)); continue; }
    if (++n > coll.max) { warnings.push(issue(at, "too_many", `${coll.path}: 上限(${coll.max})を超えたため ${id} を無視しました`)); continue; }
    if (!isObj(entry)) { warnings.push(issue(at, "type", `${at}: オブジェクトではないため無視しました`)); continue; }
    const e = {};
    for (const f of coll.itemFields) e[f.key] = checkField(f, entry[f.key], `${at}.${f.key}`, warnings);
    for (const k of Object.keys(entry)) if (!coll.itemFields.some(f => f.key === k)) warnings.push(issue(`${at}.${k}`, "unknown_key", `${at}.${k}: 未対応の項目なので無視しました`));
    e.symbol = entry.symbol; // 候補(resolveSymbols で確定する)
    out[id] = e;
  }
  return out;
}

/**
 * 記号の確定: ① 指定された記号が使えて(1文字・使える文字・予約でない)他と重複しなければそのまま(先に書かれたものを優先)
 *             ② それ以外は、空いている記号を割り当てる(空きがなければその項目を無視)
 * 明示された記号を先に全部確定するので、自動割り当てが他の項目の指定を横取りしない。
 */
function resolveSymbols(colls, game, schema, warnings) {
  const pool = Array.from(schema.symbols.pool), used = new Set(Array.from(schema.symbols.reserved)), todo = [];
  for (const c of colls) for (const [id, e] of Object.entries(game[c.path])) {
    const sym = e.symbol;
    if (typeof sym === "string" && Array.from(sym).length === 1 && pool.includes(sym) && !used.has(sym)) used.add(sym);
    else todo.push([c, id, e, sym]);
  }
  for (const [c, id, e, orig] of todo) {
    const at = `${c.path}.${id}`, free = pool.find(ch => !used.has(ch));
    if (free === undefined) { warnings.push(issue(`${at}.symbol`, "no_symbol", `${at}: 使える記号がないため ${id} を無視しました`)); delete game[c.path][id]; continue; }
    if (orig !== undefined) warnings.push(issue(`${at}.symbol`, "symbol_changed", `${at}.symbol: 記号 ${JSON.stringify(orig)} は使えない(重複・予約・不正)ため ${free} にしました`));
    used.add(free); e.symbol = free;
  }
}

/**
 * ゲーム定義を検証して正規化する。
 * 戻り値: { ok, errors:[{path,code,message}], warnings:[...], game|null }
 * - 範囲外の数値は丸め(warning)、型違いは既定値(warning)
 * - 構造が壊れている場合は errors(game=null)
 * - 古い形式(v1)は自動で新しい形式へ変換する(migrate)
 */
export function validateGame(rawInput, schema) {
  const errors = [], warnings = [];
  if (isObj(rawInput) && typeof rawInput.formatVersion === "number" && rawInput.formatVersion > (schema.formatVersion || 1)) {
    return { ok: false, errors: [issue("formatVersion", "future_version", `新しい形式(v${rawInput.formatVersion})のゲームです。ツールを更新してください`)], warnings, game: null };
  }
  const input = migrate(rawInput, schema);
  if (!isObj(input)) {
    return { ok: false, errors: [issue("", "not_object", "ゲーム定義はJSONオブジェクトにしてください")], warnings, game: null };
  }
  const game = {};
  if ((schema.schemaVersion || 1) >= 2) game.formatVersion = schema.formatVersion;
  for (const f of schema.fields) setPath(game, f.path, checkField(f, getPath(input, f.path), f.path, warnings));

  // 一覧(敵の種類・アイテム): 記号は基本の記号と重複できない
  const collections = schema.collections || [];
  for (const coll of collections) game[coll.path] = checkCollection(coll, input[coll.path], schema, warnings);
  if (collections.length) resolveSymbols(collections, game, schema, warnings);

  // level(使える記号 = 基本の記号 + 一覧が持つ記号)
  const L = schema.level, lv = input.level;
  const allowed = new Set([...Object.keys(schema.tiles), ...collections.flatMap(c => Object.values(game[c.path]).map(e => e.symbol))]);
  if (!Array.isArray(lv) || lv.length === 0 || !lv.every(r => typeof r === "string")) {
    errors.push(issue("level", "level_shape", "level は1行以上の文字列の配列にしてください"));
  } else if (lv.length > L.maxRows) {
    errors.push(issue("level", "level_rows", `level の行数が上限(${L.maxRows})を超えています`));
  } else {
    let replaced = 0;
    const rows = lv.map(r => Array.from(r).map(c => { if (allowed.has(c)) return c; replaced++; return "."; }));
    if (rows.some(r => r.length > L.maxCols)) errors.push(issue("level", "level_cols", `level の1行の長さが上限(${L.maxCols})を超えています`));
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
  leaf.add("level"); leaf.add("formatVersion");
  for (const f of schema.fields) { const ks = f.path.split("."); for (let i = 1; i < ks.length; i++) branch.add(ks.slice(0, i).join(".")); }
  for (const c of collections) leaf.add(c.path); // 一覧の中身は checkCollection が見る
  const unknown = [];
  findUnknown(input, "", leaf, branch, unknown);
  for (const p of unknown) warnings.push(issue(p, "unknown_key", `${p}: 未対応の項目なので無視しました`));

  const ok = errors.length === 0;
  return { ok, errors, warnings, game: ok ? game : null };
}
