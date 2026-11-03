// ステージ編集(クリック配置・ドラッグ・長方形・塗りつぶし・消しゴム・P保護・リサイズ・拡大・履歴)の画面テスト
const { chromium } = require('playwright');
const OUT = process.env.OUT || '/tmp', BASE = process.env.BASE || 'http://127.0.0.1:8099';
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/404|Failed to load/.test(m.text())) errs.push(m.text()); });
  await p.goto(BASE + '/index.html?debug&server=1'); await p.waitForSelector('#editBtn'); await p.waitForTimeout(700);
  const out = {}; const ok = [];
  const level = () => p.evaluate(() => window.__app.game.level);
  const hist = () => p.evaluate(async id => (await (await fetch('api/index.php?tool=list_history&game_id=' + id)).json()).result.history.length, 'demo');
  const xy = (tx, ty) => p.evaluate(([tx, ty]) => { const e = window.__editor, r = document.getElementById('stage').getBoundingClientRect();
    return [r.left + ((tx + .5) * 32 - e.cam.x) * e.zoom * r.width / 640, r.top + ((ty + .5) * 32 - e.cam.y) * e.zoom * r.height / 384]; }, [tx, ty]);
  const click = async (tx, ty, button = 'left') => { const [x, y] = await xy(tx, ty); await p.mouse.click(x, y, { button }); await p.waitForTimeout(450); };
  const drag = async (a, c) => { const [x0, y0] = await xy(...a), [x1, y1] = await xy(...c); await p.mouse.move(x0, y0); await p.mouse.down(); await p.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 }); await p.mouse.move(x1, y1, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(500); };
  const brush = ch => p.click(`.brush[data-ch="${ch}"]`); const tool = t => p.click(`[data-tool="${t}"]`);
  const row = async y => (await level())[y];
  const check = (name, cond, extra) => { ok.push(cond); if (!cond) out['NG:' + name] = extra; };

  // 1) 編集モードに入る
  await p.click('#editBtn'); await p.waitForTimeout(300);
  out.enter = await p.evaluate(() => ({ active: window.__editor.active, editing: document.getElementById('stage').classList.contains('editing'), paletteVisible: !!document.querySelector('#stagePalette .brush') && getComputedStyle(document.getElementById('tab_stage')).display !== 'none' }));
  check('enter', out.enter.active && out.enter.editing && out.enter.paletteVisible, out.enter);
  // 2) 1マス配置 → JSONに反映・履歴+1 → 元に戻す
  const h0 = await hist(); await brush('#'); await click(3, 2);
  check('place', (await row(2))[3] === '#', await row(2)); check('hist+1', (await hist()) === h0 + 1, [h0, await hist()]);
  await p.click('#undo'); await p.waitForTimeout(500);
  check('undo', (await row(2))[3] === '.' && (await p.evaluate(() => window.__editor.rows[2][3])) === '.', await row(2));
  // 3) ドラッグ(鉛筆)= 1ストローク1履歴・隙間なし
  const h1 = await hist(); await brush('o'); await drag([2, 3], [9, 4]);
  const r3 = await row(3), r4 = await row(4);
  check('drag-line', r3[2] === 'o' && r3[9] === 'o' || r4[9] === 'o', [r3, r4]); check('drag-1hist', (await hist()) === h1 + 1, [h1, await hist()]);
  const cnt = (await level()).join('').split('o').length - 1; check('drag-continuous', cnt >= 8, cnt);
  // 4) 長方形
  await brush('#'); await tool('rect'); await drag([2, 6], [5, 7]);
  check('rect', (await row(6)).slice(2, 6) === '####' && (await row(7)).slice(2, 6) === '####', [await row(6), await row(7)]);
  // 5) 塗りつぶし(ブロック領域を o に)
  await brush('o'); await tool('fill'); await click(3, 6);
  check('fill', (await row(6)).slice(2, 6) === 'oooo' && (await row(7)).slice(2, 6) === 'oooo' && (await row(10))[0] === '#', [await row(6), await row(10)]);
  // 6) 右クリック=消しゴム
  await tool('pencil'); await brush('#'); await click(12, 1); check('place2', (await row(1))[12] === '#');
  await click(12, 1, 'right'); check('erase-right', (await row(1))[12] === '.', await row(1));
  // 7) P: 移動と保護
  const pBefore = (await level()).join('').split('P').length - 1; await brush('P'); await click(6, 4);
  const lv = await level(); check('P-moves', lv[4][6] === 'P' && lv.join('').split('P').length - 1 === 1 && pBefore === 1, lv[4]);
  await brush('.'); await click(6, 4); check('P-protected', (await row(4))[6] === 'P', await row(4));
  // 8) リサイズ
  const w0 = (await row(0)).length, h2 = (await level()).length;
  await p.click('[data-r="right:1"]'); await p.waitForTimeout(500); check('resize-right', (await row(0)).length === w0 + 1, (await row(0)).length);
  await p.click('[data-r="top:1"]'); await p.waitForTimeout(500); check('resize-top', (await level()).length === h2 + 1, (await level()).length);
  await p.click('[data-r="bottom:-1"]'); await p.waitForTimeout(500); check('resize-bottom', (await level()).length === h2, (await level()).length);
  out.sizeLabel = await p.textContent('#stSize');
  // 9) Pの列を削るとエラー(適用されない)
  await brush('P'); await click(0, 4); const w1 = (await row(0)).length;
  await p.click('[data-r="left:-1"]'); await p.waitForTimeout(500);
  out.pErr = await p.textContent('#status'); check('resize-P-error', (await row(0)).length === w1 && out.pErr.includes('P'), out.pErr);
  // 10) 拡大率 50% でも座標が合う
  await p.selectOption('#stZoom', '0.5'); await p.waitForTimeout(300); await brush('^'); await click(16, 1);
  check('zoom-coords', (await row(1))[16] === '^', await row(1)); await p.selectOption('#stZoom', '1');
  await p.screenshot({ path: OUT + '/stage_edit.png' });
  // 11) 終了してプレイ(編集内容が反映され、ゲームが動く)
  await p.keyboard.press('Escape'); await p.waitForFunction(() => !window.__editor.active); await p.waitForTimeout(800); // 開始位置が空中でも、落ちて着地するまで待つ
  const px = () => p.evaluate(() => { const S = window.__app.engine.S; return { x: S.p.x, y: S.p.y, on: S.p.on, deaths: S.deaths }; });
  const st0 = await px(); await p.keyboard.down('ArrowRight');
  let st1 = st0; for (let i = 0; i < 40 && st1.x <= st0.x; i++) { await p.waitForTimeout(100); st1 = await px(); } // 負荷が高くても、動き出すまで待つ
  await p.keyboard.up('ArrowRight');
  out.exit = { active: await p.evaluate(() => window.__editor.active), moved: st1.x > st0.x, st0, st1 }; check('exit-play', !out.exit.active && out.exit.moved, out.exit);
  // 12) 3Dでも編集結果が出る
  await p.click('#mode3d'); await p.waitForTimeout(1200); await p.locator('.stage').screenshot({ path: OUT + '/stage_3d.png' });
  out.levelRows = (await level()).length;
  out.allOk = ok.every(Boolean); out.errs = errs; out.ok = out.allOk && !errs.length; console.log(JSON.stringify(out)); await b.close();
})();
