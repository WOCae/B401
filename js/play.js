// 遊ぶ専用ページ: エディタなしでゲームだけを動かす。
//   play.html?game=<id>        このブラウザ(または ?server=1 でサーバー)に保存したゲーム
//   play.html?src=<URL>        プロジェクトファイル(.pfmk.json)のURL
//   ファイルをドラッグ&ドロップ / 「ファイルを選ぶ」
// 読み込んだ内容は必ずスキーマ検証してから使う(範囲外は丸め、壊れていればエラー表示)。ユーザーのスクリプトは一切実行しない。
import { api as serverApi } from "./api.js";
import { LocalBackend } from "./localbackend.js";
import { validateGame } from "./schema.js";
import { Engine, advance } from "./engine.js";
import { draw2d } from "./render2d.js";
import { drawHud } from "./hud.js";
import { bindInput } from "./input.js";
import { FORMAT, b64ToBytes, importProject, parseProjectBytes } from "./project.js";
import { inspectGlb } from "./glb.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search), SERVER = params.has("server");
const backend = SERVER ? serverApi : new LocalBackend();
const keys = { l: 0, r: 0, j: 0, jp: false };
const ctx = $("cv").getContext("2d"), hud = $("hud").getContext("2d");
const S = { engine: null, game: null, schema: null, project: null, gameId: null, urls: new Map(), r3d: null, r3dState: "idle", is3d: null };
if (params.has("debug")) window.__play = S; // テスト用
const msg = (t, show = true) => { const el = $("pmsg"); el.textContent = t; el.classList.toggle("show", show && !!t); };

/** プロジェクトファイルの内容(JSON)を検証し、同梱GLBを Blob URL にして取り出す */
function readProject(p) {
  if (!p || p.format !== FORMAT) throw new Error("このツールのプロジェクトファイルではありません");
  if (typeof p.version !== "number" || p.version > 2) throw new Error("新しい形式のファイルです。ツールを更新してください");
  const v = validateGame(p.game, S.schema);
  if (!v.ok) throw new Error("ゲーム定義が不正です: " + v.errors.map(e => e.message).join(" / "));
  const L = S.schema.uploads;
  for (const a of (Array.isArray(p.assets) ? p.assets : []).slice(0, L.maxFilesPerGame)) {
    if (!a || typeof a.path !== "string" || typeof a.data !== "string") continue;
    try {
      const bytes = b64ToBytes(a.data);
      if (bytes.length > L.maxBytes || !inspectGlb(bytes, L.maxVertices).ok) { msg(`${a.path}: 使えないGLBなのでプリミティブで表示します`); continue; }
      S.urls.set(a.path, URL.createObjectURL(new Blob([bytes], { type: "model/gltf-binary" })));
    } catch { msg(`${a.path}: GLBのデータが壊れています`); }
  }
  S.project = p;
  return v.game;
}

function start(game) {
  S.game = game; S.engine = new Engine(game);
  $("ptitle").textContent = game.meta.title; document.title = game.meta.title + " - 遊ぶ";
  $("pdrop").hidden = true; $("stage").style.display = "";
  S.is3d = null;
}

async function loadFromBytes(buf) { start(readProject(parseProjectBytes(buf))); } // JSONでもPNG(画像に埋め込み)でもよい

async function boot() {
  bindInput(keys, $);
  await backend.init();
  S.schema = await backend.getSchema();
  const src = params.get("src"), id = params.get("game");
  try {
    if (src) {
      const r = await fetch(src);
      if (!r.ok) throw new Error(`ファイルを取得できません(HTTP ${r.status})`);
      const len = +r.headers.get("content-length") || 0; if (len > 60 * 1024 * 1024) throw new Error("ファイルが大きすぎます(上限60MB)");
      await loadFromBytes(await r.arrayBuffer());
    } else if (id) {
      const g = await backend.getGame(id); S.gameId = id;
      const v = validateGame(g.game, S.schema); if (!v.ok) throw new Error("ゲーム定義が不正です");
      start(v.game);
    } else { $("pdrop").hidden = false; $("stage").style.display = "none"; $("ptitle").textContent = "遊ぶ"; }
  } catch (e) { msg("読み込めませんでした: " + (e.message || e)); $("pdrop").hidden = false; $("stage").style.display = "none"; $("ptitle").textContent = "遊ぶ"; }
  requestAnimationFrame(t => { last = t; loop(t); });
}

/* ---------- 描画ループ(エディタと同じエンジン・描画) ---------- */
let last = 0, acc = 0;
function ensure3d() {
  if (S.r3dState !== "idle") return;
  S.r3dState = "loading";
  import("./render3d.js").then(m => { S.r3d = new m.Renderer3D($("cv3"), { urlOf: p => S.urls.get(p) || backend.resolveUrl(p), onWarn: t => msg(t) }); S.r3dState = "ready"; })
    .catch(e => { S.r3dState = "failed"; msg("3D表示を開始できないため2Dで表示します(" + e.message + ")"); });
}
function loop(ts) {
  const dt = (ts - last) / 1000; last = ts;
  try {
    if (S.engine) {
      acc = advance(S.engine, acc, dt, keys);
      const want3d = S.game.render.mode === "3d"; if (want3d) ensure3d();
      const use3d = want3d && S.r3d;
      if (S.is3d !== !!use3d) { S.is3d = !!use3d; $("cv").classList.toggle("off", !!use3d); $("cv3").classList.toggle("off", !use3d); }
      if (use3d) { try { S.r3d.render(S.engine, Math.min(.1, dt)); } catch (e) { S.r3dState = "failed"; S.r3d = null; msg("3D描画でエラーが発生したため2Dで表示します"); } }
      else draw2d(ctx, S.engine);
      drawHud(hud, S.engine);
    }
  } catch (e) { console.error(e); msg("実行中にエラーが発生しました: " + e.message); S.engine = null; }
  requestAnimationFrame(loop);
}

/* ---------- 操作 ---------- */
$("prestart").onclick = () => S.engine && S.engine.restart();
addEventListener("keydown", e => { if ((e.key === "r" || e.key === "R") && !e.ctrlKey && !e.metaKey && S.engine) S.engine.restart(); });
$("peditor").onclick = async () => {
  try {
    if (S.project) { // ファイル/URLから読み込んだゲーム: 自分のブラウザに取り込んでから開く
      const local = new LocalBackend(); await local.init();
      const id = await importProject(local, S.project); location.href = `index.html?game=${encodeURIComponent(id)}`;
    } else if (S.gameId) location.href = `index.html?${SERVER ? "server=1&" : ""}game=${encodeURIComponent(S.gameId)}`;
    else msg("開くゲームがありません");
  } catch (e) { msg("エディタで開けませんでした: " + e.message); }
};
async function openFile(file) { try { if (file.size > 60 * 1024 * 1024) throw new Error("ファイルが大きすぎます(上限60MB)"); msg("", false); await loadFromBytes(await file.arrayBuffer()); } catch (e) { msg("読み込めませんでした: " + e.message); } }
$("pfile").onchange = e => { if (e.target.files[0]) openFile(e.target.files[0]); };
addEventListener("dragover", e => e.preventDefault());
addEventListener("drop", e => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) openFile(f); });

/* ---------- 画面サイズ(比率を保って収める) ---------- */
function fit() {
  const st = $("stage"), top = document.querySelector(".ptop").offsetHeight + 90, w = Math.min(960, innerWidth - 20), h = innerHeight - top;
  const k = Math.max(0.3, Math.min(w / 640, h / 384)); st.style.width = Math.floor(640 * k) + "px"; st.style.height = Math.floor(384 * k) + "px";
}
addEventListener("resize", fit); fit();
boot().catch(e => msg("開始できません: " + (e.message || e)));
