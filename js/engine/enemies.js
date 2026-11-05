// 敵の動き(固定の語彙)。ゲーム定義の enemyTypes[*].behavior がここの名前を指す。
// walk は元のプロトタイプと同じ挙動(足場の端と壁で反転)。fly は壁で反転し、上下にゆれる。
import { T } from "../engine.js";

export const BEHAVIORS = {
  walk: {
    label: "歩く",
    move(eng, e, dt) {
      const nx = e.x + e.d * e.speed * dt, ah = e.d > 0 ? nx + e.w : nx;
      const tx = Math.floor(ah / T), ty = Math.floor((e.y + e.h - 1) / T);
      if (eng.solid(tx, ty) || !eng.solid(tx, ty + 1)) e.d *= -1; else e.x = nx;
    },
  },
  fly: {
    label: "飛ぶ",
    move(eng, e, dt) {
      e.t += dt;
      const nx = e.x + e.d * e.speed * dt, ah = e.d > 0 ? nx + e.w : nx;
      const tx = Math.floor(ah / T), ty = Math.floor((e.y + e.h / 2) / T);
      if (eng.solid(tx, ty)) e.d *= -1; else e.x = nx;
      e.y = e.y0 - (0.5 - 0.5 * Math.cos(e.t * 2)) * e.amp * T; // 出発点より上だけにゆれる(地面にもぐらない)
    },
  },
};
