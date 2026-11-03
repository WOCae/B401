// GLB検証のJS版(js/glb.js)とPHP版(api/lib/assets.php)が同じ結果になることを確認する
import { readFileSync, writeFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectGlb, sanitizeBase } from "../js/glb.js";
const root = new URL("..", import.meta.url).pathname, tmp = mkdtempSync(join(tmpdir(), "pm-glb-"));
const files = [];
for (const f of readdirSync(join(root, "assets/samples"))) if (f.endsWith(".glb")) files.push(join(root, "assets/samples", f));
for (const f of ["truncated.glb", "not_glb.glb"]) files.push(join(root, "tests/fixtures", f));
const sample = new Uint8Array(readFileSync(join(root, "assets/samples/player.glb")));
function repack(glb, mutate) { // JSONチャンクを書き換えて再梱包
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength), jl = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jl))); mutate(json);
  let js = new TextEncoder().encode(JSON.stringify(json)); const pad = (4 - js.length % 4) % 4; if (pad) { const t = new Uint8Array(js.length + pad).fill(32); t.set(js); js = t; }
  const rest = glb.subarray(20 + jl), out = new Uint8Array(20 + js.length + rest.length), o = new DataView(out.buffer);
  out.set(glb.subarray(0, 12)); o.setUint32(8, out.length, true); o.setUint32(12, js.length, true); out.set(glb.subarray(16, 20), 16); out.set(js, 20); out.set(rest, 20 + js.length); return out;
}
const variants = {
  "v_external_uri.glb": repack(sample, j => { j.buffers[0].uri = "other.bin"; }),
  "v_data_uri_ok.glb": repack(sample, j => { j.buffers[0].uri = "data:application/octet-stream;base64,AAAA"; }),
  "v_draco.glb": repack(sample, j => { j.extensionsRequired = ["KHR_draco_mesh_compression"]; }),
  "v_php.glb": repack(sample, j => { j.asset.copyright = "<?php echo 1; ?>"; }),
  "v_no_version.glb": repack(sample, j => { delete j.asset.version; }),
  "v_version1.glb": repack(sample, j => { j.asset.version = "1.0"; }),
  "v_unnamed_anim.glb": repack(sample, j => { j.animations[0].name = undefined; delete j.animations[0].name; }),
  "v_many_verts.glb": repack(sample, j => { j.accessors[0].count = 400000; }),
  "v_short.glb": sample.subarray(0, 20), "v_cut.glb": sample.subarray(0, 3000),
  "v_badlen.glb": (() => { const c = sample.slice(); new DataView(c.buffer).setUint32(8, 999, true); return c; })(),
  "v_version3.glb": (() => { const c = sample.slice(); new DataView(c.buffer).setUint32(4, 3, true); return c; })(),
  "v_badchunk.glb": (() => { const c = sample.slice(); new DataView(c.buffer).setUint32(16, 0x12345678, true); return c; })(),
};
for (const [n, b] of Object.entries(variants)) { const f = join(tmp, n); writeFileSync(f, b); files.push(f); }
const php = JSON.parse(execFileSync("php", [join(root, "tests/dump_glb.php"), ...files], { maxBuffer: 1 << 26 }).toString());
let pass = 0, fail = 0;
for (const f of files) {
  const name = f.split("/").pop(), js = inspectGlb(new Uint8Array(readFileSync(f))), p = php[name];
  const same = js.ok === p.ok && JSON.stringify(js.errors) === JSON.stringify(p.errors) && JSON.stringify(js.info) === JSON.stringify(p.info);
  (same ? pass++ : fail++); console.log((same ? "  ok  " : "  NG  ") + name + (same ? ` (${js.ok ? "有効" : js.errors[0].slice(0, 24)})` : `\n    JS : ${JSON.stringify(js)}\n    PHP: ${JSON.stringify(p)}`));
}
// ファイル名のサニタイズ(乱数部分を除く)
for (const [i, e] of [["My Player (日本語)!.glb", "my-player"], ["日本語.glb", "model"], ["a.b.c.glb", "a-b-c"], ["../../etc/passwd.glb", "passwd"], ["C:\\x\\Y Z.GLB", "y-z"], ["  --__a__--.glb", "a"], ["x".repeat(80) + ".glb", "x".repeat(40)]]) {
  const got = sanitizeBase(i); (got === e ? pass++ : fail++); console.log((got === e ? "  ok  " : "  NG  ") + `sanitize: ${JSON.stringify(i).slice(0, 30)} -> ${got}` + (got === e ? "" : `  (期待 ${e})`));
}
rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} 件成功 / ${fail} 件失敗`); process.exit(fail ? 1 : 0);
