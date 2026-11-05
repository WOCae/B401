// ゲームエンジン(ロジックのみ。描画・DOMに依存しない)。
// 2Dのまま。座標は (x, y) ピクセル、1タイル=32px、固定タイムステップ。
// reference/platformer-maker.html の step()/reset() と同じ挙動。
import { legendOf } from "./legend.js";
import { EFFECTS } from "./engine/effects.js";
import { BEHAVIORS } from "./engine/enemies.js";

export const T = 32, VW = 640, VH = 384, DT = 1 / 60;
const DEFAULT_ASSETS = { player: { hitbox: { w: 22, h: 28 } }, enemy: { hitbox: { w: 24, h: 24 } } };

export class Engine {
  /** def: validateGame 済みのゲーム定義(参照を保持するので、物理値の即時反映が効く) */
  constructor(def) { this.S = null; this.load(def, true); }

  maxHp() { const pl = this.def.player; return pl && pl.hp ? pl.hp : 1; }

  /** carry: 死亡からの再開で引き継ぐもの {deaths, livesLeft} */
  load(def, full = true, carry = null) {
    const deaths = carry ? carry.deaths : (full || !this.S ? 0 : this.S.deaths);
    this.def = def;
    this.legend = legendOf(def);
    this.H = def.level.length;
    this.W = Math.max(...def.level.map(r => r.length));
    this.grid = def.level.map(r => r.padEnd(this.W, ".").split(""));
    // 当たり判定(ヒットボックス)は見た目のモデルとは独立。幅・高さがそのまま物理のAABB。
    // 既定値(プレイヤー22x28 / 敵24x24)は元のプロトタイプと同じで、タイル中央・足元に置く。
    const hp = (def.assets || DEFAULT_ASSETS).player.hitbox, he = (def.assets || DEFAULT_ASSETS).enemy.hitbox, pl = def.player || {};
    const lives = pl.lives > 0 ? pl.lives : null; // null = 残機の制限なし(元の挙動)
    const S = this.S = {
      p: { x: 0, y: 0, w: hp.w, h: hp.h, vx: 0, vy: 0, on: false, coy: 0, buf: 0, hp: pl.hp || 1, iframes: 0, fx: {}, jumpsLeft: 1 },
      en: [], got: {}, coins: 0, total: 0, deaths, t: 0, won: false, over: false, sx: 0, sy: 0,
      livesLeft: carry && carry.livesLeft !== undefined ? carry.livesLeft : lives,
    };
    for (let y = 0; y < this.H; y++) for (let x = 0; x < this.W; x++) {
      const c = this.grid[y][x], lg = this.legend.get(c);
      if (!lg) continue;
      if (lg.kind === "spawn") { S.sx = x * T + (T - hp.w) / 2; S.sy = (y + 1) * T - hp.h; }
      else if (lg.kind === "enemy") {
        const d = lg.def, y0 = (y + 1) * T - he.h;
        S.en.push({ x: x * T + (T - he.w) / 2, y: y0, y0, w: he.w, h: he.h, d: -1, alive: true, t: 0, type: lg.id, behavior: d.behavior, speed: d.speed, amp: d.amp, stompable: d.stompable, color: d.color });
      } else if (lg.kind === "coin") S.total++;
    }
    S.p.x = S.sx; S.p.y = S.sy;
  }

  /** 状態(位置・敵・コイン)を保ったまま定義だけ差し替える。レベルが同じときのみ使う */
  setDef(def) { this.def = def; this.legend = legendOf(def); } // 凡例も作り直す(アイテムの効果が最新の設定を参照するため)
  restart() { this.load(this.def, true); }

  /** ミス: 残機があれば減らして最初から再開、なくなったらゲームオーバー。残機の制限なしなら従来どおり再開 */
  die() {
    const S = this.S, deaths = S.deaths + 1;
    let livesLeft = S.livesLeft;
    if (livesLeft !== null) livesLeft -= 1;
    if (livesLeft !== null && livesLeft <= 0) { S.deaths = deaths; S.livesLeft = 0; S.over = true; return; }
    this.load(this.def, false, { deaths, livesLeft });
  }
  /** ダメージ。無敵中・ダメージ後の無敵中は無効。体力が尽きるとミス。戻り値: "ignored" | "hurt" | "died" */
  hurt(n) {
    const p = this.S.p, pl = this.def.player || {};
    if (p.fx.invincible !== undefined || p.iframes > 0) return "ignored";
    p.hp -= n;
    if (p.hp <= 0) { this.die(); return "died"; }
    p.iframes = pl.hurtInvincible === undefined ? 1.5 : pl.hurtInvincible;
    p.vy = -this.def.physics.jumpVelocity * 0.5; p.on = false; // ダメージで軽く跳ねる
    return "hurt";
  }
  /** 取得したアイテムの効果を適用 */
  collect(item) { const fx = EFFECTS[item.effect]; if (fx) fx.apply(this, item); }

  solid(tx, ty) {
    return tx < 0 || tx >= this.W ? true : (ty < 0 || ty >= this.H ? false : this.grid[ty][tx] === "#");
  }
  hit(x, y, w, h) {
    for (let ty = Math.floor(y / T); ty <= Math.floor((y + h - .01) / T); ty++)
      for (let tx = Math.floor(x / T); tx <= Math.floor((x + w - .01) / T); tx++)
        if (this.solid(tx, ty)) return true;
    return false;
  }

  /** 時間つきの効果(無敵・ブースト等)を進める。残り0で消える */
  tickEffects(dt) {
    const p = this.S.p;
    if (p.iframes > 0) p.iframes = Math.max(0, p.iframes - dt);
    for (const k of Object.keys(p.fx)) { const f = p.fx[k]; if (f.rem !== Infinity) { f.rem -= dt; if (f.rem <= 0) delete p.fx[k]; } }
  }

  /** keys: {l, r, j, jp} 。jp(押した瞬間)はここで消費する */
  step(dt, keys) {
    const S = this.S;
    if (S.won || S.over) return;
    S.t += dt;
    const p = S.p, ph = this.def.physics, pl = this.def.player || {};
    this.tickEffects(dt);
    const jumpV = ph.jumpVelocity * (p.fx.jumpBoost ? p.fx.jumpBoost.mult : 1), moveV = ph.moveSpeed * (p.fx.speedBoost ? p.fx.speedBoost.mult : 1);
    p.vx += ((keys.r - keys.l) * moveV - p.vx) * Math.min(1, ph.accel * dt);
    p.coy = p.on ? ph.coyoteTime : p.coy - dt;
    if (p.on) p.jumpsLeft = 1;
    p.buf = keys.jp ? ph.jumpBuffer : p.buf - dt; keys.jp = false;
    if (p.buf > 0 && p.coy > 0) { p.vy = -jumpV; p.buf = 0; p.coy = 0; p.on = false; }
    else if (p.buf > 0 && !p.on && p.jumpsLeft > 0 && (pl.doubleJump || p.fx.doubleJump)) { // 二段ジャンプ(空中で1回だけ)
      p.vy = -jumpV * 0.9; p.buf = 0; p.jumpsLeft = 0;
    }
    p.vy += ph.gravity * dt * ((!keys.j && p.vy < 0) ? 2 : 1);
    p.vy = Math.min(p.vy, 900);
    p.x += p.vx * dt;
    if (this.hit(p.x, p.y, p.w, p.h)) {
      if (p.vx > 0) p.x = Math.floor((p.x + p.w) / T) * T - p.w - .01; else p.x = (Math.floor(p.x / T) + 1) * T + .01;
      p.vx = 0;
    }
    p.y += p.vy * dt; p.on = false;
    if (this.hit(p.x, p.y, p.w, p.h)) {
      if (p.vy > 0) { p.y = Math.floor((p.y + p.h) / T) * T - p.h - .01; p.on = true; p.jumpsLeft = 1; }
      else p.y = (Math.floor(p.y / T) + 1) * T + .01;
      p.vy = 0;
    }
    const cx = Math.floor((p.x + p.w / 2) / T), cy = Math.floor((p.y + p.h / 2) / T);
    const c = (this.grid[cy] || [])[cx], k = cx + "," + cy, lg = c === undefined ? undefined : this.legend.get(c);
    if (c === "o" && !S.got[k]) { S.got[k] = 1; S.coins++; }
    if (lg && lg.kind === "item" && !S.got[k]) { S.got[k] = 1; this.collect(lg.def); }
    if (c === "^" && this.hurt(1) === "died") return;
    if (c === "G") S.won = true;
    if (p.y > this.H * T + 60) return this.die();
    for (const e of S.en) {
      if (!e.alive) continue;
      BEHAVIORS[e.behavior].move(this, e, dt);
      if (p.x < e.x + e.w && p.x + p.w > e.x && p.y < e.y + e.h && p.y + p.h > e.y) {
        if (p.fx.invincible !== undefined) e.alive = false; // 無敵中は触れた敵を倒す
        else if (e.stompable && p.vy > 0 && p.y + p.h - e.y < 16) { e.alive = false; p.vy = -jumpV * .6; }
        else if (this.hurt(1) === "died") return;
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
