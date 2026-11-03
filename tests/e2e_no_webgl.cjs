const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--disable-gpu', '--disable-3d-apis', '--disable-webgl'] });
  const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('' + (process.env.BASE || 'http://127.0.0.1:8099') + '/index.html?debug&showall'); await p.waitForSelector('#c_physics_gravity');
  await p.selectOption('#c_render_mode', '3d'); await p.waitForTimeout(1500);
  const r = { status: await p.textContent('#status'), cv2visible: await p.evaluate(() => !document.getElementById('cv').classList.contains('off')), modeInJson: JSON.parse(await p.inputValue('#json')).render.mode, errs };
  await p.keyboard.down('ArrowRight'); await p.waitForTimeout(500); await p.keyboard.up('ArrowRight');
  r.x = await p.evaluate(() => document.getElementById('hud').width);
  console.log(JSON.stringify(r)); await b.close();
})();
