// GLBモデル・アニメーション・ヒットボックスの画面テスト(要 Playwright / 起動済みのPHPサーバー)
const { chromium } = require('playwright');
const OUT = process.env.OUT || '/tmp', BASE = process.env.BASE || 'http://127.0.0.1:8099';
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1100, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await p.goto(BASE + '/index.html?debug&showall&server=1'); await p.waitForSelector('#c_render_mode'); await p.waitForTimeout(400);
  const out = {}; const J = async () => JSON.parse(await p.inputValue('#json'));
  const pos = () => p.evaluate(() => { const s = window.__app.engine.S; return [Math.round(s.p.x), Math.round(s.p.y)]; });
  const status = () => p.textContent('#status');
  await p.selectOption('#c_render_mode', '3d');
  // 1) モデルを指定(UIの入力欄)
  await p.fill('#c_assets_player_model', 'assets/samples/player.glb'); await p.dispatchEvent('#c_assets_player_model', 'change'); await p.waitForTimeout(300);
  await p.fill('#c_assets_enemy_model', 'assets/samples/enemy.glb'); await p.dispatchEvent('#c_assets_enemy_model', 'change'); await p.waitForTimeout(1200);
  out.json = { pm: (await J()).assets.player.model, em: (await J()).assets.enemy.model };
  out.modelinfo = await p.textContent('#modelinfo-enemy');
  out.playerClips = await p.locator('#clips_player option').evaluateAll(o => o.map(x => x.value));
  // 2) 走る → run、ジャンプ → jump/fall のアニメーションが切り替わる
  const clip = () => p.evaluate(() => { const a = window.__view.r3d.player.cur; return a ? a.getClip().name : null; });
  out.clips = {};
  out.clips.idle = await clip();
  await p.keyboard.down('ArrowRight'); await p.waitForTimeout(700);
  out.clips.run = await clip();
  await p.locator('.stage').screenshot({ path: OUT + '/glb_run.png' });
  await p.keyboard.down('Space'); await p.waitForTimeout(250);
  out.clips.jump = await clip();
  await p.locator('.stage').screenshot({ path: OUT + '/glb_jump.png' });
  await p.keyboard.up('Space');
  for (let i = 0; i < 40 && out.clips.fall !== 'Fall'; i++) { await p.waitForTimeout(25); out.clips.fall = await clip(); } // 落下中のクリップを待つ
  await p.keyboard.up('Space'); await p.keyboard.up('ArrowRight'); await p.waitForTimeout(200);
  // 3) スライダー確定でプレイヤー位置がリセットされない
  await p.keyboard.down('ArrowRight'); await p.waitForTimeout(500); await p.keyboard.up('ArrowRight');
  const before = await pos();
  await p.locator('#c_physics_gravity').fill('1500'); await p.dispatchEvent('#c_physics_gravity', 'change'); await p.waitForTimeout(500);
  const after = await pos();
  out.noResetOnCommit = Math.abs(before[0] - after[0]) < 40;
  // 4) ヒットボックス表示 + スケール/オフセット変更
  await p.check('#showHit'); await p.waitForTimeout(300);
  await p.locator('#c_assets_player_hitbox_w').fill('30'); await p.dispatchEvent('#c_assets_player_hitbox_w', 'change'); await p.waitForTimeout(400);
  out.hitboxW = (await J()).assets.player.hitbox.w;
  await p.locator('.stage').screenshot({ path: OUT + '/glb_hitbox.png' });
  await p.uncheck('#showHit');
  // 5) 存在しないパス → 警告を出してプリミティブのまま動く
  await p.fill('#c_assets_enemy_model', 'assets/samples/nothing.glb'); await p.dispatchEvent('#c_assets_enemy_model', 'change'); await p.waitForTimeout(1500);
  out.missing = await status();
  // 7) 不正なパス形式は検証で既定値に戻る
  await p.fill('#c_assets_player_model', '../secret.glb'); await p.dispatchEvent('#c_assets_player_model', 'change'); await p.waitForTimeout(700);
  out.badPath = { value: (await J()).assets.player.model, status: await status() };
  // 8) 未登録のアニメ名 → 警告して自動選択
  await p.fill('#c_assets_enemy_model', 'assets/samples/enemy.glb'); await p.dispatchEvent('#c_assets_enemy_model', 'change'); await p.waitForTimeout(500);
  await p.fill('#c_assets_player_model', 'assets/samples/player.glb'); await p.dispatchEvent('#c_assets_player_model', 'change'); await p.waitForTimeout(900);
  await p.fill('#c_assets_player_anim_run', 'NoSuchClip'); await p.dispatchEvent('#c_assets_player_anim_run', 'change'); await p.keyboard.down('ArrowRight'); await p.waitForTimeout(900); await p.keyboard.up('ArrowRight');
  out.badClip = await status();
  out.runClipFallback = await p.evaluate(() => { const a = window.__view.r3d.player.cur; return a ? a.getClip().name : null; });
  out.errs = errs; console.log(JSON.stringify(out, null, 1)); await b.close();
})();
