// Esplorazione del giro 9 di #1343: le azioni sulla pagina della barra sulle pagine di Filo, il tasto destro
// sull'icona che la mette in «Altro…» e l'annullo, due finestre aperte.

import { test, expect } from '../../fixtures/electron.mjs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo, iconaDellaBarra, menuAperto, vociDelMenu, scegliNelMenu } from '../../helpers/barra.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const appunti = (app) => app.evaluate(({ clipboard }) => clipboard.readText());

test('E1 azioni sulla pagina sulla home di Filo', async ({ app, shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8000 });
  await pausa(1500);
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  const stato = await barra.evaluate(() => [...document.querySelectorAll('#nav .ico')].map((b) => ({
    id: b.dataset.id, spenta: b.getAttribute('aria-disabled'), sugg: b.dataset.sugg || '' })));
  console.log('HOME', JSON.stringify(stato));
  await app.evaluate(({ clipboard }) => clipboard.writeText('niente'));
  const share = barra.locator('#nav .ico[data-id="share"]');
  await share.click();
  await pausa(2000);
  console.log('HOME share appunti:', await appunti(app));
  const pref = await openTab('filo://preferences/preferences.html');
  await pausa(1500);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  const stato2 = await barra.evaluate(() => [...document.querySelectorAll('#nav .ico')].map((b) => ({
    id: b.dataset.id, spenta: b.getAttribute('aria-disabled'), sugg: b.dataset.sugg || '' })));
  console.log('PREF', JSON.stringify(stato2));
  await app.evaluate(({ clipboard }) => clipboard.writeText('niente'));
  await barra.locator('#nav .ico[data-id="share"]').click();
  await pausa(2000);
  console.log('PREF share appunti:', await appunti(app));
  await pref.screenshot({ path: 'tests/.shots/g9-pref.png' });
});

test('E3 tasto destro: metti in Altro, poi registro', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, '<!doctype html><title>S</title><h1>S</h1>');
  const t = await iconaDellaBarra(app, 'translate');
  const barra = await barraPage(app);
  await t.click({ button: 'right' });
  const menu = await menuAperto(app);
  console.log('VOCI', JSON.stringify(await vociDelMenu(menu)));
  await scegliNelMenu(menu, 'Altro');
  await expect.poll(async () => (await statoBarra(app)).secondary.includes('translate')).toBe(true);
  const reg = await app.evaluate(async () => {
    await globalThis.SN_REGISTRO_CAMBI.attesa();
    const r = await globalThis.chrome.storage.local.get('filo_cambi');
    return (r.filo_cambi || []).filter((e) => e.tipo === 'icone');
  });
  console.log('REG', JSON.stringify(reg.map((e) => ({ via: e.via, dove: e.dove, id: e.id }))));
  const frase = await app.evaluate(async () => globalThis.SN_CAMBI && JSON.stringify(Object.keys(globalThis.SN_CAMBI)));
  console.log('CAMBI api', frase);
  expect(reg.length).toBe(1);
  // annulla dal registro
  const ok = await app.evaluate(async (_e, id) => {
    const R = require('/home/user/Filo/src/main/services/registroCambi.js');
    return R.annullaOra ? R.annullaOra(id, { via: 'filo' }) : 'no';
  }, reg[0].id).catch((e) => String(e));
  console.log('ANNULLA', JSON.stringify(ok));
  await expect.poll(async () => (await statoBarra(app)).bar.includes('translate')).toBe(true);
  console.log('BAR', JSON.stringify((await statoBarra(app)).bar));
});

test('E5 due finestre: il trascinamento in una arriva nell\'altra', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, '<!doctype html><title>S</title><h1>S</h1>');
  const n = await app.evaluate(() => { require('/home/user/Filo/src/main/window').createWindow?.(); return Object.keys(require('/home/user/Filo/src/main/window')); }).catch((e) => String(e));
  console.log('window api', JSON.stringify(n));
});
