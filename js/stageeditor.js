// ステージエディタ: ビューポートをクリック/ドラッグしてタイルを置く。
// 編集中はゲームを止めて2D表示にし、1回のストローク(押してから離すまで)を1つの履歴として保存する。
// 保存は既存の経路(検証→サーバー→履歴)を通る。壊れる操作(Pの削除など)は適用前に止める。
import { T, VW, VH, Engine } from "./engine.js";
import { BRUSHES, pad, paint, rectCells, lineCells, fill, resize, size } from "./level.js";

const COLORS = { ".": "#bfe3ff", "#": "#6b4a2b", "^": "#4a4f57", o: "#f5b800", E: "#7a3fb0", G: "#d9342b", P: "#e4572e" };
const KEYS = Object.fromEntries(BRUSHES.map((b, i) => [String(i + 1), b]));

/**
 * hooks: { getGame(), commitLevel(rows,label)→Promise, say(msg,kind,ms), schema, $ }
 */
export class StageEditor {
  constructor(hooks) {
    this.h = hooks; this.active = false; this.brush = "#"; this.tool = "pencil"; this.grid = true; this.zoom = 1;
    this.rows = null; this.cam = { x: 0, y: null }; this.hover = null; this.stroke = null; this.pending = 0; this.eng = null; this.engRows = null;
  }

  /* ---------- 状態 ---------- */
  enter() { if (this.active) return; this.active = true; this.sync(true); this.syncUI(); this.h.onToggle && this.h.onToggle(true); }
  exit() { if (!this.active) return; this.active = false; this.stroke = null; this.h.onToggle && this.h.onToggle(false); this.syncUI(); }
  /** ゲーム側のレベルを作業用コピーに取り込む(保存待ち・ドラッグ中は上書きしない) */
  sync(force = false) {
    if (!this.active && !force) return;
    if (this.stroke || this.pending > 0) return;
    this.rows = pad(this.h.getGame().level); this.eng = null; this.clampCam(); this.syncUI();
  }

  get dims() { return size(this.rows); }
  clampCam() {
    if (!this.rows) return;
    const { w, h } = this.dims, vw = VW / this.zoom, vh = VH / this.zoom, lw = w * T, lh = h * T;
    const maxX = Math.max(0, lw - vw);
    this.cam.x = Math.min(maxX, Math.max(0, this.cam.x));
    const bottom = lh - vh; // 下端合わせの位置(レベルが低いと負)
    if (this.cam.y === null) this.cam.y = bottom;
    this.cam.y = lh <= vh ? bottom : Math.min(bottom, Math.max(0, this.cam.y));
  }

  /* ---------- 描画(main のループから毎フレーム) ---------- */
  engineFor() { // 作業中のレベルを描くための使い捨てエンジン(開始位置・敵・コインの見た目を既存描画で出す)
    if (!this.eng || this.engRows !== this.rows) { this.eng = new Engine({ ...this.h.getGame(), level: this.rows }); this.engRows = this.rows; }
    return this.eng;
  }
  viewOpts() {
    this.clampCam();
    return { view: { camX: this.cam.x, top: this.cam.y, zoom: this.zoom }, overlay: c => this.overlay(c) };
  }
  overlay(c) {
    const { w, h } = this.dims, z = this.zoom;
    if (this.grid) {
      c.lineWidth = 1 / z; c.strokeStyle = "rgba(255,255,255,.18)"; c.beginPath();
      for (let x = 0; x <= w; x++) { c.moveTo(x * T, 0); c.lineTo(x * T, h * T); }
      for (let y = 0; y <= h; y++) { c.moveTo(0, y * T); c.lineTo(w * T, y * T); }
      c.stroke();
    }
    c.lineWidth = 2 / z; c.strokeStyle = "rgba(77,141,255,.9)"; c.strokeRect(0, 0, w * T, h * T); // ステージの外枠
    // 開始位置・敵の位置が分かりにくいので小さく印をつける
    c.font = `bold ${12}px sans-serif`; c.textAlign = "center";
    for (let y = 0; y < h; y++) { const r = Array.from(this.rows[y]); for (let x = 0; x < w; x++) {
      if (r[x] === "P") { c.fillStyle = "rgba(0,0,0,.55)"; c.fillText("P", x * T + T / 2, y * T + 11); }
    } }
    c.textAlign = "left";
    // ドラッグ中の長方形・カーソル
    if (this.stroke && this.stroke.mode === "rect") {
      c.fillStyle = "rgba(77,141,255,.25)"; c.strokeStyle = "#4d8dff";
      for (const [x, y] of rectCells(this.stroke.a, this.stroke.b)) { c.fillRect(x * T, y * T, T, T); }
    }
    if (this.hover) {
      const [x, y] = this.hover; c.lineWidth = 2 / z; c.strokeStyle = this.stroke && this.stroke.erase ? "#ff3b30" : "#fff"; c.strokeRect(x * T + 1, y * T + 1, T - 2, T - 2);
      c.globalAlpha = .55; c.fillStyle = COLORS[this.stroke && this.stroke.erase ? "." : this.brush]; if ((this.stroke && this.stroke.erase ? "." : this.brush) !== ".") c.fillRect(x * T + 4, y * T + 4, T - 8, T - 8); c.globalAlpha = 1;
    }
  }
  drawHud(c) {
    c.clearRect(0, 0, VW, VH);
    const { w, h } = this.dims;
    c.fillStyle = "rgba(0,0,0,.6)"; c.fillRect(8, 8, 400, 24); c.fillStyle = "#fff"; c.font = "13px sans-serif";
    c.fillText(`ステージ編集中(2D表示)  ${w}×${h}  ホイール/Alt+ドラッグで移動`, 14, 25);
  }

  /* ---------- 座標変換とマウス操作 ---------- */
  cellAt(ev) {
    const r = this.stageEl.getBoundingClientRect();
    const sx = (ev.clientX - r.left) * VW / r.width, sy = (ev.clientY - r.top) * VH / r.height;
    const wx = sx / this.zoom + this.cam.x, wy = sy / this.zoom + this.cam.y;
    return [Math.floor(wx / T), Math.floor(wy / T)];
  }
  attach(stageEl) {
    this.stageEl = stageEl;
    stageEl.addEventListener("contextmenu", e => { if (this.active) e.preventDefault(); });
    stageEl.addEventListener("pointerdown", e => this.down(e));
    stageEl.addEventListener("pointermove", e => this.move(e));
    stageEl.addEventListener("pointerup", e => this.up(e));
    stageEl.addEventListener("pointercancel", e => this.up(e, true));
    stageEl.addEventListener("pointerleave", () => { if (!this.stroke) this.hover = null; });
    stageEl.addEventListener("wheel", e => {
      if (!this.active) return; e.preventDefault();
      const horizontal = !e.shiftKey && Math.abs(e.deltaX) <= Math.abs(e.deltaY) ? e.deltaY : e.deltaX;
      if (e.shiftKey) this.cam.y += e.deltaY / this.zoom; else this.cam.x += horizontal / this.zoom;
      this.clampCam(); this.syncUI();
    }, { passive: false });
    addEventListener("keydown", e => {
      if (!this.active || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (KEYS[e.key]) { this.setBrush(KEYS[e.key]); e.preventDefault(); }
      else if (e.key === "b" || e.key === "B") this.setTool("pencil");
      else if (e.key === "r" || e.key === "R") this.setTool("rect");
      else if (e.key === "f" || e.key === "F") this.setTool("fill");
      else if (e.key === "Escape") this.exit();
    });
  }
  down(e) {
    if (!this.active || this.stroke) return;
    e.preventDefault(); this.stageEl.setPointerCapture(e.pointerId);
    const cell = this.cellAt(e);
    if (e.button === 1 || e.altKey) { this.stroke = { mode: "pan", x: e.clientX, y: e.clientY, cx: this.cam.x, cy: this.cam.y }; return; }
    const erase = e.button === 2, ch = erase ? "." : this.brush;
    if (this.tool === "fill") { this.stroke = { mode: "fill", changed: false }; const r = fill(this.rows, cell[0], cell[1], ch); if (r.changed) { this.rows = r.rows; this.stroke.changed = true; } this.hover = cell; return; }
    if (this.tool === "rect") { this.stroke = { mode: "rect", a: cell, b: cell, erase, ch, changed: false }; this.hover = cell; return; }
    this.stroke = { mode: "pencil", last: cell, erase, ch, changed: false };
    this.applyCells([cell], ch);
    this.hover = cell;
  }
  applyCells(cells, ch) {
    const r = paint(this.rows, cells, ch);
    if (r.changed) { this.rows = r.rows; this.stroke.changed = true; }
  }
  move(e) {
    if (!this.active) return;
    const cell = this.cellAt(e); this.hover = cell;
    const s = this.stroke; if (!s) return;
    if (s.mode === "pan") {
      const r = this.stageEl.getBoundingClientRect(), k = VW / r.width / this.zoom;
      this.cam.x = s.cx - (e.clientX - s.x) * k; this.cam.y = s.cy - (e.clientY - s.y) * k; this.clampCam(); this.syncUI(); return;
    }
    if (s.mode === "rect") { s.b = cell; return; }
    if (s.mode === "pencil") { this.applyCells(lineCells(s.last, cell), s.ch); s.last = cell; }
  }
  up(e, cancelled = false) {
    const s = this.stroke; if (!s) return;
    this.stroke = null;
    try { this.stageEl.releasePointerCapture(e.pointerId); } catch { /* 無視 */ }
    if (cancelled || s.mode === "pan") return;
    if (s.mode === "rect") { const r = paint(this.rows, rectCells(s.a, s.b), s.ch); if (r.changed) { this.rows = r.rows; s.changed = true; } }
    if (s.changed) this.commit(s.mode === "fill" ? "塗りつぶし" : s.mode === "rect" ? "長方形で配置" : "タイルを配置");
  }
  async commit(label) {
    this.pending++;
    const rows = this.rows;
    try { await this.h.commitLevel(rows, `ステージ編集: ${label}`); } finally { this.pending--; this.sync(); }
  }

  /* ---------- 操作(パレットから) ---------- */
  setBrush(ch) { this.enter(); this.brush = ch; this.syncUI(); }
  setTool(t) { this.enter(); this.tool = t; this.syncUI(); }
  async resize(d) {
    this.enter();
    const r = resize(this.rows, d, this.h.schema.level);
    if (r.error) { this.h.say(r.error, "err", 5000); return; }
    this.rows = r.rows; this.cam.y = null;
    await this.commit("大きさを変更");
  }
  setZoom(z) { this.zoom = z; this.cam.y = null; this.clampCam(); this.syncUI(); }

  /* ---------- パレットUI ---------- */
  buildPalette(root) {
    const names = this.h.schema.tiles, $ = this.h.$;
    root.innerHTML = `
<div class="bar"><span class="mute">ブラシ</span><div id="brushes" class="brushes"></div></div>
<div class="bar"><span class="mute">道具</span>
  <div class="tgroup seg" id="tools"><button data-tool="pencil" title="B">鉛筆</button><button data-tool="rect" title="R">長方形</button><button data-tool="fill" title="F">塗りつぶし</button></div>
  <label class="chk"><input type="checkbox" id="stGrid" checked> グリッド</label>
  <label class="chk">拡大 <select id="stZoom"><option value="0.5">50%</option><option value="0.75">75%</option><option value="1" selected>100%</option></select></label></div>
<div class="bar"><span class="mute">大きさ <b id="stSize"></b></span>
  <span class="szgrp">上 <button data-r="top:1">＋</button><button data-r="top:-1">−</button></span>
  <span class="szgrp">下 <button data-r="bottom:1">＋</button><button data-r="bottom:-1">−</button></span>
  <span class="szgrp">左 <button data-r="left:1">＋</button><button data-r="left:-1">−</button></span>
  <span class="szgrp">右 <button data-r="right:1">＋</button><button data-r="right:-1">−</button></span></div>
<div class="bar"><label class="mute">表示位置 X <input type="range" id="stX" min="0" max="0" step="8"></label><label class="mute">Y <input type="range" id="stY" min="0" max="0" step="8"></label></div>
<p class="mute">クリック/ドラッグで配置、右クリックで消しゴム、ホイールまたは Alt+ドラッグで移動。キー: 1〜7=ブラシ、B/R/F=道具、Esc=終了。
1回の操作が1つの履歴になり、「元に戻す」で取り消せます。開始位置(P)は1個だけで、消さずに置き直すと移動します。</p>`;
    const bx = root.querySelector("#brushes");
    BRUSHES.forEach((b, i) => {
      const btn = document.createElement("button"); btn.className = "brush"; btn.dataset.ch = b; btn.title = `${names[b].name} (${i + 1})`;
      btn.innerHTML = `<span class="sw" style="background:${COLORS[b]}"></span><span class="bl"></span>`; btn.lastChild.textContent = b === "." ? "消しゴム" : names[b].name;
      btn.onclick = () => this.setBrush(b); bx.appendChild(btn);
    });
    root.querySelectorAll("[data-tool]").forEach(b => { b.onclick = () => this.setTool(b.dataset.tool); });
    root.querySelector("#stGrid").onchange = e => { this.grid = e.target.checked; };
    root.querySelector("#stZoom").onchange = e => this.setZoom(+e.target.value);
    root.querySelectorAll("[data-r]").forEach(b => { b.onclick = () => { const [k, v] = b.dataset.r.split(":"); this.resize({ [k]: +v }); }; });
    root.querySelector("#stX").oninput = e => { this.enter(); this.cam.x = +e.target.value; this.clampCam(); };
    root.querySelector("#stY").oninput = e => { this.enter(); this.cam.y = +e.target.value; this.clampCam(); };
    this.root = root; this.syncUI();
  }
  syncUI() {
    const r = this.root; if (!r) return;
    r.querySelectorAll(".brush").forEach(b => b.classList.toggle("on", b.dataset.ch === this.brush));
    r.querySelectorAll("[data-tool]").forEach(b => b.classList.toggle("on", b.dataset.tool === this.tool));
    if (!this.rows) { r.classList.toggle("idle", true); return; }
    r.classList.toggle("idle", !this.active);
    const { w, h } = this.dims, vw = VW / this.zoom, vh = VH / this.zoom, sx = r.querySelector("#stX"), sy = r.querySelector("#stY");
    r.querySelector("#stSize").textContent = `${w}×${h}`;
    sx.max = Math.max(0, w * T - vw); sx.value = this.cam.x; sx.disabled = w * T <= vw;
    sy.max = Math.max(0, h * T - vh); sy.value = this.cam.y === null ? 0 : this.cam.y; sy.disabled = h * T <= vh;
  }
}
