// アップロードAPIのテスト(起動済みのPHPサーバーに対して実行)
//   php -d upload_max_filesize=6M -d post_max_size=8M -S 127.0.0.1:8099 -t .  →  node tests/api_assets.mjs
import { readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
const BASE = process.env.BASE || "http://127.0.0.1:8099", API = BASE + "/api/index.php";
const sample = new Uint8Array(readFileSync(new URL("../assets/samples/player.glb", import.meta.url)));
const GID = "t-up-" + Math.random().toString(36).slice(2, 7);
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { (cond ? pass++ : fail++); console.log((cond ? "  ok  " : "  NG  ") + name + (cond ? "" : "  " + extra)); };

/** GLBのJSONチャンクを書き換えて再梱包 */
function repack(glb, mutate) {
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength), jl = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jl))); mutate(json);
  let js = new TextEncoder().encode(JSON.stringify(json)); const pad = (4 - js.length % 4) % 4; if (pad) { const t = new Uint8Array(js.length + pad).fill(32); t.set(js); js = t; }
  const rest = glb.subarray(20 + jl), out = new Uint8Array(20 + js.length + rest.length), o = new DataView(out.buffer);
  out.set(glb.subarray(0, 12)); o.setUint32(8, out.length, true); o.setUint32(12, js.length, true); out.set(glb.subarray(16, 20), 16); out.set(js, 20); out.set(rest, 20 + js.length);
  return out;
}
const post = (tool, body) => fetch(`${API}?tool=${tool}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, ...(await r.json()) }));
const get = (tool, q) => fetch(`${API}?tool=${tool}&` + new URLSearchParams(q)).then(r => r.json());
async function up(bytes, filename, { type = "model/gltf-binary", replace, header = true, gid = GID } = {}) {
  const fd = new FormData(); fd.append("game_id", gid); if (replace) fd.append("replace", replace);
  fd.append("file", new Blob([bytes], { type }), filename);
  const r = await fetch(`${API}?tool=upload_asset`, { method: "POST", body: fd, headers: header ? { "X-Requested-With": "platformer-maker" } : {} });
  return { status: r.status, ...(await r.json()) };
}

console.log("ゲーム作成:", GID);
await post("create_game", { game_id: GID });
const a = await up(sample, "My Player (日本語)!.glb");
ok("正常なGLBをアップロードできる", a.ok && a.result.asset.valid, JSON.stringify(a));
const name = a.ok && a.result.asset.name;
ok("ファイル名がサニタイズされる(小文字英数と-_のみ+乱数)", /^my-player-[0-9a-f]{6}\.glb$/.test(name), name);
ok("クリップ名が取得できる", JSON.stringify(a.result.asset.info.animations) === '["Idle","Run","Jump","Fall"]');
const url = `${BASE}/uploads/${GID}/${name}`;
const res = await fetch(url); ok("アップロードしたGLBが静的配信される", res.status === 200 && (await res.arrayBuffer()).byteLength === sample.length);

const t = (label, r, code, status) => ok(label, r.ok === false && r.error.code === code && (!status || r.status === status), JSON.stringify(r).slice(0, 200));
t("拡張子が .glb 以外は拒否", await up(sample, "x.txt"), "bad_extension", 415);
{ const r = await up(new TextEncoder().encode("<?php system($_GET['c']); ?>"), "evil.php.glb"); ok("拡張子偽装(.php.glb + PHPコード)は拒否", r.ok === false && ["bad_mime", "invalid_glb"].includes(r.error.code), JSON.stringify(r)); }
t("PHPコードを含むGLBは拒否", await up(repack(sample, j => { j.asset.copyright = "<?php echo 1; ?>"; }), "p.glb"), "invalid_glb", 422);
t("外部ファイル参照のGLBは拒否", await up(repack(sample, j => { j.buffers[0].uri = "other.bin"; }), "ext.glb"), "invalid_glb", 422);
t("未対応の圧縮拡張が必須のGLBは拒否", await up(repack(sample, j => { j.extensionsRequired = ["KHR_draco_mesh_compression"]; }), "draco.glb"), "invalid_glb", 422);
t("途中で切れたGLBは拒否", await up(sample.subarray(0, 3000), "cut.glb"), "invalid_glb", 422);
t("先頭だけ glTF のゴミは拒否", await up(new Uint8Array([103, 108, 84, 70, 2, 0, 0, 0, 1, 0, 0, 0, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9]), "junk.glb"), "invalid_glb", 422);
t("MIMEが不正(text/x-php)は拒否", await up(sample, "m.glb", { type: "text/x-php" }), "bad_mime", 415);
t("5MBを超えるファイルは拒否", await up(new Uint8Array(5 * 1024 * 1024 + 10), "big.glb"), "too_large", 413);
t("独自ヘッダが無いリクエストは拒否", await up(sample, "h.glb", { header: false }), "bad_request", 403);
t("存在しないゲームは拒否", await up(sample, "g.glb", { gid: "no-such-game" }), "not_found", 404);
t("replace にパストラバーサルは拒否", await up(sample, "r.glb", { replace: "../../index.glb" }), "not_found", 404);
ok("拒否されたファイルは保存されていない", readdirSync(new URL(`../uploads/${GID}/`, import.meta.url)).filter(f => f.endsWith(".glb")).length === 1);

// 差し替え(同名のまま)
const r2 = await up(repack(sample, j => { j.asset.generator = "replaced"; }), "new.glb", { replace: name });
ok("同名で差し替えできる(参照が切れない)", r2.ok && r2.result.replaced && r2.result.asset.name === name, JSON.stringify(r2).slice(0, 200));

// 一覧・使用中の削除禁止
let l = await get("list_assets", { game_id: GID });
ok("一覧にアップロードとサンプルが出る", l.ok && l.result.uploads.length === 1 && l.result.samples.length >= 2);
const g = (await get("get_game", { game_id: GID })).result;
const game = g.game; game.assets.player.model = `uploads/${GID}/${name}`;
const sv = await post("save_game", { game_id: GID, game, base_version: g.version, label: "モデル指定" });
ok("モデル指定を保存でき、警告なし", sv.ok && !sv.result.warnings.some(w => w.code.startsWith("asset_")), JSON.stringify(sv.result?.warnings));
l = await get("list_assets", { game_id: GID });
ok("使用箇所が分かる", JSON.stringify(l.result.uploads[0].used_by) === '["assets.player.model"]');
t("使用中のファイルは削除できない", await post("delete_asset", { game_id: GID, name }), "in_use", 409);
// 存在しないモデルの警告
const g2 = structuredClone(sv.result.game); g2.assets.tiles["#"].model = `uploads/${GID}/gone.glb`;
const sv2 = await post("save_game", { game_id: GID, game: g2, base_version: sv.result.version });
ok("存在しないモデルは警告(assets.tiles.#.model)", sv2.ok && sv2.result.warnings.some(w => w.code === "asset_missing" && w.path === "assets.tiles.#.model"), JSON.stringify(sv2.result?.warnings));
// 指定を外して削除
const g3 = structuredClone(sv2.result.game); g3.assets.player.model = null; g3.assets.tiles["#"].model = null;
const sv3 = await post("save_game", { game_id: GID, game: g3, base_version: sv2.result.version });
t("不正なファイル名の削除は拒否", await post("delete_asset", { game_id: GID, name: "../../games/x.glb" }), "bad_name");
const del = await post("delete_asset", { game_id: GID, name }); ok("未使用なら削除できる", del.ok, JSON.stringify(del));
ok("削除後は配信されない", (await fetch(url)).status === 404);
void sv3;

// 後始末
rmSync(new URL(`../uploads/${GID}/`, import.meta.url), { recursive: true, force: true });
if (process.env.PM_DATA_DIR && existsSync(`${process.env.PM_DATA_DIR}/${GID}`)) rmSync(`${process.env.PM_DATA_DIR}/${GID}`, { recursive: true, force: true });
console.log(`\n${pass} 件成功 / ${fail} 件失敗`); process.exit(fail ? 1 : 0);
