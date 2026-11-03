const { chromium } = require('playwright');
const S = (process.env.OUT || '/tmp');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1100, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (['error', 'warning'].includes(m.type())) errs.push(m.type() + ': ' + m.text()); });
  await p.goto('' + (process.env.BASE || 'http://127.0.0.1:8099') + '/index.html?debug&showall'); await p.waitForSelector('#c_physics_gravity'); await p.waitForTimeout(400);
  const J = async () => JSON.parse(await p.inputValue('#json'));
  const setJson = async o => { await p.fill('#json', JSON.stringify(o)); await p.click('#applyjson'); await p.waitForTimeout(600); };
  const base = await J();
  // UIから3Dに切替(select)
  await p.selectOption('#c_render_mode', '3d'); await p.waitForTimeout(1200);
  const out = { mode: (await J()).render.mode, cv3visible: await p.evaluate(() => !document.getElementById('cv3').classList.contains('off')) };
  await p.keyboard.down('ArrowRight'); await p.waitForTimeout(1500); await p.keyboard.up('ArrowRight');
  await p.locator('.stage').screenshot({ path: S + '/3d_ortho.png' });
  base.render = { mode: '3d', camera: { type: 'perspective', angle: 25, distance: 14, follow: 'player' }, depth: 2, lighting: 'default' };
  await setJson(base); await p.waitForTimeout(800);
  await p.locator('.stage').screenshot({ path: S + '/3d_persp.png' });
  base.render.camera = { type: 'orthographic', angle: 35, distance: 20, follow: 'none' }; base.render.depth = 0.5; base.assets = { player: { primitive: { shape: 'box', color: '#2060ff', width: 26, height: 30, eyes: true } }, enemy: { primitive: { shape: 'sphere', color: '#7a3fb0', width: 28, height: 28, eyes: true } } };
  await setJson(base); await p.waitForTimeout(800);
  await p.locator('.stage').screenshot({ path: S + '/3d_fixed.png' });
  out.errs = errs; console.log(JSON.stringify(out)); await b.close();
})();
