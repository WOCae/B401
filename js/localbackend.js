// ブラウザ保存バックエンド(既定)。サーバー・アカウント不要で、作業は IndexedDB に自動保存される。
// PHP API(api/lib/tools.php)と同じメソッド名・同じ戻り値の形なので、画面側のコードはそのまま使える。
//   games    : {id, title, version, max, updated}      現在の状態
//   versions : {gameId, version, parent, ts, label, game}  履歴(元に戻す用)
//   proposals: {id, gameId, status, source, title, base_version, ops, created}
//   assets   : {gameId, name, bytes(ArrayBuffer), size, mtime, result}  アップロードしたGLB
import { ApiError } from "./api.js";
import { validateGame } from "./schema.js";
import { applyPatchOps } from "./patch.js";
import { inspectGlb, sanitizeAssetName, modelRefs, ASSET_NAME_RE } from "./glb.js";

const DB = "platformer-maker", ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const rid = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, "0")).join("");
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export class LocalBackend {
  constructor() { this.mode = "local"; this.db = null; this.schema = null; this.urls = new Map(); this.sampleCache = null; }

  /* ---------- IndexedDB ---------- */
  async init() {
    if (this.db) return;
    if (!window.indexedDB) throw new ApiError("このブラウザは保存機能(IndexedDB)に対応していません", "no_storage", 0);
    this.db = await new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore("games", { keyPath: "id" });
        d.createObjectStore("versions", { keyPath: ["gameId", "version"] }).createIndex("byGame", "gameId");
        d.createObjectStore("proposals", { keyPath: "id" }).createIndex("byGame", "gameId");
        d.createObjectStore("assets", { keyPath: ["gameId", "name"] }).createIndex("byGame", "gameId");
      };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error("別のタブが保存領域を使用中です"));
    });
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch { /* 無視 */ }
    await this.getSchema(); // トランザクション中に通信しないよう先に読んでおく
  }
  /** 1つのトランザクションで処理する(途中で例外なら全て巻き戻る) */
  tx(stores, mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(stores, mode); let out;
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error("保存に失敗しました"));
      Promise.resolve(fn(t)).then(v => { out = v; }).catch(e => { rej(e); try { t.abort(); } catch { /* 無視 */ } });
    });
  }

  /* ---------- 認証まわり(ブラウザ保存では不要) ---------- */
  async authStatus() { return { authenticated: true, configured: true, dev_open: false, local: true }; }
  async login() { return { authenticated: true }; }
  async logout() { return { authenticated: true }; }

  async getSchema() {
    if (!this.schema) {
      const r = await fetch("schema/game.schema.json");
      if (!r.ok) throw new ApiError("スキーマを読み込めません", "schema", r.status);
      this.schema = await r.json();
    }
    return this.schema;
  }
  newGameId() { return "g-" + rid(4); }

  /* ---------- ゲーム ---------- */
  async listGames() {
    const all = await this.tx(["games"], "readonly", t => req(t.objectStore("games").getAll()));
    all.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
    return { games: all.map(g => ({ game_id: g.id, title: g.title, version: g.version, updated: g.updated })) };
  }
  async getGame(id) {
    const { st, ver } = await this.tx(["games", "versions"], "readonly", async t => {
      const st = await req(t.objectStore("games").get(id)); if (!st) return {};
      return { st, ver: await req(t.objectStore("versions").get([id, st.version])) };
    });
    if (!st || !ver) throw new ApiError(`ゲーム ${id} が見つかりません`, "not_found", 404);
    return { game_id: id, version: st.version, updated: st.updated, game: ver.game };
  }
  async _checked(game) {
    const schema = await this.getSchema(), r = validateGame(game, schema);
    if (!r.ok) throw new ApiError("ゲーム定義が不正です: " + r.errors.map(e => e.message).join(" / "), "invalid_game", 422, { errors: r.errors, warnings: r.warnings });
    return r;
  }
  async createGame(game_id, game) {
    const id = game_id || this.newGameId();
    if (!ID_RE.test(id)) throw new ApiError("game_id は英小文字・数字・-・_ の40文字以内にしてください", "bad_id", 400);
    const schema = await this.getSchema(), r = await this._checked(game || schema.defaultGame);
    await this.tx(["games", "versions", "proposals"], "readwrite", async t => {
      if (await req(t.objectStore("games").get(id))) throw new ApiError(`ゲーム ${id} は既に存在します`, "exists", 409);
      await this._commit(t, id, r.game, "作成", null, { version: 0, max: 0 });
    });
    return { game_id: id, version: 1, game: r.game, warnings: r.warnings };
  }
  /** 新しい版として保存(トランザクション内)。履歴の整理も行う */
  async _commit(t, id, game, label, base, st) {
    if (base !== null && base !== undefined && base !== st.version) throw new ApiError("他の変更と競合しました。再読み込みしてください", "conflict", 409, { current_version: st.version });
    const v = st.max + 1, ts = new Date().toISOString();
    await req(t.objectStore("versions").put({ gameId: id, version: v, parent: st.version, ts, label: String(label).slice(0, 60), game }));
    await req(t.objectStore("games").put({ id, title: game.meta.title, version: v, max: v, updated: ts }));
    await this._prune(t, id, v, v);
    return { version: v, updated: ts };
  }
  async saveGame(id, game, base_version, label = "編集") {
    const r = await this._checked(game);
    const c = await this.tx(["games", "versions", "proposals"], "readwrite", async t => {
      const st = await req(t.objectStore("games").get(id));
      if (!st) throw new ApiError(`ゲーム ${id} が見つかりません`, "not_found", 404);
      return this._commit(t, id, r.game, label, base_version ?? null, st);
    });
    return { game_id: id, version: c.version, game: r.game, warnings: [...r.warnings, ...await this._assetIssues(id, r.game)] };
  }
  async listHistory(id, limit = 50) {
    const { st, all } = await this.tx(["games", "versions"], "readonly", async t => ({ st: await req(t.objectStore("games").get(id)), all: await req(t.objectStore("versions").index("byGame").getAll(id)) }));
    if (!st) throw new ApiError(`ゲーム ${id} が見つかりません`, "not_found", 404);
    all.sort((a, b) => b.version - a.version);
    return { current: st.version, history: all.slice(0, limit).map(h => ({ version: h.version, parent: h.parent, ts: h.ts, label: h.label })) };
  }
  /** 1つ前の版に戻す。履歴は消さず、現在位置だけが親に移る */
  async undoGame(id, base_version) {
    return this.tx(["games", "versions"], "readwrite", async t => {
      const st = await req(t.objectStore("games").get(id));
      if (!st) throw new ApiError(`ゲーム ${id} が見つかりません`, "not_found", 404);
      if (base_version != null && base_version !== st.version) throw new ApiError("他の変更と競合しました", "conflict", 409, { current_version: st.version });
      const cur = await req(t.objectStore("versions").get([id, st.version]));
      if (!cur || cur.parent < 1) throw new ApiError("これ以上戻れません", "no_more_undo", 409);
      const prev = await req(t.objectStore("versions").get([id, cur.parent]));
      if (!prev) throw new ApiError("これ以上戻れません", "no_more_undo", 409);
      await req(t.objectStore("games").put({ ...st, title: prev.game.meta.title, version: cur.parent, updated: new Date().toISOString() }));
      return { game_id: id, version: cur.parent, game: prev.game };
    });
  }
  async deleteGame(id) {
    await this.tx(["games", "versions", "proposals", "assets"], "readwrite", async t => {
      await req(t.objectStore("games").delete(id));
      for (const [name, key] of [["versions", "byGame"], ["proposals", "byGame"], ["assets", "byGame"]]) {
        const s = t.objectStore(name);
        const keys = await req(s.index(key).getAllKeys(id));
        for (const k of keys) await req(s.delete(k));
      }
    });
    for (const [p, u] of [...this.urls]) if (p.startsWith(`uploads/${id}/`)) { URL.revokeObjectURL(u.url); this.urls.delete(p); }
  }

  /** 履歴の整理: 現在から親をたどった経路を最新200版まで残し、古い版・放棄された枝を削除(PHP版と同じ方針) */
  async _prune(t, id, current, max) {
    const H = (await this.getSchema()).history, vs = t.objectStore("versions");
    const all = await req(vs.index("byGame").getAll(id));
    if (all.length > H.keep + H.slack) {
      const byV = new Map(all.map(r => [r.version, r])), keep = new Set(), chain = [];
      for (let v = current; v > 0 && chain.length < H.keep && byV.has(v); v = byV.get(v).parent) chain.push(v);
      chain.forEach(c => keep.add(c));
      for (let r = max; r > max - H.recent && r > 0; r--) keep.add(r);
      for (const r of all) if (!keep.has(r.version)) await req(vs.delete([id, r.version]));
      const oldest = chain.length ? chain[chain.length - 1] : null;
      if (oldest !== null) { const h = byV.get(oldest); if (h.parent !== 0 && !keep.has(h.parent)) await req(vs.put({ ...h, parent: 0 })); }
    }
    const ps = t.objectStore("proposals"), props = await req(ps.index("byGame").getAll(id)), now = Date.now();
    for (const p of props) {
      const age = (now - Date.parse(p.created)) / 86400000;
      if (age > (p.status === "pending" ? H.pendingProposalDays : H.proposalDays)) await req(ps.delete(p.id));
    }
  }

  /* ---------- 提案(AI・規則ベース)。人が承認するまで適用しない ---------- */
  async proposePatch(id, ops, title = "変更提案", source = "rule") {
    const cur = await this.getGame(id);
    let patched;
    try { patched = applyPatchOps(cur.game, ops); } catch (e) { throw new ApiError(e.message, "bad_patch", 400); }
    const r = validateGame(patched, await this.getSchema());
    if (!r.ok) throw new ApiError("この差分を適用するとゲーム定義が不正になります: " + r.errors.map(e => e.message).join(" / "), "invalid_patch", 422, { errors: r.errors });
    const pid = rid(8), rec = { id: pid, gameId: id, status: "pending", source: ["rule", "ai", "human"].includes(source) ? source : "rule", title: String(title).slice(0, 60), base_version: cur.version, ops, created: new Date().toISOString() };
    await this.tx(["proposals"], "readwrite", t => req(t.objectStore("proposals").put(rec)));
    return { proposal_id: pid, game_id: id, title: rec.title, base_version: cur.version, ops, warnings: [...r.warnings, ...await this._assetIssues(id, r.game)] };
  }
  async applyPatch(id, proposal_id) {
    const out = await this.tx(["games", "versions", "proposals"], "readwrite", async t => {
      const p = await req(t.objectStore("proposals").get(proposal_id));
      if (!p || p.gameId !== id) throw new ApiError("提案が見つかりません", "not_found", 404);
      if (p.status !== "pending") throw new ApiError("この提案は既に処理済みです", "not_pending", 409);
      const st = await req(t.objectStore("games").get(id)), cur = await req(t.objectStore("versions").get([id, st.version]));
      if (p.base_version !== st.version) throw new ApiError("提案の作成後にゲームが変更されました。提案をやり直してください", "stale_proposal", 409, { current_version: st.version });
      let patched; try { patched = applyPatchOps(cur.game, p.ops); } catch (e) { throw new ApiError(e.message, "bad_patch", 400); }
      const r = await this._checked(patched);
      const c = await this._commit(t, id, r.game, "提案: " + p.title, st.version, st);
      await req(t.objectStore("proposals").put({ ...p, status: "applied", applied_version: c.version }));
      return { game_id: id, version: c.version, game: r.game, warnings: r.warnings };
    });
    return { ...out, warnings: [...out.warnings, ...await this._assetIssues(id, out.game)] };
  }
  async discardPatch(id, proposal_id) {
    return this.tx(["proposals"], "readwrite", async t => {
      const p = await req(t.objectStore("proposals").get(proposal_id));
      if (!p || p.gameId !== id) throw new ApiError("提案が見つかりません", "not_found", 404);
      if (p.status === "pending") await req(t.objectStore("proposals").put({ ...p, status: "discarded" }));
      return { proposal_id, status: p.status === "pending" ? "discarded" : p.status };
    });
  }

  /* ---------- アセット(GLB)。パスは uploads/<ゲームID>/<名前>.glb(サーバー版と同じ形) ---------- */
  async _assetIssues(id, game) {
    const out = [];
    for (const [path, uses] of Object.entries(modelRefs(game))) {
      const m = /^uploads\/([^/]+)\/([^/]+)$/.exec(path);
      if (!m) continue; // サンプル等の静的ファイルは読み込み時に確認される
      const a = m[1] === id ? await this.tx(["assets"], "readonly", t => req(t.objectStore("assets").get([id, m[2]]))) : null;
      if (!a) for (const u of uses) out.push({ path: u, code: "asset_missing", message: `${path} が見つかりません(プリミティブで表示します)` });
    }
    return out;
  }
  async _samples() {
    if (!this.sampleCache) {
      this.sampleCache = [];
      try {
        const idx = await (await fetch("assets/samples/index.json")).json();
        for (const m of idx.models) {
          const r = await fetch(m.path); if (!r.ok) continue;
          const buf = await r.arrayBuffer(), res = inspectGlb(buf, (await this.getSchema()).uploads.maxVertices);
          this.sampleCache.push({ name: m.path.split("/").pop(), path: m.path, size: buf.byteLength, mtime: 0, editable: false, valid: res.ok, errors: res.errors, info: res.info });
        }
      } catch { /* サンプルは任意 */ }
    }
    return this.sampleCache;
  }
  async listAssets(id) {
    const schema = await this.getSchema(), refs = modelRefs((await this.getGame(id)).game);
    const rows = await this.tx(["assets"], "readonly", t => req(t.objectStore("assets").index("byGame").getAll(id)));
    const uploads = rows.map(a => ({ name: a.name, path: `uploads/${id}/${a.name}`, size: a.size, mtime: a.mtime, editable: true, valid: a.result.ok, errors: a.result.errors, info: a.result.info, used_by: refs[`uploads/${id}/${a.name}`] || [] }));
    uploads.sort((x, y) => y.mtime - x.mtime);
    const samples = (await this._samples()).map(s => ({ ...s, used_by: refs[s.path] || [] }));
    return { uploads, samples, limits: schema.uploads };
  }
  async uploadAsset(id, file, replace = null) {
    const L = (await this.getSchema()).uploads;
    await this.getGame(id);
    if (!/\.glb$/i.test(file.name)) throw new ApiError("拡張子は .glb のみ受け付けます", "bad_extension", 415);
    if (file.size <= 0 || file.size > L.maxBytes) throw new ApiError(`ファイルサイズは ${(L.maxBytes / 1048576).toFixed(1)}MB 以下にしてください`, "too_large", 413);
    const bytes = await file.arrayBuffer(), ins = inspectGlb(bytes, L.maxVertices);
    if (!ins.ok) throw new ApiError("GLBとして使えません: " + ins.errors.join(" / "), "invalid_glb", 422, { errors: ins.errors });
    const existing = await this.tx(["assets"], "readonly", t => req(t.objectStore("assets").index("byGame").getAll(id)));
    let name;
    if (replace) {
      if (!ASSET_NAME_RE.test(replace) || !existing.some(a => a.name === replace)) throw new ApiError("差し替え対象が見つかりません", "not_found", 404);
      name = replace;
    } else {
      if (existing.length >= L.maxFilesPerGame) throw new ApiError(`1ゲームあたり ${L.maxFilesPerGame} ファイルまでです。不要なものを削除してください`, "quota", 409);
      if (existing.reduce((s, a) => s + a.size, 0) + file.size > L.maxTotalBytesPerGame) throw new ApiError("このゲームのアップロード容量の上限を超えます", "quota", 409);
      name = sanitizeAssetName(file.name);
    }
    const rec = { gameId: id, name, bytes, size: bytes.byteLength, mtime: Math.floor(Date.now() / 1000), result: ins };
    try { await this.tx(["assets"], "readwrite", t => req(t.objectStore("assets").put(rec))); }
    catch (e) { throw new ApiError("保存できませんでした(ブラウザの保存容量が足りない可能性があります)", "write_failed", 500); }
    const path = `uploads/${id}/${name}`, old = this.urls.get(path);
    if (old) { URL.revokeObjectURL(old.url); this.urls.delete(path); }
    const refs = modelRefs((await this.getGame(id)).game);
    return { asset: { name, path, size: rec.size, mtime: rec.mtime, editable: true, valid: true, errors: [], info: ins.info, used_by: refs[path] || [] }, replaced: !!replace };
  }
  async deleteAsset(id, name) {
    if (!ASSET_NAME_RE.test(name)) throw new ApiError("ファイル名が不正です", "bad_name", 400);
    const path = `uploads/${id}/${name}`, use = modelRefs((await this.getGame(id)).game)[path] || [];
    if (use.length) throw new ApiError(`使用中のため削除できません(${use.join(", ")})。先にモデルの指定を外してください`, "in_use", 409, { used_by: use });
    const had = await this.tx(["assets"], "readwrite", async t => { const a = await req(t.objectStore("assets").get([id, name])); if (a) await req(t.objectStore("assets").delete([id, name])); return !!a; });
    if (!had) throw new ApiError("ファイルが見つかりません", "not_found", 404);
    const u = this.urls.get(path); if (u) { URL.revokeObjectURL(u.url); this.urls.delete(path); }
    return { deleted: name };
  }
  /** GLTFLoader に渡すURL。ブラウザ内に保存したGLBは Blob URL にする(それ以外はそのままのパス) */
  async resolveUrl(path) {
    const m = /^uploads\/([^/]+)\/([^/]+)$/.exec(path);
    if (!m) return path;
    const a = await this.tx(["assets"], "readonly", t => req(t.objectStore("assets").get([m[1], m[2]])));
    if (!a) return path; // 無ければそのまま → 読み込みに失敗して警告され、プリミティブで表示
    const c = this.urls.get(path);
    if (c && c.mtime === a.mtime) return c.url;
    if (c) URL.revokeObjectURL(c.url);
    const url = URL.createObjectURL(new Blob([a.bytes], { type: "model/gltf-binary" }));
    this.urls.set(path, { url, mtime: a.mtime }); return url;
  }
  /** プロジェクトファイルへの書き出し用: アセットの中身 */
  async getAssetBytes(path) {
    const m = /^uploads\/([^/]+)\/([^/]+)$/.exec(path);
    if (m) { const a = await this.tx(["assets"], "readonly", t => req(t.objectStore("assets").get([m[1], m[2]]))); if (!a) throw new ApiError(`${path} が見つかりません`, "not_found", 404); return a.bytes; }
    const r = await fetch(path); if (!r.ok) throw new ApiError(`${path} を読み込めません`, "not_found", r.status);
    return r.arrayBuffer();
  }
}
