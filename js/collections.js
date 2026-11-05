// 一覧エディタ(敵の種類・アイテム): 追加・削除・各項目の設定。項目の定義はスキーマの collections から決まる。
// 記号を変えると、ステージ上の同じ記号も一緒に書き換える(配置したものが消えないように)。
import { legendOf } from "./legend.js";

/** まだ使われていない記号(ステージ上の文字として使えるもの) */
export function freeSymbols(game, schema) {
  const used = new Set(legendOf(game).keys());
  return Array.from(schema.symbols.pool).filter(c => !used.has(c));
}

/**
 * ctx: { getGame(), schema, buildControls(container, fields, bag), commit(game,label,{restart}), say(msg,kind), esc, clone }
 * 戻り値: { render(), sync() }  — sync() は値の反映、構造(IDや記号)が変わったときは作り直す
 */
export function createCollectionEditor(el, coll, ctx) {
  const bag = []; let sig = null, openId = null; // openId: 追加した項目は開いた状態で見せる
  const entries = () => Object.entries(ctx.getGame()[coll.path] || {});
  const sigOf = () => entries().map(([id, e]) => id + ":" + e.symbol).join("|");
  const fieldsFor = id => coll.itemFields.map(f => ({ ...f, path: `${coll.path}.${id}.${f.key}`, group: coll.path, slider: !!f.slider }));
  const count = sym => ctx.getGame().level.join("").split(sym).length - 1;

  async function add() {
    const g = ctx.clone(ctx.getGame()), col = g[coll.path];
    if (Object.keys(col).length >= coll.max) { ctx.say(`${coll.label}は最大 ${coll.max} 個までです`, "err", 5000); return; }
    const free = freeSymbols(g, ctx.schema)[0];
    if (free === undefined) { ctx.say("使える記号がなくなりました", "err", 5000); return; }
    let n = 1; while (col[coll.idPrefix + n]) n++;
    const e = {}; for (const f of coll.itemFields) e[f.key] = f.default;
    e.symbol = free; e.label = coll.newLabel; col[coll.idPrefix + n] = e; openId = coll.idPrefix + n;
    await ctx.commit(g, `${coll.label}を追加`, { restart: false });
  }
  async function remove(id, e) {
    const n = count(e.symbol);
    if (!confirm(`「${e.label}」を削除しますか?` + (n ? `\nステージに置いた ${n} 個は空きになります。` : ""))) return;
    const g = ctx.clone(ctx.getGame()); delete g[coll.path][id];
    await ctx.commit(g, `${coll.label}を削除`, { restart: true }); // 置いてあった記号は検証で空きになる
  }

  function render() {
    bag.length = 0; sig = sigOf(); el.innerHTML = "";
    const list = entries(), head = document.createElement("div");
    head.className = "chead"; head.innerHTML = `<span class="mute">${list.length} / ${coll.max}</span><button type="button" class="pri mini cadd">＋ ${ctx.esc(coll.label)}を追加</button>`;
    head.querySelector(".cadd").onclick = add; el.appendChild(head);
    list.forEach(([id, e], i) => {
      const d = document.createElement("details"); d.className = "centry"; d.open = list.length <= 3 || i === 0 || id === openId; d.dataset.id = id;
      d.innerHTML = `<summary><span class="sym"></span> <span class="cl"></span></summary><div class="cbody"></div><div class="bar"><button type="button" class="mini cdel">この${ctx.esc(coll.label)}を削除</button></div>`;
      ctx.buildControls(d.querySelector(".cbody"), fieldsFor(id), bag);
      d.querySelector(".cdel").onclick = () => remove(id, ctx.getGame()[coll.path][id]);
      el.appendChild(d);
    });
    bag.forEach(fn => fn()); // 作り直した直後に、現在の値を各コントロールへ反映する
    titles();
  }
  function titles() {
    el.querySelectorAll(".centry").forEach(d => { const e = ctx.getGame()[coll.path][d.dataset.id]; if (!e) return; d.querySelector(".sym").textContent = e.symbol; d.querySelector(".cl").textContent = e.label; });
  }
  function sync() { if (sigOf() !== sig) render(); else { bag.forEach(fn => fn()); titles(); } }
  return { render, sync, coll };
}
