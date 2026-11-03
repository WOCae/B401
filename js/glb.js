// GLB(.glb)の検証と、ゲームJSONが参照するモデルの一覧。純粋関数(DOM・fetch非依存)。
// ブラウザ保存モードの取り込みとプロジェクトファイルの読み込みで使う。
// PHP側 api/lib/assets.php の inspect_glb() / sanitize_asset_name() / model_refs() と同じ規則(テストで一致を確認)。
export const UNSUPPORTED_EXT = ["KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_texture_basisu"];
export const ASSET_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,60}\.glb$/;

const hasBytes = (u8, str) => { // 文字列(ASCII)がバイト列に含まれるか
  const p = Array.from(str, c => c.charCodeAt(0));
  outer: for (let i = 0; i + p.length <= u8.length; i++) { if (u8[i] !== p[0]) continue; for (let k = 1; k < p.length; k++) if (u8[i + k] !== p[k]) continue outer; return true; }
  return false;
};
const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);

/** @returns {{ok:boolean, errors:string[], info:object}} */
export function inspectGlb(buf, maxVertices = 300000) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf), size = u8.length, dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const empty = () => ({ animations: [], meshes: 0, nodes: 0, materials: 0, textures: 0, vertices: 0 });
  const fail = (...e) => ({ ok: false, errors: e, info: empty() });
  if (size < 28) return fail("ファイルを読み取れません(小さすぎます)");
  if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== "glTF") return fail("GLBファイルではありません(先頭が glTF ではありません)");
  const err = [];
  if (dv.getUint32(4, true) !== 2) err.push("glTF 2.0 のGLBのみ対応です");
  if (dv.getUint32(8, true) !== size) err.push("ファイルサイズがヘッダと一致しません(壊れているか途中で切れています)");
  if (err.length) return fail(...err);
  const jlen = dv.getUint32(12, true), jtype = dv.getUint32(16, true);
  if (jtype !== 0x4e4f534a || 20 + jlen > size) return fail("JSONチャンクが不正です");
  let json;
  try { json = JSON.parse(new TextDecoder().decode(u8.subarray(20, 20 + jlen))); } catch { json = null; }
  if (!isObj(json) || json.asset == null || json.asset.version == null || !String(json.asset.version).startsWith("2")) return fail("glTFのJSONが読み取れません");
  const off = 20 + jlen;
  if (off < size) {
    if (off + 8 > size) return fail("BINチャンクが不正です");
    const blen = dv.getUint32(off, true), btype = dv.getUint32(off + 4, true);
    if (btype !== 0x004e4942 || off + 8 + blen > size) return fail("BINチャンクが不正です");
  }
  for (const k of ["buffers", "images"]) for (const e of json[k] || []) {
    if (e && e.uri != null && !String(e.uri).startsWith("data:")) err.push(`外部ファイルを参照しています(${k}): 自己完結したGLBにしてください`);
  }
  for (const x of json.extensionsRequired || []) if (UNSUPPORTED_EXT.includes(x)) err.push(`未対応の圧縮拡張 ${x} が必須です(圧縮なしで書き出してください)`);
  if (hasBytes(u8, "<?php") || hasBytes(u8, "<?=")) err.push("不正な内容が含まれています");
  let verts = 0;
  for (const m of json.meshes || []) for (const p of m.primitives || []) {
    const ai = p && p.attributes ? p.attributes.POSITION : null;
    if (Number.isInteger(ai) && json.accessors && json.accessors[ai] && json.accessors[ai].count != null) verts += json.accessors[ai].count | 0;
  }
  if (verts > maxVertices) err.push(`頂点数が多すぎます(${verts} > ${maxVertices})`);
  const info = {
    animations: (json.animations || []).map(a => String((a && a.name) ?? "")),
    meshes: (json.meshes || []).length, nodes: (json.nodes || []).length, materials: (json.materials || []).length, textures: (json.textures || []).length, vertices: verts,
  };
  return { ok: err.length === 0, errors: err, info };
}

/** 元のファイル名から安全な名前の「本体部分」(小文字英数と-_のみ)。末尾の乱数と .glb は呼び出し側で付ける */
export function sanitizeBase(orig) {
  const file = String(orig).replace(/\0/g, "").replace(/^.*[\\/]/, "");
  const dot = file.lastIndexOf(".");
  let base = (dot > 0 ? file.slice(0, dot) : file).replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase().replace(/-{2,}/g, "-").replace(/^[-_]+|[-_]+$/g, "");
  if (base === "") base = "model";
  return base.slice(0, 40);
}
export function sanitizeAssetName(orig, rand = () => Array.from(crypto.getRandomValues(new Uint8Array(3)), b => b.toString(16).padStart(2, "0")).join("")) {
  return `${sanitizeBase(orig)}-${rand()}.glb`;
}

/** ゲームが参照するモデルのパス => 使用箇所(assets.player.model 等) */
export function modelRefs(game) {
  const refs = {}, a = (game && game.assets) || {};
  const add = (p, use) => { if (typeof p === "string") (refs[p] ||= []).push(use); };
  for (const w of ["player", "enemy"]) add(a[w] && a[w].model, `assets.${w}.model`);
  for (const [sym, t] of Object.entries(a.tiles || {})) add(t && t.model, `assets.tiles.${sym}.model`);
  return refs;
}
