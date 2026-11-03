// 3D描画(Three.js)。ゲームロジックは2Dのまま、座標を (x, y) → (X, Y上向き) に写して描くだけ。
// 奥行き(Z)は見た目専用で、物理・当たり判定には一切関与しない。
//   X = x / T,  Y = (レベル高さ*T - y) / T,  Z = 0 (ステージは Z=-depth/2..+depth/2)
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { T, VW, VH } from "./engine.js";

const FOV = 2 * Math.atan(0.5) * 180 / Math.PI; // 透視投影: 距離=D のとき、注視面で高さ D タイル分が映る(正射投影と同じ見え方)
const LIGHTS = { default: [0.7, 0.45], bright: [0.95, 0.6], dim: [0.3, 0.25] }; // [環境光, 平行光]
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const tmp = new THREE.Object3D();
const PM = new THREE.Matrix4(), MM = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S3 = new THREE.Vector3(), E = new THREE.Euler();

function disposeTree(o) {
  if (o.userData && o.userData.shared) { if (o.isInstancedMesh) o.dispose(); return; } // GLBキャッシュ由来のジオメトリ/マテリアルは共有なので破棄しない
  o.children.forEach(disposeTree);
  if (o.geometry) o.geometry.dispose();
  if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
  if (o.isInstancedMesh) o.dispose();
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

const FACE = 1.0; // 進行方向へ向ける角度(rad)。横から見ても顔が分かる3/4ビュー
const rad = d => d * Math.PI / 180;

/** プレイヤー/敵1体の見た目。プリミティブ→GLB読み込み後に差し替え。ヒットボックスとは独立 */
class Actor {
  constructor(r, kind) {
    this.r = r; this.kind = kind;
    this.anchor = new THREE.Group(); this.facing = new THREE.Group(); this.anchor.add(this.facing);
    this.yaw = 0; this.mixer = null; this.clips = []; this.actions = new Map(); this.cur = null; this.wrapper = null; this.prim = null; this.token = 0; this.warned = new Set();
  }
  configure(cfg, color) {
    const tok = ++this.token;
    this.prim = makePrimitiveCharacter(cfg.primitive, color); this.facing.add(this.prim);
    if (!cfg.model) return;
    this.r.loadModel(cfg.model).then(gltf => {
      if (tok !== this.token) return; // 設定が変わった後に届いた結果は捨てる
      const inst = cloneSkinned(gltf.scene), w = new THREE.Group(); w.add(inst); w.userData.shared = true;
      this.wrapper = w; this.facing.add(w); this.prim.visible = false;
      this.mixer = new THREE.AnimationMixer(inst); this.clips = gltf.animations;
      this.r.onModel && this.r.onModel({ kind: this.kind, url: cfg.model, clips: gltf.animations.map(c => c.name) });
    }).catch(() => {}); // 失敗は loadModel 側で通知済み。プリミティブのまま動き続ける
  }
  clip(cfg, key) {
    const want = cfg.anim && cfg.anim[key];
    if (want) {
      const c = this.clips.find(x => x.name === want);
      if (c) return c;
      const k = this.kind + ":" + want;
      if (!this.warned.has(k)) { this.warned.add(k); this.r.warn(`アニメーション「${want}」がモデルにありません(自動選択に切り替えます)`); }
    }
    return this.clips.find(x => x.name.toLowerCase() === key) || null;
  }
  play(clip, loopOnce) {
    if (!clip) return;
    const next = this.actions.get(clip) || (() => { const a = this.mixer.clipAction(clip); this.actions.set(clip, a); return a; })();
    next.setLoop(loopOnce ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); next.clampWhenFinished = !!loopOnce;
    if (this.cur === next) return;
    next.reset().fadeIn(0.12).play();
    if (this.cur) this.cur.fadeOut(0.12);
    this.cur = next;
  }
  /** 位置・向き・変換(毎フレーム。スライダー即時反映のため設定は毎回読む) */
  update(cfg, box, H, face, dt, animKey, speedScale, loopOnce) {
    const hb = cfg.hitbox;
    // 原点O = ヒットボックス下端中央B から (ox, oy[上が+]) を引いた位置。さらに位置合わせオフセット
    this.anchor.position.set((box.x + box.w / 2 - hb.ox + cfg.offsetX) / T, (H * T - (box.y + box.h) - hb.oy + cfg.offsetY) / T, cfg.offsetZ / T);
    this.yaw += (face * FACE - this.yaw) * (1 - Math.exp(-14 * dt));
    this.facing.rotation.y = this.yaw;
    if (this.wrapper) {
      this.wrapper.scale.setScalar(cfg.scale); this.wrapper.rotation.y = rad(cfg.yaw);
      this.play(this.clip(cfg, animKey) || this.clip(cfg, "idle"), loopOnce);
      if (this.cur) this.cur.timeScale = speedScale;
      this.mixer.update(dt);
    }
  }
}

export class Renderer3D {
  /** hooks: { onWarn(msg), onModel({kind,url,clips}) } */
  constructor(canvas, hooks = {}) {
    this.onWarn = hooks.onWarn; this.onModel = hooks.onModel; this.showHitbox = false;
    this.loader = new GLTFLoader(); this.cache = new Map(); this.ready = new Map(); this.failed = new Set(); this.warnedMsgs = new Set();
    this.versions = {}; this.versionsJson = "{}"; this.dirty = false; this.recs = [];
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); // WebGL非対応なら例外 → 呼び出し側で2Dに戻す
    this.renderer.setPixelRatio(2); // ビューポートに拡大表示されるので高めに固定
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
  // 各タイル種(# ^ o G)は「GLBがあればそのメッシュ、なければプリミティブ」を InstancedMesh にまとめる。
  // GLBタイルの原点は「タイルの下端中央」。見た目だけで、当たり判定(# は1タイルの壁)は変わらない。
  buildStage(eng) {
    if (this.stage) { this.scene.remove(this.stage); disposeTree(this.stage); }
    const { def, grid, W, H } = eng, depth = def.render.depth, tiles = def.assets.tiles, g = new THREE.Group();
    const cells = { "#": [], "^": [], o: [], G: [], cap: [] };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = grid[y][x];
      if (c === "#") { cells["#"].push([x, y]); if (!eng.solid(x, y - 1)) cells.cap.push([x, y]); }
      else if (c === "^" || c === "o" || c === "G") cells[c].push([x, y]);
    }
    const recs = [];
    /** meshes: [{geometry, material, base:Matrix4, shared}]  pos(x,y)→[X,Y,Z]  cfg: {scale,yaw} */
    const add = (list, meshes, pos, cfg, spin = false) => {
      if (!list.length) return;
      const rec = { list, spin, pos, scale: cfg.scale, yaw: rad(cfg.yaw), items: [] };
      for (const m of meshes) {
        const im = new THREE.InstancedMesh(m.geometry, m.material, list.length);
        if (m.shared) im.userData.shared = true;
        g.add(im); rec.items.push({ im, base: m.base });
      }
      recs.push(rec); this.fill(rec, 0, null);
    };
    const mat = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
    const I = new THREE.Matrix4(), flat = { scale: 1, yaw: 0 };
    const prim = (geometry, material, base = I) => [{ geometry, material, base }];
    const at = sym => { // 位置合わせオフセット込みの配置関数(GLB用)
      const t = tiles[sym]; return (x, y) => [x + 0.5 + t.offsetX / T, H - y - 1 + t.offsetY / T, t.offsetZ / T];
    };
    const col = (sym, dflt) => tiles[sym].color || dflt;
    // GLBが読み込み済みならそのメッシュ群、未読込/失敗/メッシュ無しなら null(→プリミティブ)
    const modelMeshes = sym => {
      const url = tiles[sym].model; if (!url) return null;
      const gl = this.readyModel(url); if (!gl) return null;
      gl.scene.updateMatrixWorld(true);
      const out = [];
      gl.scene.traverse(o => { if (o.isMesh && !o.isSkinnedMesh) out.push({ geometry: o.geometry, material: o.material, base: o.matrixWorld.clone(), shared: true }); });
      if (!out.length) { this.warn(`${url}: 描画できるメッシュがありません(スキン付きのみ等)。プリミティブで表示します`); return null; }
      return out;
    };
    const place = (sym, list, primFn, spin = false) => {
      const mm = modelMeshes(sym);
      if (mm) add(list, mm, at(sym), tiles[sym], spin);
      else primFn();
    };
    const SC = (x, y, z) => new THREE.Matrix4().makeScale(x, y, z);
    place("#", cells["#"], () => {
      add(cells["#"], prim(new THREE.BoxGeometry(1, 1, depth), mat(col("#", def.theme.ground))), (x, y) => [x + 0.5, H - y - 0.5, 0], flat);
      add(cells.cap, prim(new THREE.BoxGeometry(1.002, 0.2, depth + 0.02), mat(0x4fa34f)), (x, y) => [x + 0.5, H - y - 0.5 + 0.5 - 0.09, 0], flat);
    });
    place("^", cells["^"], () => {
      const cone = new THREE.ConeGeometry(0.62, 0.85, 4); cone.rotateY(Math.PI / 4);
      add(cells["^"], prim(cone, mat(col("^", 0x4a4f57)), SC(1, 1, depth)), (x, y) => [x + 0.5, H - y - 1 + 0.425, 0], flat);
    });
    place("G", cells.G, () => {
      add(cells.G, prim(new THREE.BoxGeometry(0.125, 2, 0.125), mat(0x555555)), (x, y) => [x + 0.5, H - y - 0.5, 0], flat);
      const flag = new THREE.Shape(); flag.moveTo(0, 0); flag.lineTo(0.6, -0.31); flag.lineTo(0, -0.62);
      add(cells.G, prim(new THREE.ShapeGeometry(flag), mat(col("G", 0xd9342b), { side: THREE.DoubleSide })), (x, y) => [x + 0.56, H - y - 0.5 + 1, 0], flat);
    });
    place("o", cells.o, () => {
      const geo = new THREE.CylinderGeometry(0.25, 0.25, 0.08, 20); geo.rotateX(Math.PI / 2);
      add(cells.o, prim(geo, mat(col("o", 0xf5b800), { emissive: 0x5a4200 })), (x, y) => [x + 0.5, H - y - 0.5, 0], flat, true);
    }, true);
    this.recs = recs; this.stage = g; this.scene.add(g);
  }

  /** 1種類のタイルの全インスタンス行列を更新(コインは回転・取得済みは非表示) */
  fill(rec, t, got) {
    rec.list.forEach(([x, y], i) => {
      const hidden = got && rec.spin && got[x + "," + y];
      const [px, py, pz] = rec.pos(x, y);
      E.set(0, rec.yaw + (rec.spin ? t * 3 + x : 0), 0); Q.setFromEuler(E);
      PM.compose(V.set(px, py, pz), Q, S3.set(hidden ? 0 : rec.scale, hidden ? 0 : rec.scale, hidden ? 0 : rec.scale));
      for (const it of rec.items) { MM.multiplyMatrices(PM, it.base); it.im.setMatrixAt(i, MM); }
    });
    for (const it of rec.items) it.im.instanceMatrix.needsUpdate = true;
  }

  warn(msg) { if (this.warnedMsgs.has(msg)) return; this.warnedMsgs.add(msg); this.onWarn && this.onWarn(msg); }
  /** GLBを読み込む(URL+版ごとにキャッシュ)。失敗は1回だけ通知し、呼び出し側はプリミティブのまま続行する */
  loadModel(url) {
    const key = this.keyOf(url);
    if (!this.cache.has(key)) {
      this.cache.set(key, this.loader.loadAsync(key).then(g => {
        if (!g.scene) throw new Error("シーンがありません");
        this.ready.set(key, g); this.dirty = true; // タイル用に使うステージの作り直しを促す
        return g;
      }).catch(e => { this.failed.add(key); this.warn(`モデルを読み込めません: ${url}(${e && e.message ? e.message : "不正なGLBか、ファイルがありません"})`); throw e; }));
    }
    return this.cache.get(key);
  }
  /** URL + ?v=更新時刻(アップロードで差し替えたら別URLとして再取得される) */
  keyOf(url) { const v = this.versions[url]; return v ? `${url}?v=${v}` : url; }
  /** 読み込み済みなら gltf、未読込なら読み込みを開始して null、失敗済みも null */
  readyModel(url) {
    const key = this.keyOf(url);
    if (this.ready.has(key)) return this.ready.get(key);
    if (!this.failed.has(key) && !this.cache.has(key)) this.loadModel(url).catch(() => {});
    return null;
  }
  setVersions(map) { const j = JSON.stringify(map); if (j !== this.versionsJson) { this.versionsJson = j; this.versions = map; this.dirty = true; } }
  invalidate(url) { for (const m of [...this.warnedMsgs]) if (m.includes(url)) this.warnedMsgs.delete(m); }
  /** プレイヤー/敵のモデルの大きさ(px)。ヒットボックス提案に使う。未読込なら null */
  getModelBounds(kind) {
    const a = kind === "player" ? this.player : this.enemies && this.enemies[0];
    if (!a || !a.wrapper) return null;
    const keep = a.facing.rotation.y; a.facing.rotation.y = 0; // 向きの回転で箱が膨らまないよう正面で測る
    a.anchor.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(a.wrapper), sz = b.getSize(new THREE.Vector3());
    a.facing.rotation.y = keep;
    return { w: Math.max(sz.x, sz.z) * T, h: sz.y * T };
  }
  getClips(kind) { const a = kind === "player" ? this.player : this.enemies && this.enemies[0]; return a ? a.clips.map(c => c.name) : []; }

  /* ---------- キャラ(プレイヤー・敵) ---------- */
  buildChars(eng) {
    if (this.chars) { this.scene.remove(this.chars); disposeTree(this.chars); }
    const a = eng.def.assets, g = new THREE.Group();
    this.player = new Actor(this, "player"); this.player.configure(a.player, a.player.primitive.color || eng.def.theme.player); g.add(this.player.anchor);
    this.enemies = eng.S.en.map(() => { const m = new Actor(this, "enemy"); m.configure(a.enemy, a.enemy.primitive.color); g.add(m.anchor); return m; });
    // ヒットボックスのワイヤーフレーム(デバッグ表示。深度テストなしで常に手前)
    const rect = new THREE.BufferGeometry().setFromPoints([[-.5, 0], [.5, 0], [.5, 1], [-.5, 1]].map(([x, y]) => new THREE.Vector3(x, y, 0)));
    const mk = color => { const l = new THREE.LineLoop(rect, new THREE.LineBasicMaterial({ color, depthTest: false })); l.renderOrder = 999; l.visible = false; g.add(l); return l; };
    this.hitP = mk(0x00ff66); this.hitE = this.enemies.map(() => mk(0xff3b30));
    this.chars = g; this.scene.add(g); this.sRef = eng.S;
  }

  /* ---------- 毎フレーム ---------- */
  render(eng, dt) {
    const def = eng.def, R = def.render, S = eng.S, H = eng.H, W = eng.W, A = def.assets;
    this.t += dt;
    // 作り直しが必要な変更だけをシグネチャに入れる(スケール・向き・オフセット等は毎フレーム反映)
    const sig = JSON.stringify([A.player.primitive, A.enemy.primitive, A.player.model, A.enemy.model, def.theme.player, this.versionsJson]);
    const stageSig = JSON.stringify([R.depth, def.theme.ground, A.tiles, this.versionsJson, this.ready.size]);
    const levelChanged = this.levelRef !== def.level || this.eng !== eng;
    if (levelChanged || sig !== this.sig) { this.buildStage(eng); this.buildChars(eng); this.levelRef = def.level; this.eng = eng; this.sig = sig; this.stageSig = stageSig; this.cam = null; }
    else if (stageSig !== this.stageSig || this.dirty) { this.buildStage(eng); this.stageSig = stageSig; }
    else if (this.sRef !== S) this.buildChars(eng); // 死亡・リスタートで敵が復活したとき
    this.dirty = false;

    const p = S.p, ph = def.physics;
    if (!this.pFace) this.pFace = 1;
    if (p.vx > 5) this.pFace = 1; else if (p.vx < -5) this.pFace = -1;
    const key = p.on ? (Math.abs(p.vx) > 20 ? "run" : "idle") : (p.vy < 0 ? "jump" : "fall");
    this.player.update(A.player, p, H, this.pFace, dt, key, key === "run" ? Math.max(0.4, Math.abs(p.vx) / ph.moveSpeed) : 1, key === "jump");
    S.en.forEach((e, i) => { const m = this.enemies[i]; m.anchor.visible = e.alive; m.update(A.enemy, e, H, e.d, dt, "walk", 1, false); });

    // ヒットボックス(物理の当たり判定そのもの)
    const box = (l, b) => { l.visible = this.showHitbox; l.position.set((b.x + b.w / 2) / T, (H * T - (b.y + b.h)) / T, 0); l.scale.set(b.w / T, b.h / T, 1); };
    box(this.hitP, p); S.en.forEach((e, i) => { box(this.hitE[i], e); this.hitE[i].visible = this.showHitbox && e.alive; });

    // コイン(回転・取得済みは非表示)
    for (const rec of this.recs) if (rec.spin) this.fill(rec, this.t, S.got);

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
