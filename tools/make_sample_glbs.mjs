// テスト用の簡単なGLB(人型プレイヤー / 敵)を外部ライブラリなしで生成する。
//   node tools/make_sample_glbs.mjs   → assets/samples/player.glb, enemy.glb, index.json
// 単位: 1 = 1タイル(32px)。足元が原点、正面は +Z(glTFの慣例)。
import { writeFileSync, mkdirSync } from "node:fs";

class Gltf {
  constructor() { this.nodes = []; this.meshes = []; this.materials = []; this.accessors = []; this.views = []; this.anims = []; this.chunks = []; this.len = 0; }
  _buf(typed) { // 4バイト境界に詰めて bufferView を作る
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    const pad = (4 - (this.len % 4)) % 4; if (pad) { this.chunks.push(new Uint8Array(pad)); this.len += pad; }
    const view = { buffer: 0, byteOffset: this.len, byteLength: bytes.length }; this.chunks.push(bytes); this.len += bytes.length;
    this.views.push(view); return this.views.length - 1;
  }
  accessor(typed, type, ctype, target, minmax) {
    const a = { bufferView: this._buf(typed), componentType: ctype, count: typed.length / { SCALAR: 1, VEC3: 3, VEC4: 4 }[type], type };
    if (target) this.views[a.bufferView].target = target;
    if (minmax) { a.min = minmax[0]; a.max = minmax[1]; }
    this.accessors.push(a); return this.accessors.length - 1;
  }
  material(name, rgb) { this.materials.push({ name, pbrMetallicRoughness: { baseColorFactor: [...rgb, 1], metallicFactor: 0, roughnessFactor: 0.9 } }); return this.materials.length - 1; }
  boxMesh(name, w, h, d, cx, cy, cz, mat) {
    const hx = w / 2, hy = h / 2, hz = d / 2, P = [], N = [], I = [];
    const faces = [[[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]], [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
      [[0, 1, 0], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]], [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
      [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]], [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]]];
    faces.forEach(([n, vs], f) => { vs.forEach(v => { P.push(cx + v[0] * hx, cy + v[1] * hy, cz + v[2] * hz); N.push(...n); }); I.push(f * 4, f * 4 + 1, f * 4 + 2, f * 4, f * 4 + 2, f * 4 + 3); });
    const pos = new Float32Array(P), mn = [cx - hx, cy - hy, cz - hz], mx = [cx + hx, cy + hy, cz + hz];
    const prim = { attributes: { POSITION: this.accessor(pos, "VEC3", 5126, 34962, [mn, mx]), NORMAL: this.accessor(new Float32Array(N), "VEC3", 5126, 34962) }, indices: this.accessor(new Uint16Array(I), "SCALAR", 5123, 34963), material: mat };
    this.meshes.push({ name, primitives: [prim] }); return this.meshes.length - 1;
  }
  node(name, o = {}) { this.nodes.push({ name, ...o }); return this.nodes.length - 1; }
  /** tracks: [{node, path:"translation"|"rotation"|"scale", times:[], values:[[...],...]}] */
  animation(name, tracks) {
    const samplers = [], channels = [];
    for (const t of tracks) {
      const inp = this.accessor(new Float32Array(t.times), "SCALAR", 5126, null, [[Math.min(...t.times)], [Math.max(...t.times)]]);
      const out = this.accessor(new Float32Array(t.values.flat()), t.path === "rotation" ? "VEC4" : "VEC3", 5126);
      samplers.push({ input: inp, output: out, interpolation: "LINEAR" });
      channels.push({ sampler: samplers.length - 1, target: { node: t.node, path: t.path } });
    }
    this.anims.push({ name, samplers, channels });
  }
  glb(sceneRoots, generator) {
    const total = this.len + ((4 - (this.len % 4)) % 4), bin = new Uint8Array(total); let o = 0;
    for (const c of this.chunks) { bin.set(c, o); o += c.length; }
    const json = { asset: { version: "2.0", generator }, scene: 0, scenes: [{ nodes: sceneRoots }], nodes: this.nodes, meshes: this.meshes, materials: this.materials, accessors: this.accessors, bufferViews: this.views, animations: this.anims, buffers: [{ byteLength: total }] };
    let js = new TextEncoder().encode(JSON.stringify(json)); const jp = (4 - (js.length % 4)) % 4;
    if (jp) { const t = new Uint8Array(js.length + jp).fill(0x20); t.set(js); js = t; }
    const out = new Uint8Array(12 + 8 + js.length + 8 + total), dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
    dv.setUint32(12, js.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(js, 20);
    const bo = 20 + js.length; dv.setUint32(bo, total, true); dv.setUint32(bo + 4, 0x004e4942, true); out.set(bin, bo + 8);
    return out;
  }
}
const quatX = deg => { const h = deg * Math.PI / 360; return [Math.sin(h), 0, 0, Math.cos(h)]; };
const quatZ = deg => { const h = deg * Math.PI / 360; return [0, 0, Math.sin(h), Math.cos(h)]; };

function player() {
  const g = new Gltf(), blue = g.material("Shirt", [0.16, 0.62, 0.56]), navy = g.material("Pants", [0.15, 0.27, 0.33]), skin = g.material("Skin", [0.96, 0.84, 0.63]), dark = g.material("Eye", [0.08, 0.08, 0.1]);
  const mk = (name, mesh, extra) => g.node(name, { mesh, ...extra });
  const legL = g.node("LegL", { translation: [-0.12, 0.25, 0], children: [mk("LegL_mesh", g.boxMesh("LegL", 0.16, 0.25, 0.18, 0, -0.125, 0, navy))] });
  const legR = g.node("LegR", { translation: [0.12, 0.25, 0], children: [mk("LegR_mesh", g.boxMesh("LegR", 0.16, 0.25, 0.18, 0, -0.125, 0, navy))] });
  const armL = g.node("ArmL", { translation: [-0.29, 0.55, 0], children: [mk("ArmL_mesh", g.boxMesh("ArmL", 0.1, 0.28, 0.12, 0, -0.14, 0, skin))] });
  const armR = g.node("ArmR", { translation: [0.29, 0.55, 0], children: [mk("ArmR_mesh", g.boxMesh("ArmR", 0.1, 0.28, 0.12, 0, -0.14, 0, skin))] });
  const torso = mk("Torso", g.boxMesh("Torso", 0.46, 0.32, 0.28, 0, 0.41, 0, blue));
  const head = g.node("Head", { children: [mk("Head_mesh", g.boxMesh("HeadBox", 0.4, 0.3, 0.34, 0, 0.72, 0, skin)),
    mk("EyeL", g.boxMesh("EyeL", 0.07, 0.07, 0.02, -0.1, 0.74, 0.17, dark)), mk("EyeR", g.boxMesh("EyeR", 0.07, 0.07, 0.02, 0.1, 0.74, 0.17, dark))] });
  const upper = g.node("Upper", { children: [torso, head, armL, armR] });
  const root = g.node("Root", { children: [legL, legR, upper] });
  g.animation("Idle", [{ node: upper, path: "translation", times: [0, 0.6, 1.2], values: [[0, 0, 0], [0, 0.02, 0], [0, 0, 0]] },
    { node: armL, path: "rotation", times: [0, 0.6, 1.2], values: [quatX(0), quatX(6), quatX(0)] }, { node: armR, path: "rotation", times: [0, 0.6, 1.2], values: [quatX(0), quatX(-6), quatX(0)] }]);
  const t5 = [0, 0.15, 0.3, 0.45, 0.6], sw = a => [quatX(a), quatX(0), quatX(-a), quatX(0), quatX(a)];
  g.animation("Run", [{ node: legL, path: "rotation", times: t5, values: sw(45) }, { node: legR, path: "rotation", times: t5, values: sw(-45) },
    { node: armL, path: "rotation", times: t5, values: sw(-50) }, { node: armR, path: "rotation", times: t5, values: sw(50) },
    { node: upper, path: "translation", times: [0, 0.15, 0.3, 0.45, 0.6], values: [[0, 0, 0], [0, 0.04, 0], [0, 0, 0], [0, 0.04, 0], [0, 0, 0]] }]);
  g.animation("Jump", [{ node: armL, path: "rotation", times: [0, 0.25], values: [quatX(0), quatX(-150)] }, { node: armR, path: "rotation", times: [0, 0.25], values: [quatX(0), quatX(-150)] },
    { node: legL, path: "rotation", times: [0, 0.25], values: [quatX(0), quatX(25)] }, { node: legR, path: "rotation", times: [0, 0.25], values: [quatX(0), quatX(-20)] }]);
  g.animation("Fall", [{ node: armL, path: "rotation", times: [0, 0.2, 0.4], values: [quatX(-110), quatX(-80), quatX(-110)] }, { node: armR, path: "rotation", times: [0, 0.2, 0.4], values: [quatX(-80), quatX(-110), quatX(-80)] },
    { node: legL, path: "rotation", times: [0, 0.2, 0.4], values: [quatX(15), quatX(-10), quatX(15)] }, { node: legR, path: "rotation", times: [0, 0.2, 0.4], values: [quatX(-10), quatX(15), quatX(-10)] }]);
  return g.glb([root], "platformer-maker sample player");
}

function enemy() {
  const g = new Gltf(), body = g.material("Slime", [0.76, 0.22, 0.2]), spike = g.material("Spike", [0.4, 0.1, 0.1]), white = g.material("White", [1, 1, 1]), dark = g.material("Pupil", [0.05, 0.05, 0.05]);
  const mk = (name, mesh) => g.node(name, { mesh });
  const blob = g.node("Blob", { children: [mk("BlobBody", g.boxMesh("Body", 0.72, 0.5, 0.6, 0, 0.25, 0, body)), mk("SpikeL", g.boxMesh("SpikeL", 0.12, 0.14, 0.12, -0.2, 0.57, 0, spike)), mk("SpikeR", g.boxMesh("SpikeR", 0.12, 0.14, 0.12, 0.2, 0.57, 0, spike)),
    mk("EyeL", g.boxMesh("EyeL", 0.14, 0.14, 0.03, -0.17, 0.32, 0.3, white)), mk("EyeR", g.boxMesh("EyeR", 0.14, 0.14, 0.03, 0.17, 0.32, 0.3, white)),
    mk("PupilL", g.boxMesh("PupilL", 0.07, 0.07, 0.03, -0.17, 0.32, 0.32, dark)), mk("PupilR", g.boxMesh("PupilR", 0.07, 0.07, 0.03, 0.17, 0.32, 0.32, dark))] });
  const root = g.node("Root", { children: [blob] });
  g.animation("Walk", [{ node: blob, path: "scale", times: [0, 0.2, 0.4, 0.6, 0.8], values: [[1, 1, 1], [1.08, 0.88, 1], [1, 1, 1], [1.08, 0.88, 1], [1, 1, 1]] },
    { node: blob, path: "rotation", times: [0, 0.2, 0.4, 0.6, 0.8], values: [quatZ(0), quatZ(4), quatZ(0), quatZ(-4), quatZ(0)] }]);
  g.animation("Idle", [{ node: blob, path: "scale", times: [0, 0.7, 1.4], values: [[1, 1, 1], [1.03, 0.96, 1], [1, 1, 1]] }]);
  return g.glb([root], "platformer-maker sample enemy");
}

mkdirSync(new URL("../assets/samples/", import.meta.url), { recursive: true });
writeFileSync(new URL("../assets/samples/player.glb", import.meta.url), player());
writeFileSync(new URL("../assets/samples/enemy.glb", import.meta.url), enemy());
writeFileSync(new URL("../assets/samples/index.json", import.meta.url), JSON.stringify({
  models: [{ path: "assets/samples/player.glb", name: "サンプル人型(Idle/Run/Jump/Fall)", kind: "player" }, { path: "assets/samples/enemy.glb", name: "サンプルの敵(Walk/Idle)", kind: "enemy" }] }, null, 1));
console.log("generated assets/samples/{player,enemy}.glb");
