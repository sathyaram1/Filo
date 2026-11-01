// Esplorazione del giro 3 di #1468: collegamenti fra pagine di Filo, tempo in vista.
import { test, expect } from '../../fixtures/electron.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strade = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const out = {};
  for (const ora of Object.values(s.ore || {})) {
    if (!ora.strade) continue;
    for (const [m, conti] of Object.entries(ora.strade)) {
      for (const [k, n] of Object.entries(conti || {})) (out[m] = out[m] || {})[k] = ((out[m] || {})[k] || 0) + n;
    }
  }
  return out;
});
const attiva = (app) => app.evaluate(({ BrowserWindow }) => {
  const t = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
  const a = t.tabs.find((x) => x.id === t.activeId);
  return { id: t.activeId, url: a ? a.url : '', n: t.tabs.length };
});

test('collegamenti fra pagine di Filo', async ({ app, openTab }) => {
  const pref = await openTab('filo://preferences/preferences.html');
  await pref.waitForSelector('#contatoriPrivacy', { state: 'attached' });
  await pref.evaluate(() => document.getElementById('contatoriPrivacy').click());
  await expect.poll(() => attiva(app).then((a) => a.url), { timeout: 8000 }).toMatch(/transparency/);
  await sleep(800);
  console.log('A', JSON.stringify(await strade(app)));
  await pref.evaluate(() => document.getElementById('correttoreModelli').click());
  await expect.poll(() => attiva(app).then((a) => a.url), { timeout: 8000 }).toMatch(/options/);
  await sleep(1000);
  // lasciata subito: un'altra scheda davanti
  await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
    t.openTab('filo://newtab/');
  });
  await sleep(1000);
  const s = await strade(app);
  console.log('B', JSON.stringify(s));
  expect(s.pagina_di_filo_aperta?.['transparency:collegamento_interno']).toBe(1);
  expect(s.pagina_di_filo_aperta?.['options:collegamento_interno']).toBe(1);
  expect(Object.keys(s.pagina_di_filo_aperta || {}).some((k) => k.startsWith('vista:options:'))).toBe(true);
});

test('feedback per chi non è owner: la lista delle segnalazioni dalla pagina', async ({ app, openTab }) => {
  const fb = await openTab('filo://feedback/feedback.html');
  await fb.waitForSelector('#adminMie', { state: 'attached' });
  await fb.evaluate(() => document.getElementById('adminMie').click());
  await expect.poll(() => attiva(app).then((a) => a.url), { timeout: 8000 }).toMatch(/board/);
  await sleep(800);
  const s = await strade(app);
  console.log('C', JSON.stringify(s));
  expect(s.pagina_di_filo_aperta?.['board:collegamento_interno']).toBe(1);
});
