import { test, expect } from '../../fixtures/electron.mjs';
const FAV = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#e00"/></svg>');
async function patch(app, p) {
  return app.evaluate(({ BrowserWindow }, p) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const web = w._filoTabs.tabs.filter((x) => /^https?:/.test(x.url || ''));
    p.forEach((q, i) => { if (q && web[i]) Object.assign(web[i], q); });
    w._filoTabs._broadcast();
    return web.map((t) => t.id);
  }, p);
}
const geo = (shell) => shell.evaluate(() => [...document.querySelectorAll('.tab')].map((tab) => ({ t: tab.querySelector('.title')?.textContent?.slice(0, 20), w: Math.round(tab.getBoundingClientRect().width), act: tab.classList.contains('active'), col: getComputedStyle(tab).color, f: [...tab.children].filter((c) => getComputedStyle(c).display !== 'none').map((c) => c.className.split(' ').pop() + ':' + Math.round(c.getBoundingClientRect().width) + (c.classList.contains('tab-alert') ? ':' + getComputedStyle(c).color : '')) })));
const shot = (shell, n) => shell.screenshot({ path: `tests/.shots/431g2-${n}.png`, clip: { x: 0, y: 0, width: 1280, height: 40 } });

test('scenari', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const pg = (t) => testServer.html(`<title>${t}</title><link rel="icon" href="${FAV}"><h1 id="ok">x</h1>`);
  await openTab(pg('Rick Astley - Never Gonna Give You Up (Official Video) - YouTube'));
  await openTab(pg('Posta in arrivo (3) - Gmail'));
  await expect(shell.locator('.tab .spinner')).toHaveCount(0, { timeout: 10_000 });
  await patch(app, [{ audible: true, favicon: FAV }, { favicon: FAV }]);
  await shell.waitForTimeout(800);
  console.log('A light', JSON.stringify(await geo(shell)));
  await shot(shell, 'a-light');
  await shell.emulateMedia({ colorScheme: 'dark' });
  await shell.waitForTimeout(800);
  console.log('A dark', JSON.stringify(await geo(shell)));
  await shot(shell, 'a-dark');
  // attiva che suona, con colore identità scuro
  const ids = await patch(app, [{ audible: false }, { audible: true, color: 'rgb(30,40,160)', identityColor: 'rgb(30,40,160)' }]);
  await shell.waitForTimeout(800);
  console.log('B', JSON.stringify(await geo(shell)));
  await shot(shell, 'b-attiva-colorata');
  await shell.emulateMedia({ colorScheme: 'light' });
  // menu contestuale Muta sulla attiva
  await patch(app, [{ audible: true, color: null, identityColor: null }, { audible: true, color: 'rgb(250,250,250)', identityColor: 'rgb(230,30,30)' }]);
  await shell.waitForTimeout(500);
  await shot(shell, 'c-light-due-suonano');
  console.log('C', JSON.stringify(await geo(shell)));
  // loading + audible
  await patch(app, [{ loading: true }]);
  await shell.waitForTimeout(400);
  console.log('D loading', JSON.stringify(await geo(shell)));
  await shot(shell, 'd-loading');
  await patch(app, [{ loading: false, title: '🎵🎶 تشغيل الموسيقى — <b>emoji</b> e testo lunghissimo '.repeat(4) }]);
  await shell.waitForTimeout(400);
  console.log('E', JSON.stringify(await geo(shell)));
  await shot(shell, 'e-emoji-rtl');
  // tante schede
  for (let i = 0; i < 22; i++) await openTab(pg('Scheda ' + i));
  await expect(shell.locator('.tab .spinner')).toHaveCount(0, { timeout: 30_000 });
  const pat = Array.from({ length: 24 }, (_, i) => (i % 5 === 0 ? { audible: true, favicon: FAV } : i % 7 === 0 ? { muted: true, favicon: FAV } : { favicon: FAV }));
  await patch(app, pat);
  await shell.waitForTimeout(800);
  console.log('F many', JSON.stringify(await geo(shell)));
  await shot(shell, 'f-tante');
  await shell.emulateMedia({ colorScheme: 'dark' });
  await shell.waitForTimeout(600);
  await shot(shell, 'f-tante-dark');
  await shell.emulateMedia({ colorScheme: 'light' });
});
