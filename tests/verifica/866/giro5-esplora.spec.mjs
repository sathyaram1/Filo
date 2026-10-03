// Esplorazione del giro 5: aspetto della sezione in Sicurezza e navigazioni comuni (ancore, indietro, parametri ripuliti).
import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const eventi = (ud) => {
  const f = join(ud, 'filo', 'eventi.jsonl');
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((r) => JSON.parse(r)) : [];
};

async function paginaInterna(app, shell, url) {
  const host = new URL(url).hostname;
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  await expect.poll(() => app.windows().some((w) => { try { return new URL(w.url()).hostname === host; } catch (_) { return false; } }), { timeout: 10_000 }).toBe(true);
  const page = app.windows().find((w) => new URL(w.url()).hostname === host);
  await page.waitForLoadState('domcontentloaded');
  return page;
}

test('aspetto della sezione pagine visitate, chiaro e scuro', async ({ app, shell }) => {
  mkdirSync('tests/.shots', { recursive: true });
  const page = await paginaInterna(app, shell, 'filo://security/security.html');
  const sez = page.locator('#sec-visite');
  await sez.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/.shots/866-g5-sicurezza-chiaro.png' });
  await page.locator('#sec-visite-oggi').click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'tests/.shots/866-g5-sicurezza-nessuna.png' });
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }));
  await page.reload();
  await page.locator('#sec-visite').scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/.shots/866-g5-sicurezza-scuro.png' });
});

test('navigazioni comuni: ancora, indietro, parametri ripuliti', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const ud = await app.evaluate(() => process.env.FILO_USER_DATA);
  const b = testServer.html('<!doctype html><title>Pagina B</title><p>B</p>');
  const a = testServer.html(`<!doctype html><title>Pagina A</title><a id="anc" href="#giu">giù</a><a id="vai" href="${b}">vai</a><div style="height:3000px"></div><h2 id="giu">giu</h2>`);
  const c = testServer.html('<!doctype html><title>Pagina C</title><script>history.replaceState(null, "", location.pathname)</script><p>C</p>');
  const page = await openTab(a);
  await page.click('#anc');
  await page.waitForTimeout(500);
  await page.click('#vai');
  await page.waitForURL(b);
  await page.waitForTimeout(500);
  await page.goBack();
  await page.waitForTimeout(2500);
  await openTab(c + '?utm_source=news&utm_medium=mail');
  await page.waitForTimeout(3000);
  await app.evaluate(() => globalThis.SN_IL_FILO.quandoFermo());
  const nav = eventi(ud).filter((e) => e.tipo === 'navigazione').map((e) => [e.url.replace(/^https?:\/\/[^/]+/, ''), e.titolo]);
  const tit = eventi(ud).filter((e) => e.tipo === 'navigazione.titolo').map((e) => e.titolo);
  console.log('VISITE', JSON.stringify(nav, null, 1), 'TITOLI', JSON.stringify(tit));
});
