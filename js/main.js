// アプリ本体: 状態管理・ダッシュボード・メインループ。
// ゲーム定義 app.game は「検証済みJSON」だけを保持し、壊れた入力は受け付けず直前の状態を保つ。
import { api as serverApi, ApiError } from "./api.js";
import { LocalBackend } from "./localbackend.js";
import { exportProject, importProject, downloadBlob } from "./project.js";
import { validateGame, clone } from "./schema.js";
import { diagnose } from "./diagnose.js";
import { applyPatchOps, describeOp } from "./patch.js";
import { Engine, advance } from "./engine.js";
import { draw2d } from "./render2d.js";
import { drawHud } from "./hud.js";
import { bindInput } from "./input.js";
import { SUGGESTION_GROUPS } from "./suggest.js";
import { initAssets, modelPathsOf } from "./assets.js";
import { StageEditor } from "./stageeditor.js";
import { drawThumb } from "./thumb.js";
import { buildInspector, initHierarchy, initTabs, initTheme, initFit } from "./editor.js";

const $ = id => document.getElementById(id);
// 保存先: 既定は「このブラウザ内(IndexedDB)」。サーバー(PHP+ログイン)に保存したいときだけ URL に ?server=1 を付ける
const MODE = new URLSearchParams(location.search).has("server") ? "server" : "local";
const api = MODE === "server" ? serverApi : new LocalBackend();
const genId = () => (api.newGameId ? api.newGameId() : "g-" + Math.random().toString(16).slice(2, 10));
const app = { schema: null, gameId: null, version: 0, game: null, engine: null, proposal: null, assets: null, assetVersions: {} };
let assetsUI = null, modelSig = "", openTab = () => {}, editor = null;
const keys = { l: 0, r: 0, j: 0, jp: false };
const ctx = $("cv").getContext("2d");

/* ---------- 表示ヘルパー ---------- */
let statusTimer = 0;
function say(msg, kind = "info", ms = 4000) {
  const el = $("status");
  el.textContent = msg; el.className = "show " + kind;
  clearTimeout(statusTimer);
  if (ms) statusTimer = setTimeout(() => { el.className = ""; }, ms);
}
const fail = e => say(e instanceof ApiError || e instanceof Error ? e.message : String(e), "err", 8000);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- ゲーム定義の差し替え(検証に通ったものだけ) ---------- */
function setGame(raw, { restart = true, version } = {}) {
  const v = validateGame(raw, app.schema);
  if (!v.ok) throw new Error(v.errors.map(e => e.message).join(" / "));
  app.game = v.game;
  if (version !== undefined) app.version = version;
  if (!app.engine) app.engine = new Engine(app.game);
  else if (restart) app.engine.load(app.game, true);
  else app.engine.setDef(app.game); // 位置・敵・コインはそのまま、定義だけ差し替える
  syncUI();
  const ms = modelPathsOf(app.game);
  if (ms !== modelSig) { modelSig = ms; if (assetsUI) assetsUI.refresh(); }
  renderBackup();
  if (editor) editor.sync(); // ステージ編集中に他の経路(元に戻す・JSON・提案)で変わったら取り込む
  return v;
}

/* ---------- パラメータ調整・表示設定(スキーマのフィールドから自動生成) ---------- */
// group が "view" のフィールド=表示・カメラ・見た目、それ以外の slider=物理などのパラメータ
const pathGet = (g, p) => p.split(".").reduce((a, k) => a[k], g);
const idOf = p => p.replace(/\./g, "_").replace(/#/g, "wall").replace(/\^/g, "spike");
const setField = (path, v) => { const ks = path.split("."), last = ks.pop(); pathGet(app.game, ks.join("."))[last] = v; };
const refreshers = [];
function setPathOn(o, path, v) { const ks = path.split("."), last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; }
function buildControls(container, fields) {
  container.innerHTML = "";
  for (const f of fields) {
    const id = "c_" + idOf(f.path), r = document.createElement("div"); r.className = "row";
    const live = v => { setField(f.path, v); if (f.group === "hitbox") app.engine.restart(); renderDiag(); syncJson(); };
    const commit = () => commitGame(app.game, `${f.label}を調整`, { restart: false });
    if (f.type === "number") {
      r.innerHTML = `<label for="${id}">${esc(f.label)}</label><input type="range" id="${id}" min="${f.min}" max="${f.max}" step="${f.step}"><output></output>`;
      const inp = r.querySelector("input"), out = r.querySelector("output");
      inp.addEventListener("input", () => { out.textContent = inp.value; live(+inp.value); });
      inp.addEventListener("change", () => { inp.blur(); commit(); });
      refreshers.push(() => { const v = pathGet(app.game, f.path); inp.value = v; out.textContent = v; });
    } else if (f.type === "enum") {
      r.innerHTML = `<label for="${id}">${esc(f.label)}</label><select id="${id}">${f.values.map((v, i) => `<option value="${esc(v)}">${esc(f.valueLabels[i])}</option>`).join("")}</select><span></span>`;
      const sel = r.querySelector("select");
      sel.addEventListener("change", () => { live(sel.value); sel.blur(); commit(); });
      refreshers.push(() => { sel.value = pathGet(app.game, f.path); });
    } else if (f.type === "bool") {
      r.innerHTML = `<label for="${id}">${esc(f.label)}</label><input type="checkbox" id="${id}" style="justify-self:start"><span></span>`;
      const cb = r.querySelector("input");
      cb.addEventListener("change", () => { live(cb.checked); cb.blur(); commit(); });
      refreshers.push(() => { cb.checked = pathGet(app.game, f.path); });
    } else if (f.type === "string" && f.pattern !== undefined || f.type === "string" && f.nullable) {
      const isModel = f.path.endsWith(".model"), who = f.path.split(".")[1];
      const list = isModel ? "modelList" : (f.path.includes(".anim.") ? "clips_" + who : "");
      r.className = "row wide";
      r.innerHTML = `<label for="${id}">${esc(f.label)}</label><input type="text" id="${id}" ${list ? `list="${list}"` : ""} maxlength="${f.maxLength}" placeholder="${isModel ? "assets/samples/player.glb" : "自動"}" autocomplete="off" spellcheck="false">`;
      const ti = r.querySelector("input");
      ti.addEventListener("change", () => { // 空なら未指定(null)。形式が不正なら検証が既定値に戻す
        const v = ti.value.trim();
        const g = clone(app.game); setPathOn(g, f.path, v === "" ? null : v);
        ti.blur(); commitGame(g, `${f.label}を変更`, { restart: false });
      });
      refreshers.push(() => { const v = pathGet(app.game, f.path); ti.value = v === null ? "" : v; });
    } else if (f.type === "color") {
      r.innerHTML = `<label for="${id}">${esc(f.label)}</label><input type="color" id="${id}" style="justify-self:start"><span></span>`;
      const ci = r.querySelector("input"), tail = r.querySelector("span");
      const TILE_DEFAULT = { "#": () => app.game.theme.ground, "^": () => "#4a4f57", o: () => "#f5b800", G: () => "#d9342b" };
      const fallback = () => f.path === "assets.player.primitive.color" ? app.game.theme.player : (f.path.startsWith("assets.tiles.") ? TILE_DEFAULT[f.path.split(".")[2]]() : "#000000");
      ci.addEventListener("input", () => live(ci.value));
      ci.addEventListener("change", () => { updateTail(); commit(); });
      let rb = null;
      const updateTail = () => {
        tail.innerHTML = ""; if (!f.nullable) return;
        if (pathGet(app.game, f.path) === null) { tail.textContent = f.path.startsWith("assets.tiles.") ? "標準" : "テーマ色"; tail.className = "mute"; return; }
        rb = document.createElement("button"); rb.className = "mini"; rb.textContent = "×"; rb.title = "テーマ色に戻す";
        rb.onclick = () => { live(null); updateTail(); ci.value = fallback(); commit(); };
        tail.appendChild(rb);
      };
      refreshers.push(() => { const v = pathGet(app.game, f.path); ci.value = v === null ? fallback() : v; updateTail(); });
    }
    container.appendChild(r);
  }
}
function syncUI() {
  refreshers.forEach(fn => fn()); renderDiag(); syncJson();
  const m = app.game.render.mode; $("mode2d").classList.toggle("on", m === "2d"); $("mode3d").classList.toggle("on", m === "3d");
}
/** 画面のどこからでも同じ経路で1項目を編集する(値を反映→サーバーに保存して履歴に残す) */
function editField(path, value, label) { setField(path, value); syncUI(); return commitGame(app.game, label, { restart: false }); }
$("mode2d").onclick = () => editField("render.mode", "2d", "表示モードを2Dに");
$("mode3d").onclick = () => editField("render.mode", "3d", "表示モードを3Dに");
function syncJson() { if (document.activeElement !== $("json")) $("json").value = JSON.stringify(app.game, null, 1); }
function renderDiag() {
  const d = diagnose(app.game, app.schema);
  const ok = d.gapsClearable;
  $("diag").innerHTML = `<div>ジャンプの高さ: 約${d.jumpHeightTiles.toFixed(1)}タイル / 距離: 約${d.jumpDistanceTiles.toFixed(1)}タイル</div>
 <div>ステージ内で最も広い穴: ${d.widestGapTiles}タイル</div>
 <div class="${ok ? "ok" : "warn"}">${ok ? "✓ すべての穴を飛び越せる見込みです。" : "⚠ 穴がジャンプ距離を超えています。クリアできない可能性があります。"}</div>
 <div class="mute">計算上の目安です。AI生成ステージはこの検証に通るまで再生成します。</div>`;
}

/* ---------- ファイルへの保存/読み込み(バックアップ・共有) ---------- */
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 保存できなくても動く */ } };
function renderBackup() { // ブラウザ内の自動保存だけだと、ブラウザのデータ消去で失われるため、ファイル保存の有無を示す
  const el = $("backupState");
  if (MODE !== "local" || !app.gameId) { el.textContent = ""; return; }
  const ok = +lsGet("exported:" + app.gameId) === app.version;
  el.textContent = ok ? "ファイル保存済み" : "● ファイル未保存"; el.className = ok ? "ok" : "warn";
  el.title = ok ? "この状態はファイルに保存済みです" : "ブラウザの自動保存とは別に、ファイルにも保存しておくと安心です(保存ボタン / Ctrl+S)";
}
async function doSave() {
  try {
    const r = await exportProject(api, app.gameId);
    downloadBlob(r.blob, r.filename); lsSet("exported:" + app.gameId, String(r.version)); renderBackup();
    say(`保存しました: ${r.filename}(GLBも含みます)`);
  } catch (e) { fail(e); }
}
async function doOpen(file) {
  if (!file) return;
  try {
    if (file.size > 60 * 1024 * 1024) throw new Error("ファイルが大きすぎます(上限60MB)");
    const id = await importProject(api, await file.text());
    await refreshGames(id); await openGame(id);
    say(`開きました: ${app.game.meta.title}(新しいゲームとして追加。元のゲームはそのまま残っています)`);
  } catch (e) { say("開けませんでした: " + e.message, "err", 9000); }
}
$("saveBtn").onclick = doSave;
$("openFile").onchange = e => { doOpen(e.target.files[0]); e.target.value = ""; };
addEventListener("dragover", e => { if ([...(e.dataTransfer?.types || [])].includes("Files")) e.preventDefault(); });
addEventListener("drop", e => { const f = e.dataTransfer?.files?.[0]; if (f) { e.preventDefault(); doOpen(f); } });
addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); if (app.gameId) doSave(); } });
$("playBtn").onclick = () => { if (app.gameId) window.open(`play.html?game=${encodeURIComponent(app.gameId)}${MODE === "server" ? "&server=1" : ""}`, "_blank", "noopener"); };

/* ---------- ログイン(サーバー保存モードのみ: 閲覧は公開・編集は要ログイン) ---------- */
app.auth = { authenticated: false, configured: true, dev_open: false };
function renderAuth() {
  const a = app.auth, st = $("authState");
  if (a.local) { st.className = "edit"; st.textContent = "自動保存(このブラウザ内)"; $("authBtn").style.display = "none"; return; }
  st.className = a.authenticated ? "edit" : "view";
  st.textContent = a.dev_open ? "開発モード" : a.authenticated ? "編集できます" : a.configured ? "閲覧のみ" : "閲覧のみ(パスワード未設定)";
  $("authBtn").style.display = a.dev_open ? "none" : "";
  $("authBtn").textContent = a.authenticated ? "ログアウト" : "ログイン";
}
async function refreshAuth() { try { app.auth = await api.authStatus(); } catch { /* 取得できなくても閲覧はできる */ } renderAuth(); }
function openLogin(msg) {
  if (!app.auth.configured) { say("管理者パスワードが未設定のため編集できません。README の「認証の設定」を参照してください", "err", 10000); return; }
  const d = $("loginDlg"); if (d.open) return;
  $("loginErr").textContent = msg || ""; $("loginPw").value = ""; d.showModal(); $("loginPw").focus();
}
window.addEventListener("pm-unauthorized", () => { app.auth.authenticated = false; renderAuth(); openLogin("ログインが必要です(操作は反映されていません)"); });
$("loginCancel").onclick = () => $("loginDlg").close();
$("loginForm").onsubmit = async e => {
  e.preventDefault(); $("loginOk").disabled = true; $("loginErr").textContent = "";
  try { await api.login($("loginPw").value); $("loginPw").value = ""; $("loginDlg").close(); await refreshAuth(); if (!app.gameId) { location.reload(); return; } say("ログインしました。もう一度操作してください"); }
  catch (err) { $("loginErr").textContent = err.message; }
  finally { $("loginOk").disabled = false; }
};
$("authBtn").onclick = async () => {
  if (app.auth.authenticated) { try { await api.logout(); } catch (e) { fail(e); } await refreshAuth(); say("ログアウトしました"); } else openLogin();
};

/* ---------- 保存・元に戻す(サーバーに履歴を残す) ---------- */
// 書き込み系は1つずつ順番に実行する(連続操作でも版の競合が起きない)
let chain = Promise.resolve();
const serial = fn => (chain = chain.then(fn, fn));
function commitGame(game, label, { restart }) {
  return serial(async () => {
  try {
    const r = await api.saveGame(app.gameId, game, app.version, label);
    setGame(r.game, { restart, version: r.version });
    warnAssets(r.warnings);
    return r;
  } catch (e) {
    fail(e);
    await reload(false); // サーバー上の直前の状態に戻す
  }
  });
}
function warnAssets(warnings = []) { // サーバーが調べたモデルの有無・GLBヘッダの警告
  const w = warnings.filter(x => x.code.startsWith("asset_") || x.code === "bad_format");
  if (w.length) say(w.map(x => x.message).join(" / "), "err", 9000);
}
/** ステージ編集の1ストローク=1つの履歴。保存時の最新ゲームにレベルだけを差し替えて送る */
function commitLevel(rows, label) {
  return serial(async () => {
    try {
      const g = clone(app.game); g.level = rows;
      const r = await api.saveGame(app.gameId, g, app.version, label);
      setGame(r.game, { restart: true, version: r.version });
    } catch (e) { fail(e); await reload(true).catch(() => {}); }
  });
}
async function reload(restart = true) {
  const r = await api.getGame(app.gameId);
  setGame(r.game, { restart, version: r.version });
}
$("undo").onclick = () => serial(async () => {
  try {
    const r = await api.undoGame(app.gameId, app.version);
    setGame(r.game, { restart: true, version: r.version });
    say("1つ前に戻しました");
  } catch (e) { fail(e); }
});
$("restart").onclick = () => app.engine.restart();

/* ---------- JSON直接編集 ---------- */
$("applyjson").onclick = () => serial(async () => {
  const msg = $("jmsg");
  try {
    const parsed = JSON.parse($("json").value);
    const v = validateGame(parsed, app.schema);              // クライアントでも同じ規則で検証
    if (!v.ok) throw new Error(v.errors.map(e => e.message).join(" / "));
    const r = await api.saveGame(app.gameId, parsed, app.version, "JSON編集"); // サーバーでも再検証
    setGame(r.game, { restart: true, version: r.version });
    const w = r.warnings.map(x => x.message);
    msg.textContent = "適用しました" + (w.length ? "(" + w.join(" / ") + ")" : ""); msg.className = "mute";
  } catch (e) {
    msg.textContent = "エラー: " + (e instanceof SyntaxError ? "JSONの書式が正しくありません (" + e.message + ")" : e.message); msg.className = "warn";
  }
});

/* ---------- AI提案(差分を見せて承認式) ---------- */
// 提案はすべて「JSON差分(ops)」。ゲーム性・カメラ・アセット設定のどれも同じ仕組みで、適用ボタンを押すまで変わらない。
const suggCtx = () => ({
  engine: app.engine, assets: app.assets,
  bounds: k => (view.r3d ? view.r3d.getModelBounds(k) : null),
  clips: k => (view.r3d ? view.r3d.getClips(k) : []),
});
for (const [group, items] of SUGGESTION_GROUPS) {
  const h = document.createElement("div"); h.className = "suggroup"; h.textContent = group; $("sugbtn").appendChild(h);
  const row = document.createElement("div"); row.className = "bar"; $("sugbtn").appendChild(row);
  for (const [name, fn] of Object.entries(items)) {
    const b = document.createElement("button"); b.textContent = name;
    b.onclick = async () => {
      try {
        const s = fn(app.game, app.schema, suggCtx());
        if (!s || !s.ops || !s.ops.length) { $("prop").innerHTML = `<span class="mute">${esc((s && s.message) || "提案できる変更が見つかりませんでした。")}</span>`; app.proposal = null; return; }
        const p = await api.proposePatch(app.gameId, s.ops, s.title, "rule"); // 保存するだけ。ゲームは変わらない
        app.proposal = p; showProposal();
      } catch (e) { fail(e); }
    };
    row.appendChild(b);
  }
}
function showProposal() {
  const el = $("prop"), p = app.proposal;
  if (!p) { el.innerHTML = ""; return; }
  el.innerHTML = `<div>「${esc(p.title)}」の提案:</div><ul class="diff">` +
    p.ops.map(op => `<li>${esc(describeOp(op, app.game, app.schema))}</li>`).join("") +
    `</ul>` + ((p.warnings || []).length ? `<div class="mute">注意: ${p.warnings.map(w => esc(w.message)).join(" / ")}</div>` : "") +
    `<div class="bar"><button class="pri" id="okp">適用</button><button id="ngp">破棄</button></div>`;
  $("okp").onclick = () => serial(async () => {
    try {
      const levelChanged = p.ops.some(o => o.path.startsWith("/level"));
      const r = await api.applyPatch(app.gameId, p.proposal_id); // 人がボタンを押したときだけ適用
      app.proposal = null; showProposal();
      setGame(r.game, { restart: levelChanged, version: r.version });
      warnAssets(r.warnings);
    } catch (e) { fail(e); }
  });
  $("ngp").onclick = async () => {
    try { await api.discardPatch(app.gameId, p.proposal_id); } catch (e) { fail(e); }
    app.proposal = null; showProposal();
  };
}

/* ---------- ゲーム選択 ---------- */
async function refreshGames(select) {
  const { games } = await api.listGames();
  const sel = $("gameSel");
  sel.innerHTML = games.map(g => `<option value="${esc(g.game_id)}">${esc(g.title)} (${esc(g.game_id)})</option>`).join("");
  if (select) sel.value = select;
}
async function openGame(id) {
  const r = await api.getGame(id);
  app.gameId = id; app.proposal = null; showProposal(); lsSet("lastGame", id);
  modelSig = ""; setGame(r.game, { restart: true, version: r.version });
  if (assetsUI) await assetsUI.refresh();
}
$("gameSel").onchange = e => openGame(e.target.value).catch(fail);
/* ---------- テンプレートから新規作成 / 使い方ガイド ---------- */
let tplCache = null;
async function loadTemplates() { // templates/index.json の一覧を、スキーマ検証して読み込む(壊れたものは除外)
  if (tplCache) return tplCache;
  const idx = await (await fetch("templates/index.json")).json(), list = [];
  for (const t of idx.templates) {
    try {
      const v = validateGame(await (await fetch("templates/" + t.file)).json(), app.schema);
      if (v.ok) list.push({ ...t, game: v.game });
    } catch { /* 1つ読めなくても他は使える */ }
  }
  return (tplCache = list);
}
let tplPick = 0, tplTitleEdited = false;
function pickTemplate(i) {
  tplPick = i;
  document.querySelectorAll("#tplGrid .tpl").forEach((el, k) => { el.classList.toggle("sel", k === i); el.setAttribute("aria-pressed", k === i); });
  if (!tplTitleEdited) $("tplTitle").value = tplCache[i].name;
}
async function openTemplates() {
  let list;
  try { list = await loadTemplates(); } catch { list = []; }
  if (!list.length) { // テンプレートを読めないときは、初期ステージで作る
    list = tplCache = [{ id: "first", name: "新しいゲーム", description: "初期ステージ", game: validateGame(app.schema.defaultGame, app.schema).game }];
  }
  const grid = $("tplGrid"); grid.innerHTML = ""; tplTitleEdited = false;
  list.forEach((t, i) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "tpl"; b.dataset.id = t.id;
    b.innerHTML = '<canvas width="192"></canvas><span class="tt"></span><span class="mute"></span>';
    b.querySelector(".tt").textContent = t.name + ((t.tags || []).includes("3D") ? "  [3D]" : "");
    b.lastChild.textContent = t.description;
    drawThumb(b.querySelector("canvas"), t.game);
    b.onclick = () => pickTemplate(i); b.ondblclick = () => $("tplOk").click();
    grid.appendChild(b);
  });
  pickTemplate(0); $("tplDlg").showModal();
}
$("tplTitle").oninput = () => { tplTitleEdited = true; };
$("tplCancel").onclick = () => $("tplDlg").close();
$("tplOk").onclick = async () => {
  const t = tplCache[tplPick]; if (!t) return;
  try {
    const g = JSON.parse(JSON.stringify(t.game)); g.meta.title = $("tplTitle").value.trim().slice(0, 60) || t.name;
    const r = await api.createGame(genId(), g); $("tplDlg").close();
    await refreshGames(r.game_id); await openGame(r.game_id); say(`「${g.meta.title}」を作りました`);
  } catch (e) { fail(e); }
};
$("newGame").onclick = () => openTemplates().catch(fail);
$("helpBtn").onclick = () => $("helpDlg").showModal();
$("helpClose").onclick = () => $("helpDlg").close();
$("helpTpl").onclick = () => { $("helpDlg").close(); openTemplates().catch(fail); };
$("dupGame").onclick = async () => { // 複製(GLBも一緒に)。プロジェクトの書き出し→読み込みと同じ経路
  try {
    const out = await exportProject(api, app.gameId), id = await importProject(api, await out.blob.text());
    const g = (await api.getGame(id)).game; g.meta.title = (g.meta.title + " のコピー").slice(0, 60);
    await api.saveGame(id, g, null, "複製"); await refreshGames(id); await openGame(id); say("複製しました");
  } catch (e) { fail(e); }
};
$("delGame").onclick = async () => { // ブラウザ保存モードのみ
  if (!confirm(`「${app.game.meta.title}」を削除しますか?\nこのブラウザ内の保存データ(履歴・アップロードしたGLB)も消えます。ファイルに保存していない場合は元に戻せません。`)) return;
  try {
    const id = app.gameId; await api.deleteGame(id); lsSet("exported:" + id, "");
    let { games } = await api.listGames();
    if (!games.length) { await api.createGame(genId(), null); ({ games } = await api.listGames()); }
    await refreshGames(games[0].game_id); await openGame(games[0].game_id); say("削除しました");
  } catch (e) { fail(e); }
};

/* ---------- メインループ ---------- */
const hud = $("hud").getContext("2d");
const view = { r3d: null, state: "idle", is3d: null }; // state: idle | loading | failed
if (location.search.includes("debug")) { window.__app = app; window.__view = view; } // テスト用
function ensure3d() {
  if (view.state !== "idle") return;
  view.state = "loading";
  import("./render3d.js")
    .then(m => { view.r3d = new m.Renderer3D($("cv3"), {
      urlOf: p => api.resolveUrl(p), // ブラウザ内に保存したGLBは Blob URL に解決する
      onWarn: msg => say(msg, "err", 9000),
      onModel: ({ kind, url, clips }) => {
        $("clips_" + kind).innerHTML = clips.map(c => `<option value="${esc(c)}">`).join("");
        const mi = document.getElementById("modelinfo-" + kind); if (mi) mi.textContent = url + " のクリップ: " + (clips.join(", ") || "なし");
      },
    }); view.state = "ready"; })
    .catch(e => { view.state = "failed"; say("3D表示を開始できないため2Dで表示します(" + e.message + ")", "err", 10000); });
}
function setViewMode(is3d) {
  if (view.is3d === is3d) return;
  view.is3d = is3d;
  $("cv").classList.toggle("off", is3d); $("cv3").classList.toggle("off", !is3d);
}
let last = 0, acc = 0;
function loop(ts) {
  try {
    const dt = (ts - last) / 1000; last = ts;
    if (editor && editor.active) { // ステージ編集中: ゲームは止め、2Dで自由視点・グリッド付きに描く
      setViewMode(false);
      draw2d(ctx, editor.engineFor(), editor.viewOpts()); editor.drawHud(hud);
      requestAnimationFrame(loop); return;
    }
    acc = advance(app.engine, acc, dt, keys);
    const want3d = app.game.render.mode === "3d";
    if (want3d) ensure3d();
    const use3d = want3d && view.r3d !== null;
    setViewMode(use3d);
    if (use3d) {
      try { view.r3d.setVersions(app.assetVersions); view.r3d.showHitbox = !!app.showHit; view.r3d.render(app.engine, Math.min(.1, dt)); }
      catch (e) { console.error(e); view.state = "failed"; view.r3d = null; setViewMode(false); say("3D描画でエラーが発生したため2Dで表示します(" + e.message + ")", "err", 10000); draw2d(ctx, app.engine); }
    } else draw2d(ctx, app.engine, { hitbox: app.showHit });
    drawHud(hud, app.engine);
  } catch (e) { console.error(e); say("実行中にエラーが発生したため、最後の保存状態に戻します", "err", 8000); reload(true).catch(() => {}); }
  requestAnimationFrame(loop);
}

/* ---------- 起動 ---------- */
(async () => {
  try {
    bindInput(keys, $);
    await api.init();
    if (MODE === "server") document.body.classList.add("server-mode"); else document.body.classList.add("local-mode");
    await refreshAuth();
    app.schema = await api.getSchema();
    for (const { el, fields } of buildInspector(app.schema)) buildControls(el, fields); // 対象ごとのインスペクタ(スキーマから自動生成)
    initHierarchy(); openTab = initTabs(); initTheme(); initFit();
    editor = new StageEditor({
      getGame: () => app.game, commitLevel, say, schema: app.schema, $,
      onToggle: on => { $("editBtn").classList.toggle("on", on); $("stage").classList.toggle("editing", on); if (on) { openTab("stage"); acc = 0; } else app.engine.restart(); },
    });
    editor.attach($("stage")); editor.buildPalette($("stagePalette"));
    if (location.search.includes("debug")) window.__editor = editor; // テスト用
    $("editBtn").onclick = () => (editor.active ? editor.exit() : editor.enter());
    assetsUI = initAssets({
      api, $, esc, getGameId: () => app.gameId, getGame: () => app.game,
      commit: (g, label) => commitGame(g, label, { restart: false }), say, fail,
      onList: list => {
        app.assets = list; app.assetVersions = Object.fromEntries(list.uploads.map(a => [a.path, a.mtime]));
        $("modelList").innerHTML = [...list.uploads, ...list.samples].map(a => `<option value="${esc(a.path)}">${esc(a.name)}</option>`).join("");
      },
    });
    try { app.showHit = localStorage.getItem("showHit") === "1"; } catch { /* 保存できなくても動く */ }
    $("showHit").checked = app.showHit;
    $("showHit").onchange = e => { app.showHit = e.target.checked; try { localStorage.setItem("showHit", app.showHit ? "1" : "0"); } catch { /* 無視 */ } };
    let { games } = await api.listGames();
    if (!games.length) { await api.createGame(MODE === "server" ? "demo" : null, null); ({ games } = await api.listGames()); }
    const want = new URLSearchParams(location.search).get("game") || lsGet("lastGame");
    const first = games.some(g => g.game_id === want) ? want : games[0].game_id;
    await refreshGames(first);
    await openGame(first);
    if (MODE === "local" && !lsGet("introSeen")) { lsSet("introSeen", "1"); $("helpDlg").showModal(); } // 初回だけ使い方ガイドを出す(「使い方」ボタンでいつでも再表示)
    requestAnimationFrame(t => { last = t; loop(t); });
  } catch (e) {
    fail(e);
    $("diag").innerHTML = e.code === "unauthorized" || e.code === "auth_not_configured"
      ? '<span class="warn">ゲームがまだありません。ログインすると最初のゲームを作成します(パスワード未設定の場合は README の「認証の設定」を参照)。</span>'
      : '<span class="warn">開始できません: ' + esc(e.message || String(e)) + (MODE === "server" ? "(サーバー保存モードにはPHPが必要です)" : "") + "</span>";
  }
})();
