// エディタ風UI(ヒエラルキー・インスペクタ・ドックのタブ・ツールバー・テーマ・レイアウト)の画面テスト
const { chromium } = require('playwright');
const OUT = process.env.OUT || '/tmp', BASE = process.env.BASE || 'http://127.0.0.1:8099';
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/404|Failed to load/.test(m.text())) errs.push(m.text()); });
  await p.goto(BASE + '/index.html'); await p.waitForSelector('#hierList .hitem'); await p.waitForTimeout(600);
  const out = {}; const vis = sel => p.locator(sel).first().isVisible();
  out.hierItems = await p.locator('#hierList .hitem').count();
  out.defaultSel = { title: await p.textContent('#inspTitle'), gravity: await vis('#c_physics_gravity'), playerModel: await vis('#c_assets_player_model') };
  // 対象を選ぶとインスペクタが切り替わる
  await p.click('#h_player'); await p.waitForTimeout(100);
  out.playerSel = { title: await p.textContent('#inspTitle'), gravity: await vis('#c_physics_gravity'), model: await vis('#c_assets_player_model'), hitbox: await vis('#c_assets_player_hitbox_w'), enemyModel: await vis('#c_assets_enemy_model') };
  await p.click('#h_tile_spike'); out.tileSel = { model: await vis('#c_assets_tiles_spike_model'), wall: await vis('#c_assets_tiles_wall_model') };
  await p.click('#h_camera'); out.cameraSel = { type: await vis('#c_render_camera_type'), mode: await vis('#c_render_mode') };
  // ドックのタブ
  out.tabs = { assetsOn: await vis('#assetList'), jsonBefore: await vis('#json') };
  await p.click('#t_json'); out.tabs.jsonAfter = await vis('#json'); out.tabs.assetsAfter = await vis('#assetList');
  await p.click('#t_ai'); out.tabs.ai = await vis('#sugbtn button');
  await p.click('#t_diag'); out.tabs.diag = (await p.textContent('#diag')).includes('ジャンプの高さ');
  // ツールバー: 2D/3D・ヒットボックス
  await p.click('#mode3d'); await p.waitForTimeout(1200);
  out.mode3d = { on: await p.evaluate(() => document.getElementById('mode3d').classList.contains('on')), cv3: await p.evaluate(() => !document.getElementById('cv3').classList.contains('off')) };
  await p.click('#t_json'); out.mode3d.json = JSON.parse(await p.inputValue('#json')).render.mode;
  await p.check('#showHit'); await p.waitForTimeout(200);
  await p.click('#mode2d'); await p.waitForTimeout(500);
  out.mode2d = { on: await p.evaluate(() => document.getElementById('mode2d').classList.contains('on')), cv2: await p.evaluate(() => !document.getElementById('cv').classList.contains('off')) };
  await p.uncheck('#showHit');
  // リスタート・元に戻す
  await p.keyboard.down('ArrowRight'); await p.waitForTimeout(500); await p.keyboard.up('ArrowRight');
  await p.click('#restart'); await p.waitForTimeout(200);
  await p.click('#undo'); await p.waitForTimeout(500);
  out.undoMode = JSON.parse(await p.inputValue('#json')).render.mode;
  // ビューポートの大きさ(比率を保って枠に合わせる)
  out.stage = await p.evaluate(() => { const s = document.getElementById('stage').getBoundingClientRect(), v = document.getElementById('viewport').getBoundingClientRect(); return { ratio: +(s.width / s.height).toFixed(3), fits: s.width <= v.width && s.height <= v.height, w: Math.round(s.width) }; });
  // テーマ切替と選択状態の保存
  await p.click('#h_enemy'); const t0 = await p.evaluate(() => document.documentElement.dataset.theme); await p.click('#themeBtn');
  const t1 = await p.evaluate(() => document.documentElement.dataset.theme);
  await p.screenshot({ path: OUT + '/editor_light.png' }); await p.click('#themeBtn');
  await p.reload(); await p.waitForSelector('#hierList .hitem'); await p.waitForTimeout(500);
  out.persist = { theme: [t0, t1], selAfterReload: await p.textContent('#inspTitle'), tab: await p.evaluate(() => document.querySelector('.tabs button.on').dataset.tab) };
  await p.click('#h_world'); await p.click('#t_assets'); await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + '/editor_dark.png' });
  // スマホ幅: 縦に積まれて横スクロールが出ない
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); const q = await m.newPage();
  await q.goto(BASE + '/index.html'); await q.waitForSelector('#hierList .hitem'); await q.waitForTimeout(600);
  out.mobile = await q.evaluate(() => ({ noHScroll: document.documentElement.scrollWidth <= window.innerWidth + 1, pad: getComputedStyle(document.querySelector('.pad')).display, stageW: Math.round(document.getElementById('stage').getBoundingClientRect().width) }));
  await q.screenshot({ path: OUT + '/editor_mobile.png', fullPage: true });
  out.errs = errs; out.ok = out.hierItems === 8 && out.defaultSel.gravity && !out.defaultSel.playerModel && out.playerSel.model && !out.playerSel.gravity && out.tabs.jsonAfter && !out.tabs.assetsAfter && out.mode3d.json === '3d' && out.stage.fits && out.mobile.noHScroll && out.persist.selAfterReload.includes('敵');
  console.log(JSON.stringify(out)); await b.close();
})();
