// ゲームエンジン(ロジックのみ。描画・DOMに依存しない)。
// 2Dのまま。座標は (x, y) ピクセル、1タイル=32px、固定タイムステップ。
// reference/platformer-maker.html の step()/reset() と同じ挙動。
export const T = 32, VW = 640, VH = 384, DT = 1 / 60;

export class Engine {
  /** def: validateGame 済みのゲーム定義(参照を保持するので、物理値の即時反映が効く) */
  constructor(def) { this.S = null; this.load(def, true); }

  load(def, full = true) {
    const deaths = full || !this.S ? 0 : this.S.deaths;
    this.def = def;
    this.H = def.level.length;
    this.W = Math.max(...def.level.map(r => r.length));
    this.grid = def.level.map(r => r.padEnd(this.W, ".").split(""));
    const S = this.S = {
      p: { x: 0, y: 0, w: 22, h: 28, vx: 0, vy: 0, on: false, coy: 0, buf: 0 },
      en: [], got: {}, coins: 0, total: 0, deaths, t: 0, won: false, sx: 0, sy: 0,
    };
    for (let y = 0; y < this.H; y++) for (let x = 0; x < this.W; x++) {
      const c = this.grid[y][x];
      if (c === "P") { S.sx = x * T + 5; S.sy = (y + 1) * T - 28; }
      if (c === "E") S.en.push({ x: x * T + 4, y: (y + 1) * T - 24, w: 24, h: 24, d: -1, alive: true });
      if (c === "o") S.total++;
    }
    S.p.x = S.sx; S.p.y = S.sy;
  }

  restart() { this.load(this.def, true); }
  die() { const d = this.S.deaths + 1; this.load(this.def, false); this.S.deaths = d; }

  solid(tx, ty) {
    return tx < 0 || tx >= this.W ? true : (ty < 0 || ty >= this.H ? false : this.grid[ty][tx] === "#");
  }
  hit(x, y, w, h) {
    for (let ty = Math.floor(y / T); ty <= Math.floor((y + h - .01) / T); ty++)
      for (let tx = Math.floor(x / T); tx <= Math.floor((x + w - .01) / T); tx++)
        if (this.solid(tx, ty)) return true;
    return false;
  }

  /** keys: {l, r, j, jp} 。jp(押した瞬間)はここで消費する */
  step(dt, keys) {
    const S = this.S;
    if (S.won) return;
    S.t += dt;
    const p = S.p, ph = this.def.physics;
    p.vx += ((keys.r - keys.l) * ph.moveSpeed - p.vx) * Math.min(1, ph.accel * dt);
    p.coy = p.on ? ph.coyoteTime : p.coy - dt;
    p.buf = keys.jp ? ph.jumpBuffer : p.buf - dt; keys.jp = false;
    if (p.buf > 0 && p.coy > 0) { p.vy = -ph.jumpVelocity; p.buf = 0; p.coy = 0; p.on = false; }
    p.vy += ph.gravity * dt * ((!keys.j && p.vy < 0) ? 2 : 1);
    p.vy = Math.min(p.vy, 900);
    p.x += p.vx * dt;
    if (this.hit(p.x, p.y, p.w, p.h)) {
      if (p.vx > 0) p.x = Math.floor((p.x + p.w) / T) * T - p.w - .01; else p.x = (Math.floor(p.x / T) + 1) * T + .01;
      p.vx = 0;
    }
    p.y += p.vy * dt; p.on = false;
    if (this.hit(p.x, p.y, p.w, p.h)) {
      if (p.vy > 0) { p.y = Math.floor((p.y + p.h) / T) * T - p.h - .01; p.on = true; }
      else p.y = (Math.floor(p.y / T) + 1) * T + .01;
      p.vy = 0;
    }
    const cx = Math.floor((p.x + p.w / 2) / T), cy = Math.floor((p.y + p.h / 2) / T);
    const c = (this.grid[cy] || [])[cx], k = cx + "," + cy;
    if (c === "o" && !S.got[k]) { S.got[k] = 1; S.coins++; }
    if (c === "^") return this.die();
    if (c === "G") S.won = true;
    if (p.y > this.H * T + 60) return this.die();
    for (const e of S.en) {
      if (!e.alive) continue;
      const nx = e.x + e.d * this.def.enemy.speed * dt, ah = e.d > 0 ? nx + e.w : nx;
      const tx = Math.floor(ah / T), ty = Math.floor((e.y + e.h - 1) / T);
      if (this.solid(tx, ty) || !this.solid(tx, ty + 1)) e.d *= -1; else e.x = nx;
      if (p.x < e.x + e.w && p.x + p.w > e.x && p.y < e.y + e.h && p.y + p.h > e.y) {
        if (p.vy > 0 && p.y + p.h - e.y < 16) { e.alive = false; p.vy = -ph.jumpVelocity * .6; } else return this.die();
      }
    }
  }
}

/** 固定タイムステップ(1/60秒)で進める。残り時間を返す */
export function advance(engine, acc, frameSec, keys) {
  acc += Math.min(.1, frameSec);
  while (acc >= DT) { engine.step(DT, keys); acc -= DT; }
  return acc;
}
