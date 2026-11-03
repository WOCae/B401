const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto((process.env.BASE || 'http://127.0.0.1:8099') + '/index.html?debug'); await p.waitForSelector('#c_render_mode');
  await p.selectOption('#c_render_mode', '3d'); await p.waitForTimeout(600);
  for (const path of ['tests/fixtures/truncated.glb', 'tests/fixtures/not_glb.glb']) {
    await p.fill('#c_assets_player_model', path); await p.dispatchEvent('#c_assets_player_model', 'change'); await p.waitForTimeout(1200);
    await p.keyboard.down('ArrowRight'); await p.waitForTimeout(400); await p.keyboard.up('ArrowRight');
    console.log(path, '=>', (await p.textContent('#status')).slice(0, 110), '| 3D継続:', await p.evaluate(() => window.__view.state), '| x=', await p.evaluate(() => Math.round(window.__app.engine.S.p.x)));
  }
  console.log('{"errs":' + JSON.stringify(errs) + '}'); await b.close();
})();
