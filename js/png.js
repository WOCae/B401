// PNG の tEXt チャンクにテキスト(JSON)を埋め込む/取り出す。ComfyUI と同じ方式(画像として普通に見られ、中にデータが入る)。
// 純粋関数(DOM・fetch非依存)。外部ライブラリなし。
//   埋め込み: IHDR の直後に tEXt チャンクを挿入。画像データ(IDAT)には触れない。
//   取り出し: tEXt(Latin-1)と iTXt(非圧縮・UTF-8)に対応。CRCを検証する。
const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
let CRC_T = null;
function crcTable() {
  if (CRC_T) return CRC_T;
  CRC_T = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_T[n] = c >>> 0; }
  return CRC_T;
}
export function crc32(u8, start = 0, end = u8.length) {
  const t = crcTable(); let c = 0xffffffff;
  for (let i = start; i < end; i++) c = t[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export const isPng = u8 => u8.length >= 8 && SIG.every((v, i) => u8[i] === v);
const typeOf = (u8, p) => String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);

/** チャンク一覧。壊れていれば例外 */
export function readChunks(u8) {
  if (!isPng(u8)) throw new Error("PNG画像ではありません");
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), out = [];
  let pos = 8;
  while (pos + 12 <= u8.length) {
    const len = dv.getUint32(pos), end = pos + 12 + len;
    if (end > u8.length) throw new Error("PNG画像が途中で切れています");
    const type = typeOf(u8, pos + 4);
    out.push({ type, pos, dataStart: pos + 8, len, end });
    pos = end;
    if (type === "IEND") break;
  }
  if (!out.length || out[0].type !== "IHDR") throw new Error("PNG画像が壊れています(IHDRがありません)");
  return out;
}
export function pngSize(u8) {
  const c = readChunks(u8)[0], dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  return { width: dv.getUint32(c.dataStart), height: dv.getUint32(c.dataStart + 4) };
}

/** JSONなどの文字列を、非ASCII文字を \uXXXX にして完全なASCIIにする(tEXtの標準=Latin-1で安全に入れるため) */
export const toAscii = s => s.replace(/[\u007f-￿]/g, ch => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"));

function textChunk(keyword, text) {
  if (!/^[\x20-\x7e]{1,79}$/.test(keyword) || /^ | $/.test(keyword)) throw new Error("tEXtのキーワードが不正です");
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 255) throw new Error("tEXtにはLatin-1の文字しか入れられません(toAsciiを通してください)");
  const klen = keyword.length, len = klen + 1 + text.length, out = new Uint8Array(12 + len), dv = new DataView(out.buffer);
  dv.setUint32(0, len); out.set([0x74, 0x45, 0x58, 0x74], 4); // "tEXt"
  for (let i = 0; i < klen; i++) out[8 + i] = keyword.charCodeAt(i);
  out[8 + klen] = 0;
  for (let i = 0; i < text.length; i++) out[9 + klen + i] = text.charCodeAt(i);
  dv.setUint32(8 + len, crc32(out, 4, 8 + len));
  return out;
}

/** PNGに tEXt を埋め込んだ新しいPNGを返す。entries: [[keyword, text], ...]。同じキーワードの既存チャンクは置き換える */
export function embedText(png, entries) {
  const chunks = readChunks(png), keys = new Set(entries.map(e => e[0])), add = entries.map(([k, t]) => textChunk(k, t));
  const keep = chunks.filter(c => {
    if (c.type !== "tEXt") return true;
    let z = c.dataStart; while (z < c.dataStart + c.len && png[z] !== 0) z++;
    return !keys.has(String.fromCharCode(...png.subarray(c.dataStart, z)));
  });
  const parts = [png.subarray(0, 8)];
  keep.forEach((c, i) => { parts.push(png.subarray(c.pos, c.end)); if (i === 0) add.forEach(a => parts.push(a)); }); // IHDR の直後
  const total = parts.reduce((s, p) => s + p.length, 0), out = new Uint8Array(total);
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const latin1 = (u8, a, b) => { let s = ""; for (let i = a; i < b; i += 8192) s += String.fromCharCode(...u8.subarray(i, Math.min(b, i + 8192))); return s; };

/** 指定キーワードのテキストを取り出す(無ければ null)。CRC不一致は例外 */
export function extractText(u8, keyword) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  for (const c of readChunks(u8)) {
    if (c.type !== "tEXt" && c.type !== "iTXt") continue;
    let z = c.dataStart; const end = c.dataStart + c.len;
    while (z < end && u8[z] !== 0) z++;
    if (latin1(u8, c.dataStart, z) !== keyword) continue;
    if (crc32(u8, c.pos + 4, end) !== dv.getUint32(end)) throw new Error("PNG画像のデータが壊れています(CRC不一致)");
    if (c.type === "tEXt") return latin1(u8, z + 1, end);
    // iTXt: keyword\0 圧縮フラグ 圧縮方式 言語タグ\0 翻訳キーワード\0 テキスト(UTF-8)
    if (u8[z + 1] !== 0) throw new Error("圧縮されたiTXtには対応していません");
    let p = z + 3; while (p < end && u8[p] !== 0) p++; p++; while (p < end && u8[p] !== 0) p++; p++;
    return new TextDecoder("utf-8").decode(u8.subarray(p, end));
  }
  return null;
}
