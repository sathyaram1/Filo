// Verifica #1296 giro 2: esplorazione.
import { test, expect } from '../../fixtures/electron.mjs';
import {
  newtabPage, configureModel, copione, ripristina, testoDellaChiamata, ricercaLenta, lasciaLaRicerca, ricercaPartita, quadratoPronto,
} from '../../helpers/copione.mjs';

const chiamate = (app) => app.evaluate(() => globalThis.__messaggi.length);
async function impostazioni(app, settings) {
  await app.evaluate(async (_, st) => globalThis.__filoHandlers.handleMessage(
    { type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: st },
    { url: 'filo://preferences/preferences.html' },
  ), settings);
}

test('x1 seguito in attesa poi ricarica: il seguito non si perde', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await copione(app, [
    { pensa: ['Ci penso a lungo. ', 'Ancora. ', 'Ancora. ', 'Quasi. '], ogni: 800, testo: 'Prima risposta.' },
    { pensa: ['Seguito. '], ogni: 100, testo: 'Risposta al seguito.' },
  ]);
  await page.locator('#input').fill('prima domanda');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-activity-trama').last()).toContainText('a lungo', { timeout: 6_000 });
  await page.locator('#input').fill('seguito importante');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-bubble-attesa')).toBeVisible({ timeout: 1_000 });
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-state', /thread|home/, { timeout: 15_000 });
  await page.waitForTimeout(6_000);
  const archivio = await app.evaluate(async () => (await globalThis.SN_FILO_CHATS.list()).filter((c) => !c.app).flatMap((c) => c.messages.map((m) => `${m.role}: ${m.text}`)));
  console.log('ARCHIVIO x1', JSON.stringify(archivio), 'chiamate', await chiamate(app));
  console.log('CASELLA x1', await page.locator('#input').inputValue());
  const visibile = await page.locator('#bubbles').innerText();
  console.log('BOLLE x1', visibile);
  expect(visibile + (await page.locator('#input').inputValue())).toContain('seguito importante');
  await ripristina(app);
});

test('x2 fermato prima del pensiero, movimento normale, chiaro e scuro: screenshot e misure', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  for (const tema of ['light', 'dark']) {
    await impostazioni(app, { theme: tema });
    await copione(app, [{ prima: 30_000, testo: 'Mai.' }]);
    await page.locator('#input').fill('una domanda ' + tema);
    await page.locator('#sendBtn').click();
    await quadratoPronto(page);
    await page.locator('#stopBtn').click();
    await expect(page.locator('.dash-bubble-fermato').last()).toHaveText('Fermato prima della risposta.', { timeout: 5_000 });
    await page.waitForTimeout(2_500);
    const misure = await page.evaluate(() => {
      const blocchi = document.querySelectorAll('.dash-activity[data-fermato="1"]');
      const blocco = blocchi[blocchi.length - 1];
      const tratto = blocco.querySelector('.dash-activity-filo-tratto');
      const svg = tratto.ownerSVGElement.getBoundingClientRect();
      const bb = tratto.getBBox();
      const note = document.querySelectorAll('.dash-bubble-fermato');
      return { punta: svg.top + bb.y + bb.height, fondoBlocco: blocco.getBoundingClientRect().bottom, nota: note[note.length - 1].getBoundingClientRect().top };
    });
    console.log('MISURE x2', tema, JSON.stringify(misure));
    await page.screenshot({ path: `tests/.shots/v1296-fermato-${tema}.png` });
  }
  await impostazioni(app, { theme: 'system' });
  await ripristina(app);
});

test('x3 fermato dopo un pensiero: screenshot', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await copione(app, [{ pensa: ['Ci penso. ', 'Ancora. ', 'Ancora. ', 'Ancora. ', 'Ancora. ', 'Ancora. '], ogni: 900, testo: 'Mai.' }]);
  await page.locator('#input').fill('una domanda');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-activity-trama').last()).toContainText('Ci penso', { timeout: 6_000 });
  await quadratoPronto(page);
  await page.locator('#stopBtn').click();
  await expect(page.locator('.dash-bubble-fermato').last()).toHaveText('Fermato prima della risposta.', { timeout: 5_000 });
  await page.waitForTimeout(2_500);
  await page.screenshot({ path: 'tests/.shots/v1296-fermato-dopo-pensiero.png' });
  await ripristina(app);
});

test('x4 dopo uno stop durante un\'azione lenta, una conversazione riaperta dalla Cronologia risponde subito', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  let page = await newtabPage(app);
  await configureModel(app);
  await copione(app, [{ pensa: ['Ok. '], ogni: 100, testo: 'Prima chat.' }]);
  await page.locator('#input').fill('conversazione vecchia');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Prima chat.' })).toBeVisible({ timeout: 8_000 });
  await page.locator('#input').fill('/clear');
  await page.locator('#input').press('Enter');
  await ricercaLenta(app);
  await copione(app, [
    { pensa: ['Cerco. '], ogni: 100, dopoStrumenti: 100, strumenti: [{ id: 'f1', name: 'CERCA_WEB', arguments: '{"query":"orari treni"}' }] },
    { pensa: ['Altro. '], ogni: 100, testo: 'Risposta riaperta.' },
  ]);
  await page.locator('#input').fill('orari treni');
  await page.locator('#input').press('Enter');
  await ricercaPartita(app);
  await quadratoPronto(page);
  await page.locator('#stopBtn').click();
  await expect(page.locator('#sendBtn')).toHaveAttribute('aria-label', 'Riprendi', { timeout: 5_000 });
  const id = await app.evaluate(async () => (await globalThis.SN_FILO_CHATS.list()).filter((c) => !c.app).find((c) => c.messages.some((m) => m.text === 'conversazione vecchia')).id);
  await page.goto(`filo://newtab/?chat=${id}`);
  await expect(page.locator('#input')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1500);
  await page.locator('#input').fill('domanda nella riaperta');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Risposta riaperta.' })).toBeVisible({ timeout: 5_000 });
  expect(await app.evaluate(() => globalThis.__ricercheFinite)).toBe(0);
  await lasciaLaRicerca(app);
  await ripristina(app);
});

test('x5 normale: stop mentre Filo prepara la richiesta non chiama il modello', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await copione(app, [{ pensa: ['Rispondo. '], ogni: 100, testo: 'Non dovevo.' }]);
  await app.evaluate(() => {
    const S = globalThis.SN_SISTEMA_MAIN;
    const orig = S && S.statoPerChat;
    globalThis.__statoOrig = orig;
    const lento = async (...a) => { await new Promise((ok) => setTimeout(ok, 3_000)); return orig ? orig.apply(S, a) : null; };
    if (S) S.statoPerChat = lento; else globalThis.SN_SISTEMA_MAIN = { statoPerChat: lento };
  });
  await page.locator('#input').fill('ciao');
  await page.locator('#input').press('Enter');
  await quadratoPronto(page);
  await page.locator('#stopBtn').click();
  await page.waitForTimeout(4_500);
  console.log('CHIAMATE x5', await chiamate(app));
  expect(await chiamate(app)).toBe(0);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Non dovevo.' })).toHaveCount(0);
  await app.evaluate(() => { if (globalThis.SN_SISTEMA_MAIN && globalThis.__statoOrig) globalThis.SN_SISTEMA_MAIN.statoPerChat = globalThis.__statoOrig; });
  await ripristina(app);
});

test('x6 seguito con un\'immagine mentre Filo lavora: parte a fine turno con l\'immagine', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await copione(app, [
    { pensa: ['Ci penso. ', 'Ancora. ', 'Ancora. '], ogni: 700, testo: 'Prima risposta.' },
    { pensa: ['Guardo. '], ogni: 100, testo: 'Visto l\'immagine.' },
  ]);
  await page.locator('#input').fill('prima domanda');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-activity-trama').last()).toContainText('Ci penso', { timeout: 6_000 });
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await page.evaluate(async (src) => {
    const blob = await (await fetch(src)).blob();
    const file = new File([blob], 'punto.png', { type: 'image/png' });
    const dt = new DataTransfer(); dt.items.add(file);
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    document.getElementById('input').dispatchEvent(ev);
  }, png);
  await page.waitForTimeout(500);
  await page.locator('#input').fill('guarda questa');
  await page.locator('#input').press('Enter');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/.shots/v1296-seguito-immagine.png' });
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Visto l\'immagine.' })).toBeVisible({ timeout: 15_000 });
  const ultima = await app.evaluate(() => globalThis.__messaggi[globalThis.__messaggi.length - 1]);
  const s = JSON.stringify(ultima[ultima.length - 1]);
  console.log('ULTIMO x6', s.slice(0, 300));
  expect(s).toContain('image');
  await ripristina(app);
});

test.describe(() => {
  test.use({ accoglienzaFatta: false });
  test('x7 accoglienza: doppio clic d\'invio e doppio clic su Riprendi', async ({ app, shell }) => {
    test.setTimeout(90_000);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await newtabPage(app);
    await configureModel(app);
    await copione(app, [
      { pensa: ['Mi presento. ', 'Ecco. '], ogni: 400, testo: 'Piacere Luca, di cosa ti occupi?' },
      { pensa: ['Lungo. ', 'Ancora. ', 'Ancora. ', 'Ancora. ', 'Ancora. '], ogni: 900, testo: 'Mai.' },
      { pensa: ['Riprendo. '], ogni: 300, testo: 'Ripreso: cuoco!' },
    ]);
    await page.reload();
    await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });
    await page.locator('#input').fill('mi chiamo Luca');
    await page.locator('#sendBtn').dblclick();
    await expect(page.locator('.dash-bubble-filo', { hasText: 'di cosa ti occupi' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.dash-bubble-fermato')).toHaveCount(0);
    await page.locator('#input').fill('faccio il cuoco');
    await page.locator('#sendBtn').click();
    await quadratoPronto(page);
    await page.locator('#stopBtn').click();
    await expect(page.locator('#sendBtn')).toHaveAttribute('aria-label', 'Riprendi', { timeout: 5_000 });
    await page.locator('#sendBtn').dblclick();
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Ripreso: cuoco!' })).toBeVisible({ timeout: 10_000 });
    await ripristina(app);
  });
});
