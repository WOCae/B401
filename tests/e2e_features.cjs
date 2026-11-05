// 新機能(体力・残機・二段ジャンプ・アイテム・敵の種類・一覧エディタ)の画面テスト。ブラウザ保存モード・PHPなし。
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const BASE = process.env.LOCAL_BASE, OUT = process.env.OUT || '/tmp';
if (!BASE) { console.error('LOCAL_BASE が必要です'); process.exit(2); }
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/404|Failed to load/.test(m.text())) errs.push(m.text()); });
  p.on('dialog', d => d.accept());
  const out = {}, ok = []; const check = (n, c, x) => { ok.push(!!c); if (!c) out['NG:' + n] = x; };
  const G = () => p.evaluate(() => JSON.parse(JSON.stringify(window.__app.game)));
  const E = f => p.evaluate(f);
  const tab = n => p.click('#t_' + n), sel = id => p.click('#h_' + id);
  const slide = async (id, v) => { await p.locator('#' + id).fill(String(v)); await p.dispatchEvent('#' + id, 'change'); await p.waitForTimeout(400); };

  await p.goto(BASE + '/index.html?debug'); await p.waitForSelector('#gameSel option', { state: 'attached' }); await p.waitForTimeout(900);
  await p.click('#helpClose');
  // 1) 新しいヒエラルキー項目(敵の種類・アイテム)
  check('hier', await p.locator('#h_enemytypes').count() === 1 && await p.locator('#h_items').count() === 1, 'ヒエラルキーに敵の種類/アイテムが無い');
  // 2) ステータス(体力・残機・二段ジャンプ)
  await sel('player'); await slide('c_player_hp', 3); await slide('c_player_lives', 3); await p.check('#c_player_doubleJump'); await p.waitForTimeout(500);
  let g = await G(); check('stats-saved', g.player.hp === 3 && g.player.lives === 3 && g.player.doubleJump === true, g.player);
  await p.click('#restart'); await p.waitForTimeout(300);
  check('stats-engine', await E(() => window.__app.engine.S.p.hp === 3 && window.__app.engine.S.livesLeft === 3), await E(() => [window.__app.engine.S.p.hp, window.__app.engine.S.livesLeft]));
  await tab('diag'); check('diag-doublejump', (await p.textContent('#diag')).includes('二段ジャンプ込み'), await p.textContent('#diag'));
  // 3) アイテムの一覧エディタ
  await sel('items'); const n0 = await p.locator('#ic_items_list .centry').count(); check('items-list', n0 === 5, n0);
  const heartLabel = await p.locator('#ic_items_list .centry').first().locator('.cl').textContent(); check('items-title', heartLabel === 'ハート', heartLabel);
  await slide('c_items_heart_amount', 2); g = await G(); check('item-edit', g.items.heart.amount === 2, g.items.heart.amount);
  await p.click('#ic_items_list .cadd'); await p.waitForTimeout(600); g = await G();
  const newItem = Object.keys(g.items).find(k => !['heart', 'star', 'boots', 'wings', 'life'].includes(k)); const newSym = g.items[newItem].symbol;
  check('item-add', Object.keys(g.items).length === 6 && newItem === 'item1' && /^[A-Z0-9*+=~!@%&?$]$/.test(newSym) && !'HBWL*'.includes(newSym), [newItem, newSym]);
  check('item-add-ui', await p.locator('#ic_items_list .centry').count() === 6);
  await p.fill('#c_items_item1_label', 'ひかる石'); await p.dispatchEvent('#c_items_item1_label', 'change'); await p.waitForTimeout(400);
  g = await G(); check('item-rename', g.items.item1.label === 'ひかる石' && (await p.locator('#ic_items_list .centry').last().locator('.cl').textContent()) === 'ひかる石', g.items.item1.label);
  // 4) ステージエディタのブラシに増える → 置く → 記号を変えると配置も追従 → 削除すると空きになる
  await p.click('#editBtn'); await p.waitForTimeout(300);
  const brushes = await p.locator('#brushes .brush').evaluateAll(b => b.map(x => x.dataset.ch).join(''));
  check('brushes-legend', brushes === '.#^oEFXH*BWL' + newSym + 'GP', brushes);
  await p.click(`.brush[data-ch="${newSym}"]`);
  const [sx, sy] = await E(() => { const e = window.__editor, r = document.getElementById('stage').getBoundingClientRect(); return [r.left + ((4 + .5) * 32 - e.cam.x) * e.zoom * r.width / 640, r.top + ((6 + .5) * 32 - e.cam.y) * e.zoom * r.height / 384]; });
  await p.mouse.click(sx, sy); await p.waitForTimeout(600); g = await G();
  check('item-place', g.level[6][4] === newSym, g.level[6]);
  await p.keyboard.press('Escape'); await sel('items');
  const free = await p.locator('#c_items_item1_symbol option').evaluateAll(o => o.map(x => x.value));
  const target = free.find(c => c !== newSym); await p.selectOption('#c_items_item1_symbol', target); await p.waitForTimeout(600); g = await G();
  check('symbol-rename-follows', g.items.item1.symbol === target && g.level[6][4] === target && !g.level.join('').includes(newSym), [target, g.level[6]]);
  await p.locator('#ic_items_list .centry').last().locator('.cdel').click(); await p.waitForTimeout(700); g = await G();
  check('item-delete', !g.items.item1 && !g.level.join('').includes(target) && g.level[6][4] === '.', [Object.keys(g.items), g.level[6]]);
  await p.click('#undo'); await p.waitForTimeout(500); g = await G(); check('undo-delete', !!g.items.item1 && g.level[6][4] === target, Object.keys(g.items));
  // 5) 敵の種類を追加(飛ぶ敵)→ ステージに置いて動かす
  await sel('enemytypes'); check('types-list', await p.locator('#ic_enemytypes_list .centry').count() === 3);
  await p.click('#ic_enemytypes_list .cadd'); await p.waitForTimeout(600);
  await p.selectOption('#c_enemyTypes_enemy1_behavior', 'fly'); await slide('c_enemyTypes_enemy1_speed', 100); await p.waitForTimeout(300);
  g = await G(); const eSym = g.enemyTypes.enemy1.symbol; check('type-add', g.enemyTypes.enemy1.behavior === 'fly' && g.enemyTypes.enemy1.speed === 100, g.enemyTypes.enemy1);
  await p.click('#editBtn'); await p.click(`.brush[data-ch="${eSym}"]`);
  const [ex, ey] = await E(() => { const e = window.__editor, r = document.getElementById('stage').getBoundingClientRect(); return [r.left + ((12 + .5) * 32 - e.cam.x) * e.zoom * r.width / 640, r.top + ((7 + .5) * 32 - e.cam.y) * e.zoom * r.height / 384]; });
  await p.mouse.click(ex, ey); await p.waitForTimeout(600); await p.keyboard.press('Escape'); await p.waitForTimeout(500);
  const en = await E(() => window.__app.engine.S.en.map(e => [e.type, e.behavior, e.speed]));
  check('type-in-engine', en.some(e => e[0] === 'enemy1' && e[1] === 'fly' && e[2] === 100), en);
  await p.click('#mode3d'); await p.waitForTimeout(1800); await p.locator('.stage').screenshot({ path: OUT + '/feat_3d_types.png' }); await p.click('#mode2d'); await p.waitForTimeout(500);
  // 6) テンプレート「パワーアップ」を実際に遊ぶ: アイテムを取ると効果が付く
  await p.click('#newGame'); await p.waitForSelector('#tplDlg[open]'); await p.click('#tplGrid .tpl[data-id="power"]'); await p.click('#tplOk'); await p.waitForTimeout(1200);
  g = await G(); check('power-template', g.meta.title === 'パワーアップ' && g.player.hp === 3 && g.player.lives === 3, g.player);
  await p.keyboard.down('ArrowRight'); let fx = []; for (let i = 0; i < 60 && !fx.includes('invincible'); i++) { await p.waitForTimeout(100); fx = await E(() => Object.keys(window.__app.engine.S.p.fx)); } await p.keyboard.up('ArrowRight');
  check('play-star', fx.includes('invincible'), fx); await p.screenshot({ path: OUT + '/feat_play.png' });
  // 7) AI提案(ステータス)
  await sel('player'); await tab('ai'); await p.click('text=体力を3にする'); await p.waitForTimeout(400);
  check('suggest-none', (await p.textContent('#prop')).includes('すでに'), await p.textContent('#prop'));
  await sel('player'); await slide('c_player_hp', 1); await p.uncheck('#c_player_doubleJump'); await p.waitForTimeout(300);
  await p.click('text=体力を3にする'); await p.waitForSelector('#okp'); const diff = await p.locator('#prop ul.diff li').allTextContents(); await p.click('#okp'); await p.waitForTimeout(500);
  g = await G(); check('suggest-hp', g.player.hp === 3 && diff.length === 1 && diff[0].includes('体力'), [g.player.hp, diff]);
  await p.click('text=二段ジャンプを有効にする'); await p.waitForSelector('#okp'); await p.click('#okp'); await p.waitForTimeout(500); g = await G(); check('suggest-dj', g.player.doubleJump === true);
  await p.click('text=もう少し簡単に'); await p.waitForSelector('#okp'); const d2 = await p.locator('#prop ul.diff li').allTextContents(); await p.click('#ngp');
  check('suggest-speed-label', d2.some(t => t.includes('歩く敵') && t.includes('速度')), d2);
  // 8) 古い形式(v1)のファイルを開く(後方互換): JSON と PNG
  for (const f of ['v1_project.pfmk.json', 'v1_project.pfmk.png']) {
    const before = await p.locator('#gameSel option').count();
    await p.setInputFiles('#openFile', path.join(__dirname, 'golden', f)); await p.waitForTimeout(2000);
    g = await G(); check('open-v1-' + f, (await p.locator('#gameSel option').count()) === before + 1 && g.formatVersion === 2 && Object.keys(g.enemyTypes).length === 3 && g.player.hp === 1 && (await p.textContent('#status')).includes('開きました'), [before, g.formatVersion, await p.textContent('#status')]);
  }
  // 9) 保存するファイルは新しい形式(version 2)
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#saveBtn')]); const sf = path.join(OUT, 'feat_saved.json'); await dl.saveAs(sf);
  const sp = JSON.parse(fs.readFileSync(sf, 'utf8')); check('save-v2', sp.version === 2 && sp.game.formatVersion === 2 && sp.game.items && sp.game.enemyTypes, [sp.version, sp.game.formatVersion]);
  out.errs = errs; out.ok = ok.every(Boolean) && !errs.length; console.log(JSON.stringify(out)); await b.close();
})();
