// Esplorazione: cosa vede l'utente per localhost e posta chiesti alla chat dopo #1130 (un giro solo).
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiamateAlModello, ripristina, chiedi } from '../../helpers/chatFinta.mjs';

const naviga = (id, url, etichetta) => ({ id, name: 'NAVIGA', arguments: JSON.stringify(etichetta ? { url, etichetta } : { url }) });
const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { try { return t.view.webContents.getURL() || t.url || ''; } catch (_) { return t.url || ''; } });
});
const avvisi = (shell) => shell.evaluate(() => [...document.querySelectorAll('#shell-notifs > .shell-notif')].map((c) => c.textContent));

test.afterEach(async ({ app }) => { await ripristina(app); });

test('localhost un giro', async ({ app, shell, testServer }) => {
  test.setTimeout(90_000);
  const scritto = testServer.html('<title>Server di sviluppo</title><p>pronto</p>').replace('http://127.0.0.1', 'localhost');
  const pagina = `http://${scritto}`;
  await modelloFinto(app, [{ text: 'Apro il server.', toolCalls: [naviga('n1', scritto, 'Server di sviluppo')] }, { text: 'Fatto.' }]);
  const page = await home(app);
  await chiedi(page, `apri ${scritto}`);
  await expect.poll(async () => (await schede(app)).filter((u) => u === pagina).length, { timeout: 15_000 }).toBe(1);
  await page.waitForTimeout(3000);
  console.log('CHIAMATE', (await chiamateAlModello(app)).length);
  console.log('BOLLE', JSON.stringify(await page.locator('.dash-bubble-filo').allTextContents()));
  const bottone = page.locator('a.dash-action-link-chip');
  console.log('BOTTONI', await bottone.count(), await bottone.first().getAttribute('href').catch(() => null));
  await app.evaluate(() => { globalThis.__usc = []; const o = globalThis.SN_USCITA_DA_FILO; globalThis.SN_USCITA_DA_FILO = (u, wc, a) => { const r = o(u, wc, a); Promise.resolve(r).then((x) => globalThis.__usc.push([u, x])); return r; }; });
  await page.evaluate(() => { window.__conf = []; const U = window.SN_CONFIRM_UI; if (U) U.confirm = async (o) => { window.__conf.push(o.text); return true; }; });
  if (await bottone.count()) {
    await bottone.first().evaluate((a) => a.click());
    await page.waitForTimeout(2000);
    console.log('DIALOGO', JSON.stringify(await page.evaluate(() => window.__conf)));
    await expect.poll(async () => (await schede(app)).filter((u) => u === pagina).length, { timeout: 15_000 }).toBe(2).catch((e) => console.log('NON RIAPRE'));
  }
  console.log('SCHEDE', JSON.stringify(await schede(app)));
  console.log('AVVISI', JSON.stringify(await avvisi(shell)));
});

test('posta un giro', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await app.evaluate(({ shell: s }) => { globalThis.__esterni = []; s.openExternal = async (u) => { globalThis.__esterni.push(String(u)); }; });
  const posta = 'mailto:mario.rossi@esempio.it?subject=Cena%20di%20sabato';
  await modelloFinto(app, [{ toolCalls: [naviga('m1', posta)] }, { text: 'Ti ho aperto la mail per Mario.' }]);
  const page = await home(app);
  await chiedi(page, 'scrivi una mail a mario.rossi@esempio.it per la cena di sabato');
  await expect.poll(() => app.evaluate(() => globalThis.__esterni), { timeout: 15_000 }).toEqual([posta]);
  await page.waitForTimeout(3000);
  console.log('CHIAMATE', (await chiamateAlModello(app)).length);
  console.log('BOLLE', JSON.stringify(await page.locator('.dash-bubble-filo').allTextContents()));
  console.log('AVVISI', JSON.stringify(await avvisi(shell)));
});

test('http normale un giro', async ({ app, testServer }) => {
  test.setTimeout(90_000);
  const pagina = testServer.html('<title>Normale</title><p>pronto</p>');
  await modelloFinto(app, [{ text: 'Apro.', toolCalls: [naviga('n2', pagina, 'Normale')] }, { text: 'Fatto.' }]);
  const page = await home(app);
  await chiedi(page, `apri ${pagina}`);
  await expect.poll(async () => (await schede(app)).filter((u) => u === pagina).length, { timeout: 15_000 }).toBe(1);
  await page.waitForTimeout(3000);
  const bottone = page.locator('a.dash-action-link-chip');
  console.log('BOTTONI2', await bottone.count(), await bottone.first().getAttribute('href').catch(() => null));
  await bottone.first().evaluate((a) => a.click());
  await expect.poll(async () => (await schede(app)).filter((u) => u === pagina).length, { timeout: 15_000 }).toBe(2).catch((e) => console.log('NON RIAPRE2'));
  console.log('SCHEDE2', JSON.stringify(await schede(app)));
});
