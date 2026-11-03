// エディタ風UIの骨組み: ヒエラルキー(対象の選択) / インスペクタ(対象ごとの設定) / ドックのタブ / テーマ / ビューポートのサイズ合わせ。
// 設定項目そのものは schema/game.schema.json のフィールドから自動生成する(項目の追加がそのまま画面に出る)。
const TILE = [["wall", "#", "ブロック (#)", "■"], ["spike", "^", "トゲ (^)", "▲"], ["coin", "o", "コイン (o)", "●"], ["goal", "G", "ゴール (G)", "⚑"]];
const startsAny = (f, ...ps) => ps.some(p => f.path.startsWith(p));

/** 対象(ヒエラルキーの項目)と、そのインスペクタに並べる項目の振り分け */
export const SECTIONS = [
  { id: "world", group: "シーン", title: "ワールド", ico: "◆", subs: [
    { key: "physics", title: "物理", match: f => f.path.startsWith("physics.") },
    { key: "theme", title: "テーマ色", match: f => f.path === "theme.sky" || f.path === "theme.ground" }] },
  { id: "camera", group: "シーン", title: "カメラ・表示", ico: "◎", subs: [
    { key: "render", title: "表示", match: f => f.path === "render.mode" || f.path === "render.depth" || f.path === "render.lighting" },
    { key: "camera", title: "カメラ", match: f => f.path.startsWith("render.camera.") }] },
  ...["player", "enemy"].map(who => ({ id: who, group: "キャラクター", title: who === "player" ? "プレイヤー" : "敵", ico: who === "player" ? "☺" : "☻", subs: [
    ...(who === "enemy" ? [{ key: "behavior", title: "動き", match: f => f.path === "enemy.speed" }] : []),
    { key: "look", title: "見た目(プリミティブ)", match: f => startsAny(f, `assets.${who}.primitive.`) || (who === "player" && f.path === "theme.player") },
    { key: "model", title: "モデル(GLB)", match: f => f.group === "model" && f.path.startsWith(`assets.${who}.`),
      note: '<div class="mute modelinfo-wrap"><span id="modelinfo-' + who + '"></span><br>パスは assets/samples/player.glb のように指定(空=プリミティブ)。スケール1=1タイル(32px)、正面は+Z。読み込めない場合はプリミティブのまま動きます。</div>' },
    { key: "hitbox", title: "ヒットボックス(当たり判定)", match: f => f.group === "hitbox" && f.path.startsWith(`assets.${who}.`),
      note: '<div class="mute">当たり判定は見た目のモデルとは独立です。ox/oy は「モデルの原点から見たヒットボックス下端中央」(右・上が+)。変更するとリスタートします。</div>' }] })),
  ...TILE.map(([id, sym, title, ico]) => ({ id: "tile_" + id, group: "タイル", title, ico, subs: [
    { key: "tile", title: "モデル(GLB)・色", match: f => f.group === "tile" && f.path.startsWith(`assets.tiles.${sym}.`),
      note: '<div class="mute">タイル用モデルの原点は「タイルの下端中央」(1タイル=1単位)。見た目だけが変わり、当たり判定はそのままです。未指定・読み込み失敗ならプリミティブで表示します。</div>' }] })),
];

/** インスペクタの枠を作る。戻り値: [{el, fields}] — 呼び出し側が各 el にコントロールを作る */
export function buildInspector(schema) {
  const body = document.getElementById("inspBody"), out = [];
  for (const s of SECTIONS) {
    const sec = document.createElement("section"); sec.dataset.for = s.id; sec.hidden = true;
    for (const sub of s.subs) {
      const fields = schema.fields.filter(sub.match);
      if (!fields.length) continue;
      const h = document.createElement("div"); h.className = "isec"; h.textContent = sub.title; sec.appendChild(h);
      const el = document.createElement("div"); el.id = `ic_${s.id}_${sub.key}`; sec.appendChild(el);
      if (sub.note) sec.insertAdjacentHTML("beforeend", sub.note);
      out.push({ el, fields });
    }
    body.appendChild(sec);
  }
  return out;
}

const store = {
  get(k, d) { try { return localStorage.getItem(k) || d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 保存できなくても動く */ } },
};

export function initHierarchy() {
  if (location.search.includes("showall")) document.documentElement.dataset.showall = "1"; // 検証用: 全パネルを同時表示
  const list = document.getElementById("hierList");
  let last = "";
  for (const s of SECTIONS) {
    if (s.group !== last) { last = s.group; const g = document.createElement("div"); g.className = "hgroup"; g.textContent = s.group; list.appendChild(g); }
    const b = document.createElement("button"); b.className = "hitem"; b.dataset.sel = s.id; b.id = "h_" + s.id;
    b.innerHTML = `<span class="ico">${s.ico}</span><span></span>`; b.lastChild.textContent = s.title;
    b.onclick = () => select(s.id);
    list.appendChild(b);
  }
  function select(id) {
    if (!SECTIONS.some(s => s.id === id)) id = "world";
    document.querySelectorAll("#hierList .hitem").forEach(b => b.classList.toggle("on", b.dataset.sel === id));
    document.querySelectorAll("#inspBody > section").forEach(sec => { sec.hidden = sec.dataset.for !== id; });
    document.getElementById("inspTitle").textContent = "インスペクタ: " + SECTIONS.find(s => s.id === id).title;
    store.set("sel", id);
  }
  select(store.get("sel", "world"));
  return select;
}

export function initTabs() {
  const tabs = [...document.querySelectorAll(".tabs button")];
  function open(name) {
    if (!tabs.some(b => b.dataset.tab === name)) name = "assets";
    tabs.forEach(b => { b.classList.toggle("on", b.dataset.tab === name); b.setAttribute("aria-selected", b.dataset.tab === name); });
    document.querySelectorAll(".tabpanel").forEach(p => p.classList.toggle("on", p.id === "tab_" + name));
    store.set("tab", name);
  }
  tabs.forEach(b => { b.onclick = () => open(b.dataset.tab); });
  open(store.get("tab", "assets"));
  return open;
}

export function initTheme() {
  const btn = document.getElementById("themeBtn");
  btn.onclick = () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next; store.set("theme", next);
  };
}

/** デスクトップ幅ではビューポートの枠いっぱいに、比率(640:384)を保って大きく表示する */
export function initFit() {
  const vp = document.getElementById("viewport"), stage = document.getElementById("stage"), mq = matchMedia("(min-width:1000px)");
  function fit() {
    if (!mq.matches) { stage.style.width = ""; stage.style.height = ""; return; }
    const w = vp.clientWidth - 16, h = vp.clientHeight - 16;
    if (w <= 0 || h <= 0) return;
    const k = Math.min(w / 640, h / 384);
    stage.style.width = Math.floor(640 * k) + "px"; stage.style.height = Math.floor(384 * k) + "px";
  }
  new ResizeObserver(fit).observe(vp); mq.addEventListener("change", fit); fit();
}
