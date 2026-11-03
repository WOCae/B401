// ブラウザ保存モード(既定)の画面テスト。PHPなしの静的サーバーだけで動くことも確認する。
//   LOCAL_BASE=http://127.0.0.1:8092 node tests/e2e_local.cjs   (python3 -m http.server で配信しておく)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const BASE = process.env.LOCAL_BASE, OUT = process.env.OUT || '/tmp';
if (!BASE) { console.error('LOCAL_BASE が必要です'); process.exit(2); }
const SAMPLES = path.join(__dirname, '..', 'assets', 'samples');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true }); const p = await ctx.newPage();
  const errs = [], apiCalls = []; p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/404|Failed to load/.test(m.text())) errs.push(m.text()); });
  p.on('request', r => { if (r.url().includes('api/index.php')) apiCalls.push(r.url()); });
  p.on('dialog', d => d.accept('テスト用ゲーム'));
  const out = {}, ok = []; const check = (n, c, x) => { ok.push(!!c); if (!c) out['NG:' + n] = x; };
  const J = async () => JSON.parse(await p.inputValue('#json'));
  const tab = n => p.click('#t_' + n), sel = id => p.click('#h_' + id);
  const opts = () => p.locator('#gameSel option').count();

  await p.goto(BASE + '/index.html?debug'); await p.waitForSelector('#gameSel option', { state: 'attached' }); await p.waitForTimeout(900);
  const gid = await p.inputValue('#gameSel');
  check('auto-created', /^g-[0-9a-f]{8}$/.test(gid) && await opts() === 1, gid);
  check('local-label', (await p.textContent('#authState')) === '自動保存(このブラウザ内)' && !(await p.locator('#authBtn').isVisible()), await p.textContent('#authState'));
  check('intro', (await p.textContent('#status')).includes('自動保存'), await p.textContent('#status'));
  check('backup-unsaved', (await p.textContent('#backupState')).includes('未保存'), await p.textContent('#backupState'));

  // 1) スライダー → 再読み込みしても残る(IndexedDB)/ 元に戻す
  await tab('json'); await sel('world');
  await p.locator('#c_physics_gravity').fill('1000'); await p.dispatchEvent('#c_physics_gravity', 'change'); await p.waitForTimeout(700);
  await p.reload(); await p.waitForSelector('#gameSel option', { state: 'attached' }); await p.waitForTimeout(900); await tab('json');
  check('persist', (await J()).physics.gravity === 1000 && (await p.inputValue('#gameSel')) === gid, (await J()).physics.gravity);
  // (fill が change を2回出すので履歴は2つできる: 2回戻すと初期状態)
  await p.click('#undo'); await p.waitForTimeout(400); await p.click('#undo'); await p.waitForTimeout(500); check('undo', (await J()).physics.gravity === 1800, (await J()).physics.gravity);
  await p.click('#undo'); await p.waitForTimeout(400); check('undo-limit', (await p.textContent('#status')).includes('戻れません'), await p.textContent('#status'));
  // 2) 不正なJSONでも壊れない/範囲外は丸め
  await p.fill('#json', '{ broken'); await p.click('#applyjson'); check('bad-json', (await p.textContent('#jmsg')).includes('JSON'), await p.textContent('#jmsg'));
  await p.fill('#json', JSON.stringify({ physics: { gravity: 99999 }, level: ['P..G', '####'] })); await p.click('#applyjson'); await p.waitForTimeout(500);
  check('clamp', (await p.textContent('#jmsg')).includes('丸め'), await p.textContent('#jmsg')); await p.click('#undo'); await p.waitForTimeout(400);
  // 3) AI提案(承認式)
  await tab('ai'); await p.click('text=もう少し簡単に'); await p.waitForSelector('#okp'); const jv0 = (await (async () => { await tab('json'); return (await J()).physics.jumpVelocity; })()); await tab('ai');
  await p.click('#okp'); await p.waitForTimeout(500); await tab('json'); check('proposal-apply', (await J()).physics.jumpVelocity > jv0, jv0);
  // 4) アップロード(ブラウザ内)→ 割り当て → 3D表示でBlob URLから読み込まれる
  await tab('assets'); const tmp = path.join(OUT, 'My Block.glb'); fs.copyFileSync(path.join(SAMPLES, 'tile_block.glb'), tmp);
  await p.setInputFiles('#assetFile', tmp); await p.click('#assetUp'); await p.waitForTimeout(800);
  const rows = p.locator('#assetList > .asset'); check('upload', (await rows.count()) === 1 && (await rows.first().getAttribute('data-name')).startsWith('my-block-'), await p.textContent('#assetMsg'));
  const bad = path.join(OUT, 'bad.glb'); fs.writeFileSync(bad, 'glTF-but-not-really-a-glb-file-at-all....');
  await p.setInputFiles('#assetFile', bad); await p.click('#assetUp'); await p.waitForTimeout(500); check('upload-bad', (await p.textContent('#assetMsg')).includes('GLB'), await p.textContent('#assetMsg'));
  await rows.first().locator('.asel').selectOption('#'); await rows.first().locator('.aassign').click(); await p.waitForTimeout(800);
  await p.click('#mode3d'); await p.waitForTimeout(2000);
  const blobLoaded = await p.evaluate(() => window.__view.r3d && [...window.__view.r3d.ready.keys()].some(k => k.startsWith('uploads/')));
  check('blob-model', blobLoaded, 'ブラウザ内のGLBが読み込まれていない');
  await rows.first().locator('.adel').click(); await p.waitForTimeout(500); check('delete-in-use', (await p.textContent('#assetMsg')).includes('使用中'), await p.textContent('#assetMsg'));
  await p.locator('.stage').screenshot({ path: OUT + '/local_3d.png' });
  // 5) ステージ編集(エディタはバックエンドに依存しない)
  await p.click('#mode2d'); await p.click('#editBtn'); await p.waitForTimeout(300); await p.click('.brush[data-ch="o"]');
  const [sx, sy] = await p.evaluate(() => { const e = window.__editor, r = document.getElementById('stage').getBoundingClientRect(); return [r.left + ((3 + .5) * 32 - e.cam.x) * e.zoom * r.width / 640, r.top + ((2 + .5) * 32 - e.cam.y) * e.zoom * r.height / 384]; });
  await p.mouse.click(sx, sy); await p.waitForTimeout(600); await p.keyboard.press('Escape'); await tab('json'); check('stage-edit', (await J()).level[2][3] === 'o', (await J()).level[2]);

  // 6) ファイル保存(GLB同梱)→ 保存済み表示 → 編集で未保存に戻る
  await p.click('#mode3d'); await p.waitForTimeout(800);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#saveBtn')]);
  const file = path.join(OUT, 'saved.pfmk.json'); await dl.saveAs(file);
  const proj = JSON.parse(fs.readFileSync(file, 'utf8'));
  out.file = { name: dl.suggestedFilename(), format: proj.format, assets: proj.assets.length, title: proj.title, bytes: fs.statSync(file).size };
  check('save-format', proj.format === 'platformer-maker-project' && proj.assets.length === 1 && proj.game.assets.tiles['#'].model === proj.assets[0].path, out.file);
  check('backup-saved', (await p.textContent('#backupState')).includes('保存済み'), await p.textContent('#backupState'));
  await sel('world'); await p.locator('#c_physics_gravity').fill('1200'); await p.dispatchEvent('#c_physics_gravity', 'change'); await p.waitForTimeout(500);
  check('backup-dirty', (await p.textContent('#backupState')).includes('未保存'), await p.textContent('#backupState'));

  // 7) 複製(GLBも一緒に)・新規・削除
  await p.click('#dupGame'); await p.waitForTimeout(1500);
  const dupId = await p.inputValue('#gameSel'); await tab('assets');
  check('dup', dupId !== gid && (await opts()) === 2 && (await p.locator('#assetList > .asset').count()) === 1 && (await p.locator('#assetList .tag', { hasText: '使用中' }).count()) >= 1, [dupId, await opts()]);
  await p.click('#newGame'); await p.waitForTimeout(1000); check('new', (await opts()) === 3 && (await p.textContent('#diag')) !== undefined, await opts());
  await tab('json'); check('new-title', (await J()).meta.title === 'テスト用ゲーム', (await J()).meta.title);
  await p.click('#delGame'); await p.waitForTimeout(1000); check('delete', (await opts()) === 2, await opts());

  // 8) ファイルを開く(新しいゲームとして追加。GLB同梱)
  await p.setInputFiles('#openFile', file); await p.waitForTimeout(2000);
  const openedId = await p.inputValue('#gameSel'); await tab('assets');
  check('open', (await opts()) === 3 && openedId !== gid && (await p.locator('#assetList > .asset').count()) === 1, [await opts(), await p.textContent('#status')]);
  check('open-title', (await p.textContent('#status')).includes('開きました'), await p.textContent('#status'));
  // 壊れたファイル/別のJSONは取り込まない
  for (const [name, text, expect] of [['broken.json', '{ not json', '読み取れません'], ['other.json', '{"hello":1}', 'プロジェクトファイルではありません'],
    ['badgame.json', JSON.stringify({ format: 'platformer-maker-project', version: 1, game: { level: ['...'] }, assets: [] }), '不正']]) {
    const f = path.join(OUT, name); fs.writeFileSync(f, text); await p.setInputFiles('#openFile', f); await p.waitForTimeout(500);
    check('reject-' + name, (await p.textContent('#status')).includes(expect) && (await opts()) === 3, await p.textContent('#status'));
  }
  const evil = JSON.parse(JSON.stringify(proj)); evil.assets[0].data = Buffer.from('<?php system("id"); ?> not a glb at all, just some text padding......').toString('base64');
  const ef = path.join(OUT, 'evil.json'); fs.writeFileSync(ef, JSON.stringify(evil)); await p.setInputFiles('#openFile', ef); await p.waitForTimeout(600);
  check('reject-bad-glb', (await p.textContent('#status')).includes('GLB') && (await opts()) === 3, await p.textContent('#status'));

  // 9) 遊ぶ専用ページ: ブラウザ内のゲーム / URL指定(別オリジン想定のCORS付きサーバー)
  const pg = await ctx.newPage(); pg.on('pageerror', e => errs.push('play: ' + e.message));
  pg.on('request', r => { if (r.url().includes('api/index.php')) apiCalls.push(r.url()); });
  await pg.goto(`${BASE}/play.html?debug&game=${gid}`); await pg.waitForTimeout(1500);
  const x0 = await pg.evaluate(() => window.__play.engine.S.p.x); await pg.keyboard.down('ArrowRight'); await pg.waitForTimeout(500); await pg.keyboard.up('ArrowRight');
  check('play-local', (await pg.textContent('#ptitle')).length > 0 && (await pg.evaluate(() => window.__play.engine.S.p.x)) > x0, await pg.textContent('#ptitle'));
  const srv = http.createServer((req, res) => { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.end(fs.readFileSync(file)); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const url = `http://127.0.0.1:${srv.address().port}/g.pfmk.json`;
  const pg2 = await ctx.newPage(); pg2.on('pageerror', e => errs.push('play2: ' + e.message));
  await pg2.goto(`${BASE}/play.html?debug&src=${encodeURIComponent(url)}`); await pg2.waitForTimeout(2500);
  out.playSrc = { title: await pg2.textContent('#ptitle'), is3d: await pg2.evaluate(() => window.__play.game.render.mode), blobModel: await pg2.evaluate(() => window.__play.r3d ? [...window.__play.r3d.ready.keys()].some(k => k.startsWith('uploads/')) : false) };
  check('play-src', out.playSrc.title === proj.title && out.playSrc.is3d === '3d', out.playSrc);
  check('play-src-model', out.playSrc.blobModel, '同梱GLBが遊ぶ画面で読み込まれていない'); await pg2.screenshot({ path: OUT + '/play_src.png' });
  const before = await opts();
  await pg2.click('#peditor'); await pg2.waitForTimeout(2500);
  check('play-to-editor', pg2.url().includes('index.html?game=g-') , pg2.url());
  const pg3 = await ctx.newPage(); await pg3.goto(`${BASE}/play.html?src=${encodeURIComponent('http://127.0.0.1:1/none.json')}`); await pg3.waitForTimeout(1200);
  check('play-error', (await pg3.textContent('#pmsg')).includes('読み込めませんでした') && await pg3.locator('#pdrop').isVisible(), await pg3.textContent('#pmsg'));
  srv.close();

  check('no-php', apiCalls.length === 0, apiCalls);
  void before;
  out.errs = errs; out.ok = ok.every(Boolean) && !errs.length; console.log(JSON.stringify(out)); await b.close();
})();
