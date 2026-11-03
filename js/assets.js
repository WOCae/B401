// アセット管理UI(GLBのアップロード・一覧・割り当て・差し替え・削除)。
// 割り当ては「人が直接編集」なので、ゲームJSONの model パスを書き換えて保存する(履歴に残る)。
const TARGETS = [["player", "プレイヤー", "assets.player.model"], ["enemy", "敵", "assets.enemy.model"],
  ["#", "ブロック(#)", "assets.tiles.#.model"], ["^", "トゲ(^)", "assets.tiles.^.model"], ["o", "コイン(o)", "assets.tiles.o.model"], ["G", "ゴール(G)", "assets.tiles.G.model"]];

export function modelPathsOf(game) { // 変更検知用: ゲームが参照するモデルパスの一覧
  const a = game.assets;
  return JSON.stringify([a.player.model, a.enemy.model, ...["#", "^", "o", "G"].map(k => a.tiles[k].model)]);
}

/**
 * ctx: { api, $, esc, getGameId(), getGame(), commit(game,label), say(msg,kind,ms), fail(e), onList(list) }
 * 戻り値: { refresh(), list() }
 */
export function initAssets(ctx) {
  const { api, $, esc } = ctx;
  let list = null;

  const kb = n => n >= 1048576 ? (n / 1048576).toFixed(1) + "MB" : Math.max(1, Math.round(n / 1024)) + "KB";
  const setMsg = (t, bad) => { $("assetMsg").textContent = t; $("assetMsg").className = bad ? "warn" : "mute"; };

  /** ブラウザ側の事前チェック(サーバーでも同じ内容を必ず再検証する) */
  async function precheck(file) {
    const L = list ? list.limits : { maxBytes: 5242880 };
    if (!/\.glb$/i.test(file.name)) return "拡張子は .glb のみです";
    if (file.size > L.maxBytes) return `ファイルサイズは ${(L.maxBytes / 1048576).toFixed(0)}MB 以下にしてください(このファイル: ${kb(file.size)})`;
    if (file.size < 28) return "ファイルが小さすぎます";
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (String.fromCharCode(...head) !== "glTF") return "GLBファイルではありません(先頭が glTF ではありません)";
    return null;
  }

  async function doUpload(file, replace) {
    const bad = await precheck(file);
    if (bad) { setMsg(bad, true); return; }
    try {
      setMsg("アップロード中…");
      const r = await api.uploadAsset(ctx.getGameId(), file, replace);
      setMsg(`${r.replaced ? "差し替えました" : "アップロードしました"}: ${r.asset.name}`);
      await refresh();
    } catch (e) { setMsg(e.message, true); }
  }

  async function assign(path, target) {
    const t = TARGETS.find(x => x[0] === target), g = JSON.parse(JSON.stringify(ctx.getGame()));
    const ks = t[2].split("."); const last = ks.pop(); ks.reduce((a, k) => a[k], g)[last] = path;
    await ctx.commit(g, `${t[1]}のモデルを設定`);
  }

  function render() {
    const box = $("assetList");
    if (!list) { box.innerHTML = ""; return; }
    const row = (a, kind) => {
      const clips = a.info.animations.length ? "アニメ: " + a.info.animations.map(esc).join(", ") : "アニメなし";
      const use = a.used_by.length ? `<span class="tag">使用中: ${a.used_by.map(u => esc(TARGETS.find(t => t[2] === u)?.[1] || u)).join(", ")}</span>` : "";
      const bad = a.valid ? "" : `<div class="warn">⚠ ${a.errors.map(esc).join(" / ")}</div>`;
      const opts = TARGETS.map(t => `<option value="${esc(t[0])}">${esc(t[1])}</option>`).join("");
      return `<div class="asset" data-path="${esc(a.path)}" data-name="${esc(a.name)}">
  <div><b>${esc(a.name)}</b> <span class="mute">${kb(a.size)} · 頂点${a.info.vertices} · ${clips}</span> ${kind === "sample" ? '<span class="tag">サンプル</span>' : ""} ${use}</div>${bad}
  <div class="bar"><select class="asel" aria-label="割り当て先">${opts}</select><button class="aassign">割り当て</button>${a.editable ? `<label class="btnlike">差し替え<input type="file" class="arep" accept=".glb" hidden></label><button class="adel">削除</button>` : ""}</div></div>`;
    };
    box.innerHTML = (list.uploads.length ? list.uploads.map(a => row(a, "up")).join("") : '<p class="mute">アップロード済みのGLBはありません。</p>') +
      `<details><summary>サンプル(${list.samples.length})</summary>${list.samples.map(a => row(a, "sample")).join("")}</details>`;
  }

  async function refresh() {
    try {
      list = await api.listAssets(ctx.getGameId());
      render(); ctx.onList(list);
    } catch (e) { setMsg(e.message, true); }
  }

  $("assetUp").onclick = () => {
    const f = $("assetFile").files[0];
    if (!f) { setMsg("ファイルを選んでください", true); return; }
    doUpload(f, null).then(() => { $("assetFile").value = ""; });
  };
  $("assetList").addEventListener("click", async e => {
    const row = e.target.closest(".asset"); if (!row) return;
    if (e.target.matches(".aassign")) await assign(row.dataset.path, row.querySelector(".asel").value);
    if (e.target.matches(".adel")) {
      if (!confirm(`${row.dataset.name} を削除しますか?`)) return;
      try { await api.deleteAsset(ctx.getGameId(), row.dataset.name); setMsg("削除しました"); await refresh(); }
      catch (err) { setMsg(err.message, true); }
    }
  });
  $("assetList").addEventListener("change", e => {
    if (!e.target.matches(".arep")) return;
    const row = e.target.closest(".asset"), f = e.target.files[0];
    if (f) doUpload(f, row.dataset.name);
  });

  return { refresh, list: () => list };
}
