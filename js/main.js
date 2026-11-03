// アプリ本体: 状態管理・ダッシュボード・メインループ。
// ゲーム定義 app.game は「検証済みJSON」だけを保持し、壊れた入力は受け付けず直前の状態を保つ。
import { api, ApiError } from "./api.js";
import { validateGame, clone } from "./schema.js";
import { diagnose } from "./diagnose.js";
import { applyPatchOps, describeOp } from "./patch.js";
import { Engine, advance } from "./engine.js";
import { draw2d } from "./render2d.js";
import { bindInput } from "./input.js";
import { SUGGESTIONS } from "./suggest.js";

const $ = id => document.getElementById(id);
const app = { schema: null, gameId: null, version: 0, game: null, engine: null, proposal: null };
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
  if (app.engine) app.engine.load(app.game, restart); else app.engine = new Engine(app.game);
  syncUI();
  return v;
}

/* ---------- スライダー ---------- */
const sliderFields = () => app.schema.fields.filter(f => f.slider);
const pathGet = (g, p) => p.split(".").reduce((a, k) => a[k], g);
const idOf = p => p.replace(/\./g, "_");
function buildSliders() {
  const sl = $("sliders"); sl.innerHTML = "";
  for (const f of sliderFields()) {
    const r = document.createElement("div"); r.className = "row";
    r.innerHTML = `<label for="s_${idOf(f.path)}">${esc(f.label)}</label><input type="range" id="s_${idOf(f.path)}" min="${f.min}" max="${f.max}" step="${f.step}"><output id="o_${idOf(f.path)}"></output>`;
    sl.appendChild(r);
    const inp = r.querySelector("input");
    inp.addEventListener("input", () => { // 即時反映(エンジンは app.game を参照している)
      const [g, k] = f.path.split("."); app.game[g][k] = +inp.value;
      $("o_" + idOf(f.path)).textContent = inp.value; renderDiag(); syncJson();
    });
    inp.addEventListener("change", async () => { // 指を離したらサーバーに保存(履歴に残る)
      inp.blur();
      await commitGame(app.game, `${f.label}を調整`, { restart: false });
    });
  }
}
function syncUI() {
  for (const f of sliderFields()) {
    $("s_" + idOf(f.path)).value = pathGet(app.game, f.path);
    $("o_" + idOf(f.path)).textContent = pathGet(app.game, f.path);
  }
  renderDiag(); syncJson();
}
function syncJson() { if (document.activeElement !== $("json")) $("json").value = JSON.stringify(app.game, null, 1); }
function renderDiag() {
  const d = diagnose(app.game, app.schema);
  const ok = d.gapsClearable;
  $("diag").innerHTML = `<div>ジャンプの高さ: 約${d.jumpHeightTiles.toFixed(1)}タイル / 距離: 約${d.jumpDistanceTiles.toFixed(1)}タイル</div>
 <div>ステージ内で最も広い穴: ${d.widestGapTiles}タイル</div>
 <div class="${ok ? "ok" : "warn"}">${ok ? "✓ すべての穴を飛び越せる見込みです。" : "⚠ 穴がジャンプ距離を超えています。クリアできない可能性があります。"}</div>
 <div class="mute">計算上の目安です。AI生成ステージはこの検証に通るまで再生成します。</div>`;
}

/* ---------- 保存・元に戻す(サーバーに履歴を残す) ---------- */
// 書き込み系は1つずつ順番に実行する(連続操作でも版の競合が起きない)
let chain = Promise.resolve();
const serial = fn => (chain = chain.then(fn, fn));
function commitGame(game, label, { restart }) {
  return serial(async () => {
  try {
    const r = await api.saveGame(app.gameId, game, app.version, label);
    setGame(r.game, { restart, version: r.version });
    return r;
  } catch (e) {
    fail(e);
    await reload(false); // サーバー上の直前の状態に戻す
  }
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
for (const name of Object.keys(SUGGESTIONS)) {
  const b = document.createElement("button"); b.textContent = name;
  b.onclick = async () => {
    try {
      const s = SUGGESTIONS[name](app.game, app.schema, app.engine);
      if (!s) { $("prop").innerHTML = '<span class="mute">提案できる変更が見つかりませんでした。</span>'; app.proposal = null; return; }
      const p = await api.proposePatch(app.gameId, s.ops, s.title, "rule"); // 保存するだけ。ゲームは変わらない
      app.proposal = p; showProposal();
    } catch (e) { fail(e); }
  };
  $("sugbtn").appendChild(b);
}
function showProposal() {
  const el = $("prop"), p = app.proposal;
  if (!p) { el.innerHTML = ""; return; }
  el.innerHTML = `<div>「${esc(p.title)}」の提案:</div><ul class="diff">` +
    p.ops.map(op => `<li>${esc(describeOp(op, app.game, app.schema))}</li>`).join("") +
    `</ul><div class="bar"><button class="pri" id="okp">適用</button><button id="ngp">破棄</button></div>`;
  $("okp").onclick = () => serial(async () => {
    try {
      const levelChanged = p.ops.some(o => o.path.startsWith("/level"));
      const r = await api.applyPatch(app.gameId, p.proposal_id); // 人がボタンを押したときだけ適用
      app.proposal = null; showProposal();
      setGame(r.game, { restart: levelChanged, version: r.version });
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
  app.gameId = id; app.proposal = null; showProposal();
  setGame(r.game, { restart: true, version: r.version });
}
$("gameSel").onchange = e => openGame(e.target.value).catch(fail);
$("newGame").onclick = async () => {
  const id = prompt("新しいゲームのID(英小文字・数字・-・_ 、40文字以内)", "game-" + Date.now().toString(36));
  if (!id) return;
  try {
    const r = await api.createGame(id, app.game); // 今のゲームを複製して作成
    await refreshGames(id); await openGame(r.game_id);
  } catch (e) { fail(e); }
};

/* ---------- メインループ ---------- */
let last = 0, acc = 0;
function loop(ts) {
  try {
    acc = advance(app.engine, acc, (ts - last) / 1000, keys); last = ts;
    draw2d(ctx, app.engine);
  } catch (e) { console.error(e); say("実行中にエラーが発生したため、最後の保存状態に戻します", "err", 8000); reload(true).catch(() => {}); }
  requestAnimationFrame(loop);
}

/* ---------- 起動 ---------- */
(async () => {
  try {
    bindInput(keys, $);
    app.schema = await api.getSchema();
    buildSliders();
    let { games } = await api.listGames();
    if (!games.length) { await api.createGame("demo", null); ({ games } = await api.listGames()); }
    await refreshGames(games[0].game_id);
    await openGame(games[0].game_id);
    requestAnimationFrame(t => { last = t; loop(t); });
  } catch (e) { fail(e); $("diag").innerHTML = '<span class="warn">サーバーに接続できないため開始できません。PHPが動作している環境で開いてください。</span>'; }
})();
