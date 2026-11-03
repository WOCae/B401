// 3D描画(Three.js)。ゲームロジックは2Dのまま、座標を (x, y) → (X, Y上向き) に写して描くだけ。
// 奥行き(Z)は見た目専用で、物理・当たり判定には一切関与しない。
//   X = x / T,  Y = (レベル高さ*T - y) / T,  Z = 0 (ステージは Z=-depth/2..+depth/2)
import * as THREE from "three";
import { T, VW, VH } from "./engine.js";

const FOV = 2 * Math.atan(0.5) * 180 / Math.PI; // 透視投影: 距離=D のとき、注視面で高さ D タイル分が映る(正射投影と同じ見え方)
const LIGHTS = { default: [0.7, 0.45], bright: [0.95, 0.6], dim: [0.3, 0.25] }; // [環境光, 平行光]
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const tmp = new THREE.Object3D();

function disposeTree(o) {
  o.traverse(n => {
    if (n.geometry) n.geometry.dispose();
    if (n.material) (Array.isArray(n.material) ? n.material : [n.material]).forEach(m => m.dispose());
    if (n.isInstancedMesh) n.dispose();
  });
}

/** JSONのパラメータからプリミティブキャラを作る。原点=足元中央、+Z が正面 */
export function makePrimitiveCharacter(p, color) {
  const w = p.width / T, h = p.height / T, root = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color });
  let geo, front = w / 2;
  if (p.shape === "box") geo = new THREE.BoxGeometry(w, h, w);
  else if (p.shape === "sphere") { geo = new THREE.SphereGeometry(0.5, 24, 16); geo.scale(w, h, w); front = w * 0.5 * 0.86; }
  else { // capsule: 半径は幅と高さの小さい方。余りは楕円に伸ばす
    const r = Math.min(w, h) / 2;
    geo = new THREE.CapsuleGeometry(r, Math.max(0, h - 2 * r), 6, 20);
    geo.scale(w / (2 * r), 1, w / (2 * r)); front = w * 0.5 * 0.88;
  }
  const body = new THREE.Mesh(geo, mat); body.position.y = h / 2; root.add(body);
  if (p.eyes) {
    const er = Math.max(0.05, Math.min(w, h) * 0.13);
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff }), dark = new THREE.MeshBasicMaterial({ color: 0x1b1f27 });
    const eg = new THREE.SphereGeometry(er, 12, 8), pg = new THREE.SphereGeometry(er * 0.5, 10, 6);
    for (const sx of [-1, 1]) {
      const e = new THREE.Mesh(eg, white), pu = new THREE.Mesh(pg, dark);
      e.position.set(sx * w * 0.22, h * 0.64, front); pu.position.set(sx * w * 0.22, h * 0.64, front + er * 0.62);
      root.add(e, pu);
    }
  }
  root.userData.yaw = 0;
  return root;
}

export class Renderer3D {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); // WebGL非対応なら例外 → 呼び出し側で2Dに戻す
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(VW, VH, false);
    this.scene = new THREE.Scene();
    this.hemi = new THREE.HemisphereLight(0xffffff, 0xcfd3d8, 1);
    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.sun.position.set(-4, 8, 10);
    this.scene.add(this.hemi, this.sun);
    this.camO = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 300);
    this.camP = new THREE.PerspectiveCamera(FOV, VW / VH, 0.1, 300);
    this.stage = null; this.chars = null; this.levelRef = null; this.sig = ""; this.sRef = null; this.cam = null; this.t = 0;
  }

  dispose() { this.stage && disposeTree(this.stage); this.chars && disposeTree(this.chars); this.renderer.dispose(); }

  /* ---------- ステージ(levelからメッシュを生成。同種タイルは InstancedMesh) ---------- */
  buildStage(eng) {
    if (this.stage) { this.scene.remove(this.stage); disposeTree(this.stage); }
    const { def, grid, W, H } = eng, depth = def.render.depth, g = new THREE.Group();
    const cells = { "#": [], "^": [], o: [], G: [], cap: [] };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = grid[y][x];
      if (c === "#") { cells["#"].push([x, y]); if (!eng.solid(x, y - 1)) cells.cap.push([x, y]); }
      else if (c === "^" || c === "o" || c === "G") cells[c].push([x, y]);
    }
    const inst = (geo, color, list, place, extra = {}) => {
      if (!list.length) return null;
      const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color, ...extra }), list.length);
      list.forEach(([x, y], i) => { tmp.position.set(0, 0, 0); tmp.rotation.set(0, 0, 0); tmp.scale.set(1, 1, 1); place(tmp, x, H - y - 0.5); tmp.updateMatrix(); m.setMatrixAt(i, tmp.matrix); });
      m.instanceMatrix.needsUpdate = true; g.add(m); return m;
    };
    inst(new THREE.BoxGeometry(1, 1, depth), def.theme.ground, cells["#"], (o, x, cy) => o.position.set(x + 0.5, cy, 0));
    inst(new THREE.BoxGeometry(1.002, 0.2, depth + 0.02), 0x4fa34f, cells.cap, (o, x, cy) => o.position.set(x + 0.5, cy + 0.5 - 0.09, 0));
    const cone = new THREE.ConeGeometry(0.62, 0.85, 4); cone.rotateY(Math.PI / 4);
    inst(cone, 0x4a4f57, cells["^"], (o, x, cy) => { o.position.set(x + 0.5, cy - 0.5 + 0.425, 0); o.scale.set(1, 1, depth); });
    inst(new THREE.BoxGeometry(0.125, 2, 0.125), 0x555555, cells.G, (o, x, cy) => o.position.set(x + 0.5, cy, 0));
    const flag = new THREE.Shape(); flag.moveTo(0, 0); flag.lineTo(0.6, -0.31); flag.lineTo(0, -0.62);
    inst(new THREE.ShapeGeometry(flag), 0xd9342b, cells.G, (o, x, cy) => o.position.set(x + 0.56, cy + 1, 0), { side: THREE.DoubleSide });
    const coinGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.08, 20); coinGeo.rotateX(Math.PI / 2);
    this.coinMesh = inst(coinGeo, 0xf5b800, cells.o, (o, x, cy) => o.position.set(x + 0.5, cy, 0), { emissive: 0x5a4200 });
    this.coinCells = cells.o;
    this.stage = g; this.scene.add(g);
  }

  /* ---------- キャラ(プレイヤー・敵) ---------- */
  buildChars(eng) {
    if (this.chars) { this.scene.remove(this.chars); disposeTree(this.chars); }
    const a = eng.def.assets, g = new THREE.Group();
    this.player = makePrimitiveCharacter(a.player.primitive, a.player.primitive.color || eng.def.theme.player);
    g.add(this.player);
    this.enemies = eng.S.en.map(() => { const m = makePrimitiveCharacter(a.enemy.primitive, a.enemy.primitive.color); g.add(m); return m; });
    this.chars = g; this.scene.add(g); this.sRef = eng.S;
  }

  place(obj, x, feetY, H, faceDir, dt) {
    obj.position.set(x / T, (H * T - feetY) / T, 0);
    const target = faceDir * 1.0; // 進行方向へ約57°向ける(横から見ても顔が分かる)
    obj.userData.yaw += (target - obj.userData.yaw) * (1 - Math.exp(-14 * dt));
    obj.rotation.y = obj.userData.yaw;
  }

  /* ---------- 毎フレーム ---------- */
  render(eng, dt) {
    const def = eng.def, R = def.render, S = eng.S, H = eng.H, W = eng.W;
    this.t += dt;
    const sig = JSON.stringify([R.depth, def.theme.ground, def.theme.player, def.assets]);
    const levelChanged = this.levelRef !== def.level || this.eng !== eng;
    if (levelChanged || sig !== this.sig) { this.buildStage(eng); this.buildChars(eng); this.levelRef = def.level; this.eng = eng; this.sig = sig; this.cam = null; }
    else if (this.sRef !== S) this.buildChars(eng); // 死亡・リスタートで敵が復活したとき

    const p = S.p;
    if (!this.pFace) this.pFace = 1;
    if (p.vx > 5) this.pFace = 1; else if (p.vx < -5) this.pFace = -1;
    this.place(this.player, p.x + p.w / 2, p.y + p.h, H, this.pFace, dt);
    S.en.forEach((e, i) => { const m = this.enemies[i]; m.visible = e.alive; this.place(m, e.x + e.w / 2, e.y + e.h, H, e.d, dt); });

    // コイン(回転・取得済みは非表示)
    if (this.coinMesh) {
      this.coinCells.forEach(([x, y], i) => {
        const got = S.got[x + "," + y];
        tmp.position.set(x + 0.5, H - y - 0.5, 0); tmp.rotation.set(0, this.t * 3 + x, 0); tmp.scale.setScalar(got ? 0 : 1); tmp.updateMatrix();
        this.coinMesh.setMatrixAt(i, tmp.matrix);
      });
      this.coinMesh.instanceMatrix.needsUpdate = true;
    }

    // カメラ
    const C = R.camera, visH = C.distance, visW = visH * (VW / VH);
    const fx = C.follow === "player" ? (p.x + p.w / 2) / T : W / 2;
    const fy = C.follow === "player" ? (H * T - (p.y + p.h / 2)) / T : H / 2;
    const tx = W <= visW ? visW / 2 : clamp(fx, visW / 2, W - visW / 2);
    const ty = H <= visH ? visH / 2 : clamp(fy, visH / 2, H - visH / 2);
    if (!this.cam) this.cam = { x: tx, y: ty };
    const k = 1 - Math.exp(-12 * dt);
    this.cam.x += (tx - this.cam.x) * k; this.cam.y += (ty - this.cam.y) * k;
    const th = C.angle * Math.PI / 180, ortho = C.type === "orthographic", D = ortho ? 40 : C.distance;
    const cam = ortho ? this.camO : this.camP;
    if (ortho) { cam.left = -visW / 2; cam.right = visW / 2; cam.top = visH / 2; cam.bottom = -visH / 2; cam.updateProjectionMatrix(); }
    cam.position.set(this.cam.x, this.cam.y + Math.sin(th) * D, Math.cos(th) * D);
    cam.lookAt(this.cam.x, this.cam.y, 0);

    const [amb, sun] = LIGHTS[R.lighting];
    this.hemi.intensity = amb * Math.PI; this.sun.intensity = sun * Math.PI; // r155以降の物理ベースのライトは π 倍して旧来の明るさに合わせる
    this.renderer.setClearColor(def.theme.sky);
    this.renderer.render(this.scene, cam);
  }
}
