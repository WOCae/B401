// ログイン(閲覧は公開・編集は要ログイン)の画面テスト。認証つきのサーバーが必要: BASE と PASSWORD を指定する
const { chromium } = require('playwright');
const BASE = process.env.AUTH_BASE, PASSWORD = process.env.AUTH_PASSWORD, OUT = process.env.OUT || '/tmp';
if (!BASE || !PASSWORD) { console.error('AUTH_BASE と AUTH_PASSWORD が必要です'); process.exit(2); }
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/401|403|404|Failed to load/.test(m.text())) errs.push(m.text()); });
  const out = {}, ok = []; const check = (n, c, x) => { ok.push(!!c); if (!c) out['NG:' + n] = x; };
  const dlgOpen = () => p.evaluate(() => document.getElementById('loginDlg').open);
  const J = async () => JSON.parse(await p.inputValue('#json'));
  const login = async pw => { await p.fill('#loginPw', pw); await p.click('#loginOk'); await p.waitForTimeout(900); };

  // 0) 新規環境(ゲームなし)で開く → ログインを促す → ログイン後に自動で最初のゲームができる
  await p.goto(BASE + '/index.html?debug&server=1'); await p.waitForTimeout(1200);
  check('fresh-dialog', await dlgOpen(), 'ログインダイアログが開かない');
  check('fresh-guide', (await p.textContent('#diag')).includes('ゲームがまだありません'), await p.textContent('#diag'));
  await login('wrong-password-xx'); check('wrong-pw', (await p.textContent('#loginErr')).includes('違います') && await dlgOpen(), await p.textContent('#loginErr'));
  await login(PASSWORD); await p.waitForSelector('#gameSel option', { state: 'attached', timeout: 8000 }); await p.waitForTimeout(800);
  check('fresh-created', (await p.locator('#gameSel option').count()) === 1, 'demo未作成');
  out.state1 = [await p.textContent('#authState'), await p.textContent('#authBtn')]; check('state-edit', out.state1[0] === '編集できます' && out.state1[1] === 'ログアウト', out.state1);

  // 1) ログアウト → 閲覧のみ。編集しようとするとダイアログ、操作は反映されない
  await p.click('#authBtn'); await p.waitForTimeout(500);
  out.state2 = [await p.textContent('#authState'), await p.textContent('#authBtn')]; check('state-view', out.state2[0] === '閲覧のみ' && out.state2[1] === 'ログイン', out.state2);
  await p.click('#t_json'); const g0 = (await J()).physics.gravity;
  await p.click('#h_world'); await p.locator('#c_physics_gravity').fill('1000'); await p.dispatchEvent('#c_physics_gravity', 'change'); await p.waitForTimeout(900);
  check('unauth-dialog', await dlgOpen(), 'ダイアログが開かない');
  check('unauth-reverted', (await J()).physics.gravity === g0, [g0, (await J()).physics.gravity]);
  check('unauth-msg', (await p.textContent('#loginErr')).includes('ログインが必要'), await p.textContent('#loginErr'));
  await p.click('#loginCancel'); check('cancel', !(await dlgOpen()));
  // 閲覧(プレイ)は未ログインでもできる
  const x0 = await p.evaluate(() => window.__app.engine.S.p.x); await p.keyboard.down('ArrowRight');
  let x1 = x0; for (let i = 0; i < 40 && x1 <= x0; i++) { await p.waitForTimeout(100); x1 = await p.evaluate(() => window.__app.engine.S.p.x); } // 動き出すまで待つ(負荷対策)
  await p.keyboard.up('ArrowRight'); check('play-public', x1 > x0, [x0, x1]);
  // アップロードも未ログインでは拒否
  await p.click('#t_assets'); await p.setInputFiles('#assetFile', __dirname + '/../assets/samples/tile_block.glb'); await p.click('#assetUp'); await p.waitForTimeout(900);
  check('upload-denied', (await p.textContent('#assetMsg')).includes('ログインが必要') && await dlgOpen(), await p.textContent('#assetMsg')); await p.click('#loginCancel');

  // 2) ログイン → 編集が保存され、再読み込みしても残る
  await p.click('#authBtn'); await p.waitForTimeout(300); await login(PASSWORD);
  await p.click('#h_world'); await p.locator('#c_physics_gravity').fill('1000'); await p.dispatchEvent('#c_physics_gravity', 'change'); await p.waitForTimeout(900);
  await p.reload(); await p.waitForSelector('#gameSel option', { state: 'attached' }); await p.waitForTimeout(800); await p.click('#t_json');
  check('saved-after-login', (await J()).physics.gravity === 1000, (await J()).physics.gravity);
  check('still-logged-in', (await p.textContent('#authState')) === '編集できます', await p.textContent('#authState'));
  // 3) ステージ編集も要ログイン(ログイン後は動く)
  out.errs = errs; out.ok = ok.every(Boolean) && !errs.length; console.log(JSON.stringify(out)); await b.close();
})();
