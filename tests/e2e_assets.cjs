// アセット管理UI・タイルのモデル・アセット対応のAI提案の画面テスト(要 Playwright / 起動済みのPHPサーバー)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const OUT = process.env.OUT || '/tmp', BASE = process.env.BASE || 'http://127.0.0.1:8099';
const SAMPLES = path.join(__dirname, '..', 'assets', 'samples');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1100, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errs.push(m.text()); });
  p.on('dialog', d => d.accept());
  await p.goto(BASE + '/index.html?debug&showall'); await p.waitForSelector('#assetList'); await p.waitForTimeout(500);
  const out = {}; const J = async () => JSON.parse(await p.inputValue('#json'));
  const gid = await p.inputValue('#gameSel');
  await p.selectOption('#c_render_mode', '3d');

  // 1) アップロード(UI): ブロック用サンプルを別名でアップロード
  const tmp = path.join(OUT, 'My Block.glb'); fs.copyFileSync(path.join(SAMPLES, 'tile_block.glb'), tmp);
  await p.setInputFiles('#assetFile', tmp); await p.click('#assetUp'); await p.waitForTimeout(800);
  out.uploadMsg = await p.textContent('#assetMsg');
  out.uploads = await p.locator('#assetList > .asset b').allTextContents();
  // 2) 不正ファイル(拡張子違い・中身がGLBでない)はブラウザ側でも止まる
  const bad = path.join(OUT, 'bad.glb'); fs.writeFileSync(bad, 'hello this is not a glb file at all.....');
  await p.setInputFiles('#assetFile', bad); await p.click('#assetUp'); await p.waitForTimeout(300); out.badMsg = await p.textContent('#assetMsg');
  const txt = path.join(OUT, 'x.txt'); fs.copyFileSync(path.join(SAMPLES, 'tile_block.glb'), txt);
  await p.setInputFiles('#assetFile', txt); await p.click('#assetUp'); await p.waitForTimeout(300); out.extMsg = await p.textContent('#assetMsg');
  if (process.env.DBG) console.log(JSON.stringify(out));
  // 3) 割り当て: アップロードしたブロック → ブロック(#)
  const row = p.locator('#assetList > .asset').first();
  await row.locator('.asel').selectOption('#'); await row.locator('.aassign').click(); await p.waitForTimeout(900);
  out.wallModel = (await J()).assets.tiles['#'].model;
  out.usedBy = await p.locator('#assetList > .asset .tag').first().textContent();
  // 4) 使用中は削除できない
  await row.locator('.adel').click(); await p.waitForTimeout(500); out.delInUse = await p.textContent('#assetMsg');
  // 5) AI提案: モデルを自動で割り当て → 差分を見て承認(承認前は変わらない)
  await p.click('text=モデルを自動で割り当て'); await p.waitForSelector('#okp');
  out.proposalDiff = await p.locator('#prop ul.diff li').allTextContents();
  out.beforeApply = (await J()).assets.player.model;
  await p.click('#okp'); await p.waitForTimeout(2000);
  const g = await J(); out.afterApply = { player: g.assets.player.model, enemy: g.assets.enemy.model, spike: g.assets.tiles['^'].model, coin: g.assets.tiles.o.model, goal: g.assets.tiles.G.model };
  await p.keyboard.down('ArrowRight'); await p.waitForTimeout(900); await p.keyboard.up('ArrowRight');
  await p.locator('.stage').screenshot({ path: OUT + '/tiles_models.png' });
  // 6) AI提案: アニメ名を自動割り当て / ヒットボックスをモデルに合わせる
  await p.click('text=アニメ名を自動割り当て'); await p.waitForSelector('#okp'); out.animDiff = await p.locator('#prop ul.diff li').allTextContents(); await p.click('#okp'); await p.waitForTimeout(500);
  await p.click('text=ヒットボックスをモデルに合わせる'); await p.waitForSelector('#okp'); out.hitDiff = await p.locator('#prop ul.diff li').allTextContents(); await p.click('#okp'); await p.waitForTimeout(500);
  // 7) AI提案: カメラ
  await p.click('text=3Dで見下ろし気味に'); await p.waitForSelector('#okp'); out.camDiff = await p.locator('#prop ul.diff li').allTextContents(); await p.click('#okp'); await p.waitForTimeout(800);
  await p.locator('.stage').screenshot({ path: OUT + '/tiles_camera.png' });
  // 8) 破棄すると何も変わらない
  const before = JSON.stringify(await J());
  await p.click('text=カメラを寄せる'); await p.waitForSelector('#ngp'); await p.click('#ngp'); await p.waitForTimeout(200);
  out.discardKeeps = before === JSON.stringify(await J());
  // 9) 差し替え: 同名のまま中身を入れ替え(別サンプルで)
  const rep = path.join(OUT, 'rep.glb'); fs.copyFileSync(path.join(SAMPLES, 'tile_goal.glb'), rep);
  await p.locator('#assetList > .asset').first().locator('.arep').setInputFiles(rep); await p.waitForTimeout(1200);
  out.replaceMsg = await p.textContent('#assetMsg');
  // 10) 履歴: 元に戻すを繰り返しても壊れない
  for (let i = 0; i < 3; i++) { await p.click('#undo'); await p.waitForTimeout(300); }
  out.afterUndoMode = (await J()).render.mode;
  // 後始末(アップロードしたファイルを外してから削除)
  const g2 = await J(); g2.assets.tiles['#'].model = null; await p.fill('#json', JSON.stringify(g2)); await p.click('#applyjson'); await p.waitForTimeout(700);
  const name = (await p.locator('#assetList > .asset').first().getAttribute('data-name'));
  await p.locator('#assetList > .asset').first().locator('.adel').click(); await p.waitForTimeout(700);
  out.afterDelete = await p.locator('#assetList > .asset').count();
  out.errs = errs; out.gid = gid; out.name = name; console.log(JSON.stringify(out, null, 1)); await b.close();
})();
