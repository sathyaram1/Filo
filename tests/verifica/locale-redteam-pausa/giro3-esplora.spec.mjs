import { test, expect } from '../../fixtures/electron.mjs';
test('esplora', async ({ app, openTab }) => {
  await app.evaluate(async ({ app: eapp }) => {
    const path = process.getBuiltinModule('path');
    const root = path.join(eapp.getAppPath(), 'src', 'main');
    const req = process.getBuiltinModule('module').createRequire(path.join(root, 'main.js'));
    const auth = req(path.join(root, 'auth', 'google-auth'));
    auth.isAdmin = () => false;
  });
  const page = await openTab('filo://redteam/redteam.html');
  await page.waitForTimeout(1000);
  for (const u of ['filo://redteam/redteam.js', 'filo://redteam./redteam.js', 'filo://redteam./redteam.html::$DATA', 'filo://src/pages/redteam./redteam.html::$DATA', 'filo://redteam../redteam.js', 'filo://redteam/redteam.html']) {
    const r = await page.evaluate(async (u) => { try { const x = await fetch(u); return x.status + ' ' + (await x.text()).slice(0, 300).replace(/\s+/g, ' '); } catch (e) { return 'ERR ' + e.message; } }, u);
    console.log('>>', u, '=>', r);
    await page.goto(u).catch((e) => console.log('goto err', e.message.slice(0, 100)));
    await page.waitForTimeout(800);
    console.log('   nav:', page.url(), '|', (await page.locator('body').innerText().catch(() => '?')).slice(0, 120).replace(/\s+/g, ' '), '| scripts:', await page.locator('script').evaluateAll((s) => s.map((x) => x.src).join(',')));
  }
});
