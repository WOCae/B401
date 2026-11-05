// 難易度診断(ジャンプ到達性)。PHP側 api/lib/schema.php の diagnose() と同じ式。

/** game は validateGame 済みのもの */
export function diagnose(game, schema) {
  const T = schema.tileSize, ph = game.physics;
  let jh = (ph.jumpVelocity * ph.jumpVelocity) / (2 * ph.gravity) / T;
  let jd = ph.moveSpeed * (2 * ph.jumpVelocity / ph.gravity) / T;
  // 二段ジャンプ(頂点で2回目・初速0.9倍)なら、高さは約1.81倍・滞空時間(=距離)は約1.62倍
  const dj = !!(game.player && game.player.doubleJump);
  if (dj) { jh *= 1 + 0.81; jd *= (1 + 0.9 + Math.sqrt(1 + 0.81)) / 2; }
  const rows = game.level.map(r => Array.from(r));
  const H = rows.length, W = Math.max(...rows.map(r => r.length));
  let max = 0, run = 0;
  for (let x = 0; x < W; x++) {
    let has = false;
    for (let y = Math.max(0, H - 2); y < H; y++) if (rows[y][x] === "#") has = true;
    run = has ? 0 : run + 1;
    max = Math.max(max, run);
  }
  const ok = max * T <= jd * T - 8;
  return { jumpHeightTiles: jh, jumpDistanceTiles: jd, widestGapTiles: max, gapsClearable: ok };
}
