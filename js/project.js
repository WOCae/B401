// プロジェクトファイル(1ファイルに、ゲーム定義JSON+使っているGLB)の書き出しと読み込み。
// 拡張子は .pfmk.json(中身はJSON。GLBは base64)。このファイル1つで元の状態に戻る。
// backend は LocalBackend / サーバー版 api のどちらでもよい(同じメソッドだけを使う)。
import { validateGame } from "./schema.js";
import { inspectGlb, modelRefs } from "./glb.js";

export const FORMAT = "platformer-maker-project";
const MAX_FILE = 60 * 1024 * 1024; // 読み込めるプロジェクトファイルの上限

export function bytesToB64(bytes) {
  const u8 = new Uint8Array(bytes); let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64ToBytes(b64) { const s = atob(b64), u8 = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i); return u8; }

const fileNameOf = title => (String(title).replace(/[\\/:*?"<>|\0]+/g, "").trim().slice(0, 40) || "game") + ".pfmk.json";

/** ゲームを1つのプロジェクト(JSON)にまとめる。ブラウザ内/サーバー上のGLBも埋め込む(サンプルは同梱ファイルなので参照のみ) */
export async function exportProject(backend, gameId) {
  const g = await backend.getGame(gameId), assets = [];
  for (const path of Object.keys(modelRefs(g.game))) {
    if (!path.startsWith("uploads/")) continue;
    try { assets.push({ path, name: path.split("/").pop(), data: bytesToB64(await backend.getAssetBytes(path)) }); } catch { /* 欠けているモデルは省く(プリミティブで表示される) */ }
  }
  const project = { format: FORMAT, version: 1, exportedAt: new Date().toISOString(), title: g.game.meta.title, game: g.game, assets };
  return { blob: new Blob([JSON.stringify(project)], { type: "application/json" }), filename: fileNameOf(g.game.meta.title), version: g.version };
}

/** プロジェクト(JSON文字列/オブジェクト)を検証して新しいゲームとして取り込む。戻り値: 新しいゲームID */
export async function importProject(backend, input) {
  const schema = await backend.getSchema();
  let p = input;
  if (typeof input === "string") {
    if (input.length > MAX_FILE) throw new Error("ファイルが大きすぎます");
    try { p = JSON.parse(input); } catch { throw new Error("プロジェクトファイル(JSON)として読み取れません"); }
  }
  if (!p || typeof p !== "object" || p.format !== FORMAT) throw new Error("このツールのプロジェクトファイルではありません");
  if (typeof p.version !== "number" || p.version > 1) throw new Error("新しい形式のファイルです。ツールを更新してください");
  const v = validateGame(p.game, schema);
  if (!v.ok) throw new Error("ゲーム定義が不正です: " + v.errors.map(e => e.message).join(" / "));
  const assets = Array.isArray(p.assets) ? p.assets : [];
  if (assets.length > schema.uploads.maxFilesPerGame) throw new Error(`同梱のGLBが多すぎます(上限 ${schema.uploads.maxFilesPerGame})`);
  const decoded = new Map();
  for (const a of assets) {
    if (!a || typeof a.path !== "string" || typeof a.data !== "string") continue;
    let bytes; try { bytes = b64ToBytes(a.data); } catch { throw new Error(`${a.path}: GLBのデータが壊れています`); }
    if (bytes.length > schema.uploads.maxBytes) throw new Error(`${a.path}: ファイルサイズが上限(${(schema.uploads.maxBytes / 1048576).toFixed(0)}MB)を超えています`);
    const ins = inspectGlb(bytes, schema.uploads.maxVertices);
    if (!ins.ok) throw new Error(`${a.path}: GLBとして使えません(${ins.errors[0]})`);
    decoded.set(a.path, { name: String(a.name || a.path.split("/").pop()), bytes });
  }
  const id = backend.newGameId ? backend.newGameId() : "g-" + Math.random().toString(16).slice(2, 10);
  const created = await backend.createGame(id, v.game);
  // 同梱GLBを新しいゲームに登録し、JSON内のパスを新しいパスへ置き換える
  const game = JSON.parse(JSON.stringify(created.game)), refs = modelRefs(game);
  for (const [path, a] of decoded) {
    const r = await backend.uploadAsset(id, new File([a.bytes], a.name.endsWith(".glb") ? a.name : a.name + ".glb", { type: "model/gltf-binary" }), null);
    for (const use of refs[path] || []) { const ks = use.split("."), last = ks.pop(); ks.reduce((o, k) => o[k], game)[last] = r.asset.path; }
  }
  if (decoded.size) await backend.saveGame(id, game, created.version, "プロジェクトを開く");
  return id;
}

/** ブラウザでファイルとして保存(ダウンロード) */
export function downloadBlob(blob, filename) {
  const a = document.createElement("a"), url = URL.createObjectURL(blob);
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
