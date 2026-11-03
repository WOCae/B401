// PNG への JSON 埋め込み(js/png.js)のテスト。最小のPNGをその場で作り、埋め込み・取り出し・破損検出・往復を確認する。
// Python の PIL が使えれば、独立したデコーダーでも「普通のPNGとして読めて、tEXtが見える」ことを確認する。
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, isPng, readChunks, pngSize, embedText, extractText, toAscii } from "../js/png.js";
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { (c ? pass++ : fail++); console.log((c ? "  ok  " : "  NG  ") + n + (c ? "" : "  " + x)); };
const chunk = (type, data) => { const o = new Uint8Array(12 + data.length), dv = new DataView(o.buffer); dv.setUint32(0, data.length); o.set([...type].map(c => c.charCodeAt(0)), 4); o.set(data, 8); dv.setUint32(8 + data.length, crc32(o, 4, 8 + data.length)); return o; };
function makePng(w, h) { // 単色(グラデ)のRGB画像
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer); dv.setUint32(0, w); dv.setUint32(4, h); ihdr.set([8, 2, 0, 0, 0], 8);
  const raw = new Uint8Array((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1); raw[o + 1 + x * 3] = x * 255 / w; raw[o + 2 + x * 3] = y * 255 / h; raw[o + 3 + x * 3] = 128; }
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}
const png = makePng(64, 40);

ok("CRC32の既知の値(\"123456789\" = cbf43926)", crc32(new TextEncoder().encode("123456789")) === 0xcbf43926, crc32(new TextEncoder().encode("123456789")).toString(16));
ok("PNGを判定できる", isPng(png) && !isPng(new TextEncoder().encode('{"a":1}')));
ok("画像サイズを読める", JSON.stringify(pngSize(png)) === '{"width":64,"height":40}');
const proj = { format: "platformer-maker-project", version: 1, title: "はじめてのステージ 🎮", game: { meta: { title: "日本語\"引用\"\n改行" } }, assets: [{ path: "uploads/x/a.glb", data: "QUJD" }] };
const text = toAscii(JSON.stringify(proj));
ok("toAscii は完全なASCIIで、JSONとして元に戻る", /^[\x00-\x7f]*$/.test(text) && JSON.stringify(JSON.parse(text)) === JSON.stringify(proj));
const emb = embedText(png, [["platformer-maker", text], ["Software", "platformer-maker"]]);
ok("埋め込み後もPNGとして構造が正しい", isPng(emb) && readChunks(emb).map(c => c.type).join() === "IHDR,tEXt,tEXt,IDAT,IEND");
ok("画像サイズは変わらない", JSON.stringify(pngSize(emb)) === '{"width":64,"height":40}');
ok("画像データ(IDAT)はそのまま", (() => { const a = readChunks(png).find(c => c.type === "IDAT"), b = readChunks(emb).find(c => c.type === "IDAT"); return a.len === b.len && png.subarray(a.pos, a.end).every((v, i) => v === emb[b.pos + i]); })());
const back = extractText(emb, "platformer-maker");
ok("取り出すと完全に同じテキスト(往復)", back === text && JSON.stringify(JSON.parse(back)) === JSON.stringify(proj));
ok("無いキーワードは null", extractText(emb, "nothing") === null && extractText(png, "platformer-maker") === null);
const again = embedText(emb, [["platformer-maker", toAscii(JSON.stringify({ v: 2 }))]]);
ok("同じキーワードは置き換わる(重複しない)", readChunks(again).filter(c => c.type === "tEXt").length === 2 && JSON.parse(extractText(again, "platformer-maker")).v === 2);
const bad = emb.slice(); const tc = readChunks(bad).find(c => c.type === "tEXt"); bad[tc.dataStart + 30] ^= 0xff;
let err = ""; try { extractText(bad, "platformer-maker"); } catch (e) { err = e.message; }
ok("書き換えられた(壊れた)データはCRCで検出", err.includes("CRC"), err);
err = ""; try { extractText(emb.slice(0, emb.length - 40), "platformer-maker"); } catch (e) { err = e.message; }
ok("途中で切れたPNGは例外", err.includes("途中"), err);
err = ""; try { extractText(new TextEncoder().encode("not a png at all"), "x"); } catch (e) { err = e.message; }
ok("PNGでないものは例外", err.includes("PNG"), err);
// iTXt(UTF-8・非圧縮)で書かれたものも読める
const itxt = (() => { const k = new TextEncoder().encode("platformer-maker"), t = new TextEncoder().encode('{"日本語":"ok"}'); const d = new Uint8Array(k.length + 5 + t.length); d.set(k); d.set([0, 0, 0, 0, 0], k.length); d.set(t, k.length + 5); return chunk("iTXt", d); })();
const withI = (() => { const cs = readChunks(png), o = new Uint8Array(png.length + itxt.length); o.set(png.subarray(0, cs[0].end)); o.set(itxt, cs[0].end); o.set(png.subarray(cs[0].end), cs[0].end + itxt.length); return o; })();
ok("iTXt(UTF-8・非圧縮)も読める", extractText(withI, "platformer-maker") === '{"日本語":"ok"}');
// 大きなデータ(GLB同梱を想定: 20MB)
const big = "A".repeat(20 * 1024 * 1024), t0 = Date.now(), bigEmb = embedText(png, [["platformer-maker", big]]);
ok("20MBのデータでも往復できる", extractText(bigEmb, "platformer-maker") === big, `${Date.now() - t0}ms`);
err = ""; try { embedText(png, [["k", "日本語"]]); } catch (e) { err = e.message; }
ok("非ASCII(Latin-1外)の直接埋め込みは拒否(toAsciiを強制)", err.includes("Latin-1"));
// 独立したデコーダー(PIL)で読めるか
let pil = null; try { execFileSync("python3", ["-c", "import PIL"], { stdio: "ignore" }); pil = true; } catch { pil = false; }
if (pil) {
  const d = mkdtempSync(join(tmpdir(), "pm-png-")), f = join(d, "t.png"); writeFileSync(f, emb);
  const r = execFileSync("python3", ["-c", "import sys,json\nfrom PIL import Image\nim=Image.open(sys.argv[1]); im.load()\nprint(json.dumps({'size':im.size,'keys':sorted(im.text.keys()),'ok':json.loads(im.text['platformer-maker'])['title']}, ensure_ascii=False))", f]).toString();
  const j = JSON.parse(r); rmSync(d, { recursive: true, force: true });
  ok("PIL(独立したデコーダー)でも普通のPNGとして読めて、tEXtが見える", j.size[0] === 64 && j.keys.includes("platformer-maker") && j.keys.includes("Software") && j.ok === "はじめてのステージ 🎮", r);
} else console.log("  (PILが無いので独立デコーダーの確認は省略)");
console.log(`\n${pass} 件成功 / ${fail} 件失敗`); process.exit(fail ? 1 : 0);
