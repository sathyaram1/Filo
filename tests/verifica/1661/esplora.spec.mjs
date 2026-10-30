import { test, expect } from '../../fixtures/electron.mjs';

test.use({ accoglienzaFatta: false });

async function home(app, tranne = null) {
  const scadenza = Date.now() + 15_000;
  while (Date.now() < scadenza) {
    const w = app.windows().find((x) => { try { return x !== tranne && x.url().startsWith('filo://newtab'); } catch (_) { return false; } });
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('home non trovata');
}
const crediti = (page) => page.locator('#accade .dash-carta[data-chiave="crediti"]');
const manda = (page, msg) => page.evaluate((m) => new Promise((ok) => chrome.runtime.sendMessage(m, (r) => ok(r))), msg);

test('esplora primo incontro', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const page = await home(app);
  await expect(crediti(page)).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(3000);
  const vis = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (el.closest('[hidden]')) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
      if (el.id || (el.className && typeof el.className === 'string' && /carta|sugg|altro|sistema|home/.test(el.className))) out.push(`${el.tagName}#${el.id}.${String(el.className).slice(0, 60)} ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  });
  console.log(vis.join('\n'));
  await page.screenshot({ path: 'tests/.shots/v1661-primo.png' });
  const m = await page.evaluate(() => window.SN_MSG.MSG);
  await manda(page, { type: m.UPDATE_SETTINGS, settings: { theme: 'dark' } });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'tests/.shots/v1661-primo-dark.png' });
  // un timer durante il primo incontro
  await app.evaluate(async () => {
    const T = globalThis.SN_TIMERS || null;
    return !!T;
  });
  // una seconda scheda home
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  await page.waitForTimeout(2000);
  const homes = app.windows().filter((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } });
  console.log('home aperte', homes.length);
  for (const h of homes) console.log('tieni hidden', await h.locator('#tieni').isHidden(), 'altro hidden', await h.locator('#altro').isHidden());
  // incognito al primo incontro
  await shell.evaluate(() => window.filoShell.openIncognito());
  const inc = await home(app, page);
  await page.waitForTimeout(3000);
  for (const h of app.windows().filter((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } })) {
    console.log('dopo inc: tieni hidden', await h.locator('#tieni').isHidden(), 'altro', await h.locator('#altro').isHidden(), 'crediti', await h.locator('#accade .dash-carta[data-chiave="crediti"]').count());
  }
});
