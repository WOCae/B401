// テスト用の簡単なGLB(人型プレイヤー / 敵 / タイル4種)を外部ライブラリなしで生成する。
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


/** 任意の頂点データからメッシュを作る(平らな面: 面ごとに法線) */
function rawMesh(g, name, tris, mat) { // tris: [[a,b,c],...] 各頂点は[x,y,z]。法線は面から計算
  const P = [], N = [], I = [];
  tris.forEach(([a, b, c], i) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const l = Math.hypot(...n) || 1; n = n.map(x => x / l);
    P.push(...a, ...b, ...c); N.push(...n, ...n, ...n); I.push(i * 3, i * 3 + 1, i * 3 + 2);
  });
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], P[i + k]); mx[k] = Math.max(mx[k], P[i + k]); }
  const prim = { attributes: { POSITION: g.accessor(new Float32Array(P), "VEC3", 5126, 34962, [mn, mx]), NORMAL: g.accessor(new Float32Array(N), "VEC3", 5126, 34962) }, indices: g.accessor(new Uint16Array(I), "SCALAR", 5123, 34963), material: mat };
  g.meshes.push({ name, primitives: [prim] }); return g.meshes.length - 1;
}
const pyramid = (g, name, w, h, d, cx, by, cz, mat) => { // 底面は y=by、頂点は by+h
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, top = [cx, by + h, cz];
  const A = [x0, by, z1], B = [x1, by, z1], C = [x1, by, z0], D = [x0, by, z0];
  return rawMesh(g, name, [[A, B, top], [B, C, top], [C, D, top], [D, A, top], [A, D, C], [A, C, B]], mat);
};
const cylZ = (g, name, r, thick, cx, cy, cz, seg, mat) => { // 軸がZの円柱(コイン用)
  const tris = [], f = cz + thick / 2, b = cz - thick / 2, pt = (a, z) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r, z];
  for (let i = 0; i < seg; i++) {
    const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
    tris.push([[cx, cy, f], pt(a0, f), pt(a1, f)], [[cx, cy, b], pt(a1, b), pt(a0, b)], [pt(a0, b), pt(a1, b), pt(a1, f)], [pt(a0, b), pt(a1, f), pt(a0, f)]);
  }
  return rawMesh(g, name, tris, mat);
};

function tileBlock() {
  const g = new Gltf(), stone = g.material("Stone", [0.55, 0.52, 0.5]), top = g.material("Moss", [0.36, 0.65, 0.3]);
  const root = g.node("Root", { children: [g.node("Body", { mesh: g.boxMesh("Body", 1, 0.88, 1, 0, 0.44, 0, stone) }), g.node("Top", { mesh: g.boxMesh("Top", 1, 0.12, 1, 0, 0.94, 0, top) })] });
  return g.glb([root], "platformer-maker sample tile block");
}
function tileSpike() {
  const g = new Gltf(), steel = g.material("Steel", [0.62, 0.66, 0.72]);
  const root = g.node("Root", { children: [-0.3, 0, 0.3].map((x, i) => g.node("Spike" + i, { mesh: pyramid(g, "Spike" + i, 0.3, 0.75, 0.5, x, 0, 0, steel) })) });
  return g.glb([root], "platformer-maker sample tile spike");
}
function tileCoin() {
  const g = new Gltf(), gold = g.material("Gold", [1, 0.78, 0.1]), inner = g.material("GoldInner", [0.9, 0.6, 0.05]);
  const root = g.node("Root", { children: [g.node("Coin", { mesh: cylZ(g, "Coin", 0.3, 0.08, 0, 0.5, 0, 20, gold) }), g.node("CoinInner", { mesh: cylZ(g, "CoinInner", 0.17, 0.11, 0, 0.5, 0, 20, inner) })] });
  return g.glb([root], "platformer-maker sample tile coin");
}
function tileGoal() {
  const g = new Gltf(), pole = g.material("Pole", [0.85, 0.85, 0.85]), flag = g.material("Flag", [0.2, 0.55, 0.9]), base = g.material("Base", [0.4, 0.4, 0.42]);
  const root = g.node("Root", { children: [g.node("Base", { mesh: g.boxMesh("Base", 0.5, 0.1, 0.5, 0, 0.05, 0, base) }), g.node("Pole", { mesh: g.boxMesh("Pole", 0.08, 2, 0.08, 0, 1, 0, pole) }), g.node("Flag", { mesh: g.boxMesh("Flag", 0.55, 0.36, 0.03, 0.3, 1.78, 0, flag) })] });
  return g.glb([root], "platformer-maker sample tile goal");
}

mkdirSync(new URL("../assets/samples/", import.meta.url), { recursive: true });
writeFileSync(new URL("../assets/samples/player.glb", import.meta.url), player());
writeFileSync(new URL("../assets/samples/enemy.glb", import.meta.url), enemy());
for (const [n, f] of [["tile_block", tileBlock], ["tile_spike", tileSpike], ["tile_coin", tileCoin], ["tile_goal", tileGoal]]) writeFileSync(new URL(`../assets/samples/${n}.glb`, import.meta.url), f());
writeFileSync(new URL("../assets/samples/index.json", import.meta.url), JSON.stringify({
  models: [{ path: "assets/samples/player.glb", name: "サンプル人型(Idle/Run/Jump/Fall)", kind: "player" }, { path: "assets/samples/enemy.glb", name: "サンプルの敵(Walk/Idle)", kind: "enemy" },
    { path: "assets/samples/tile_block.glb", name: "サンプル: ブロック(原点=下端中央)", kind: "tile" }, { path: "assets/samples/tile_spike.glb", name: "サンプル: トゲ", kind: "tile" },
    { path: "assets/samples/tile_coin.glb", name: "サンプル: コイン", kind: "tile" }, { path: "assets/samples/tile_goal.glb", name: "サンプル: ゴール", kind: "tile" }] }, null, 1));
console.log("generated assets/samples/{player,enemy}.glb");
