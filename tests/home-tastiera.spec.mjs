// #2372 — la home ha un campo solo: quello che si batte senza averci cliccato finisce nella chat. Due lettere uguali
// battute per prime lanciano l'azione assegnata (dalle Preferenze, dal tasto destro di un tasto o a parole), mai
// dopo un'altra lettera, mai col tasto tenuto premuto, mai con un riquadro sopra la home o nel campo della ricerca.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { home, modelloFinto } from './helpers/chatFinta.mjs';
import { homeIntera } from './helpers/tastiHome.mjs';

const SHOTS = 'tests/.shots';
mkdirSync(SHOTS, { recursive: true });

async function casa(app) {
  await homeIntera(app);
  const page = await home(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#altroPiu')).toBeVisible({ timeout: 10_000 });
  return page;
}
// Le schede aperte su un indirizzo: una pagina del mini server aperta dal doppio tocco.
const aperte = (app, url) => app.evaluate(({ BrowserWindow }, u) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  return w._filoTabs.tabs.filter((t) => { try { return t.view.webContents.getURL().startsWith(u); } catch (_) { return false; } }).length;
}, url);
const lettere = (app) => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).doppioTocco.lettere);
// Il fuoco lontano dal campo: su un punto vuoto della pagina.
const fuocoAltrove = (page) => page.evaluate(() => { document.activeElement && document.activeElement.blur(); });

test('un campo solo: quello che batto senza cliccarci finisce nella chat', async ({ app }) => {
  const page = await casa(app);
  await fuocoAltrove(page);
  await page.keyboard.type('ciao Filo');
  await expect(page.locator('#input')).toHaveValue('ciao Filo');
  await expect.poll(() => page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('input');
  // Nella pagina si vede un campo di testo solo.
  const visibili = await page.evaluate(() => [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=button]), textarea, [contenteditable="true"]')]
    .filter((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(n).visibility !== 'hidden'; }).map((n) => n.id));
  expect(visibili).toEqual(['input']);
  // Anche col fuoco su un tasto della colonna (non un campo) la battitura va nella chat.
  await page.locator('#input').fill('');
  await page.locator('#altroPiu').focus();
  await page.keyboard.type('ok');
  await expect(page.locator('#input')).toHaveValue('ok');
});

// #2372.1 — il campo tiene il fuoco davvero: un clic su un punto vuoto lo rimette lì, e ci arrivano tutti i tasti, non
// solo le lettere.
test('dopo un clic su un punto vuoto il campo ha il fuoco: Backspace, Ctrl+V, frecce e Invio funzionano come lì dentro', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await casa(app);
  const campo = page.locator('#input');
  const fuoco = () => page.evaluate(() => document.activeElement && document.activeElement.id);
  await page.keyboard.type('ciao');
  await expect(campo).toHaveValue('ciao');
  await page.mouse.click(640, 300);
  await expect.poll(fuoco).toBe('input');
  await page.keyboard.press('Backspace');
  await expect(campo).toHaveValue('cia');
  await app.evaluate(({ clipboard }) => clipboard.writeText(' incollato'));
  await page.mouse.click(640, 300);
  await page.keyboard.press('Control+V');
  await expect(campo).toHaveValue('cia incollato');
  await page.mouse.click(640, 300);
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('i');
  await expect(campo).toHaveValue('ciia incollato');

  // Il fuoco lasciato su un punto vuoto in altro modo (qui un blur da codice, con del testo selezionato nella pagina che
  // lo tiene lì): Ctrl+C copia la selezione, Backspace e Invio sono del campo, e Invio manda.
  await page.evaluate(() => {
    const t = document.querySelector('.dash-altro-tit');
    const r = document.createRange();
    r.selectNodeContents(t);
    document.getSelection().removeAllRanges();
    document.getSelection().addRange(r);
    document.activeElement.blur();
  });
  await page.waitForTimeout(100);
  expect(await fuoco()).toBe('');
  await page.keyboard.press('Control+C');
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('altro');
  // Il cursore è rimasto dov'era, dopo «cii».
  await page.keyboard.press('Backspace');
  await expect(campo).toHaveValue('cia incollato');
  await modelloFinto(app, [{ text: 'Eccomi.' }]);
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('Enter');
  await expect(page.locator('.dash-bubble-user', { hasText: 'cia incollato' })).toBeVisible({ timeout: 10_000 });
  await expect(campo).toHaveValue('');
});

test('con la ricerca aperta il clic su un punto vuoto rimette il fuoco nella ricerca, e il tasto destro non lo sposta', async ({ app }) => {
  const page = await casa(app);
  const fuoco = () => page.evaluate(() => document.activeElement && document.activeElement.id);
  await page.locator('#altro .dash-altro-app[data-id="cerca"]').click();
  await page.keyboard.type('orc');
  await page.mouse.click(640, 300);
  await expect.poll(fuoco).toBe('cercaInput');
  await page.keyboard.type('he');
  await page.keyboard.press('Backspace');
  await expect(page.locator('#cercaInput')).toHaveValue('orch');
  await expect(page.locator('#input')).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect.poll(fuoco).toBe('input');
  // Un menu aperto col tasto destro tiene il suo fuoco: il campo non glielo ruba.
  await page.locator('#altro .dash-altro-app[data-id="impostazioni"]').click({ button: 'right' });
  await expect(menuDi(page).principale).toBeVisible();
  await page.waitForTimeout(200);
  await expect(menuDi(page).principale).toBeVisible();
  await page.keyboard.press('Escape');
});

test('una lettera ridata a un’altra cosa dice cosa apriva prima, dalle Preferenze e dal tasto destro', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const urlDi = () => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).doppioTocco.lettere.map((v) => v.url || v.tasto).join());
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ doppioTocco: { lettere: [{ lettera: 'y', url: 'https://www.youtube.com/' }] } }));
  const pref = await openTab('filo://preferences/preferences.html');
  await expect(pref.locator('#doppioToccoLettere .mem-riga')).toHaveCount(1);
  await pref.locator('#doppioToccoNuova').fill('y');
  await pref.locator('#doppioToccoDove').fill('example.com');
  await pref.locator('#doppioToccoAggiungi').click();
  await expect.poll(urlDi).toBe('https://example.com/');
  await expect(pref.locator('#doppioToccoHint')).toBeVisible();
  await expect(pref.locator('#doppioToccoHint')).toHaveText('Salvato (prima apriva youtube.com)');
  await pref.locator('#doppioToccoHint').scrollIntoViewIfNeeded();
  await pref.screenshot({ path: `${SHOTS}/2372-1-lettera-ridata-preferenze.png` });
  // La stessa lettera ridata alla stessa cosa non perde niente: niente avviso in più.
  await pref.locator('#doppioToccoNuova').fill('y');
  await pref.locator('#doppioToccoDove').fill('example.com');
  await pref.locator('#doppioToccoAggiungi').click();
  await expect(pref.locator('#doppioToccoHint')).toHaveText('Salvato');

  const page = await casa(app);
  await page.locator('#altro .dash-altro-app[data-id="impostazioni"]').click({ button: 'right' });
  await menuDi(page).scegli('Assegna una lettera');
  await page.keyboard.press('y');
  await expect.poll(urlDi).toBe('impostazioni');
  await expect(page.locator('#dashFlash')).toContainText('«yy» nella home: Impostazioni (prima apriva example.com)');
  await page.screenshot({ path: `${SHOTS}/2372-1-lettera-ridata-home.png` });
});

test('«yy» dato dalle Preferenze apre la pagina; «ayy», la y tenuta premuta, un riquadro sopra e la ricerca no', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const url = testServer.html('<title>Video</title><h1>video</h1>');
  // Dalle Preferenze: lettera, dove porta, «Aggiungi». La riga compare nell'elenco.
  const pref = await openTab('filo://preferences/preferences.html');
  await pref.locator('#doppioToccoNuova').fill('y');
  await pref.locator('#doppioToccoDove').fill(url);
  await pref.locator('#doppioToccoAggiungi').click();
  await expect(pref.locator('#doppioToccoLettere .mem-riga')).toHaveText([/^yy → 127\.0\.0\.1/]);
  await expect.poll(() => lettere(app)).toEqual([{ lettera: 'y', url: new URL(url).href }]);
  await pref.screenshot({ path: `${SHOTS}/2372-preferenze-lettere.png` });

  const page = await casa(app);
  const campo = page.locator('#input');

  // «ayy»: la doppia non è all'inizio, è testo.
  await campo.focus();
  await page.keyboard.type('ayy', { delay: 40 });
  await expect(campo).toHaveValue('ayy');
  expect(await aperte(app, url)).toBe(0);

  // La y tenuta premuta si ripete da sola: è testo anche lei.
  await campo.fill('');
  await page.keyboard.down('y');
  await page.keyboard.down('y');
  await page.keyboard.down('y');
  await page.keyboard.up('y');
  await expect(campo).toHaveValue(/^y{2,}$/);
  expect(await aperte(app, url)).toBe(0);

  // Con la conferma che chiede una parola sopra la home la doppia resta testo: nel campo del riquadro, o in quello
  // della chat se il riquadro gli rimanda i tasti di chi stava scrivendo (#592). Mai un comando.
  await campo.fill('');
  await page.evaluate(() => { window.__conferma = window.SN_CONFIRM_UI.confirmTyped({ title: 'Prova', text: 'Scrivi conferma', word: 'conferma' }); });
  await page.waitForTimeout(400);
  await page.keyboard.type('yy', { delay: 40 });
  await page.waitForTimeout(600);
  expect(await aperte(app, url)).toBe(0);
  await expect(campo).toHaveValue(/^(yy)?$/);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // Col fuoco nella ricerca della colonna la doppia è testo da cercare.
  await page.locator('#altro .dash-altro-app[data-id="cerca"]').click();
  await page.keyboard.type('yy', { delay: 40 });
  await expect(page.locator('#cercaInput')).toHaveValue('yy');
  expect(await aperte(app, url)).toBe(0);
  await page.keyboard.press('Escape');

  // Prime due battute del campo, in fretta: la pagina si apre, e nel campo non resta niente.
  await campo.fill('');
  await page.keyboard.press('y');
  // La prima y non compare mai: se arriva la seconda il campo non ha niente da far sparire.
  expect(await campo.inputValue()).toBe('');
  await page.keyboard.press('y');
  await expect.poll(() => aperte(app, url), { timeout: 8_000 }).toBe(1);
  await expect(campo).toHaveValue('');
});

test('la y da sola si scrive dopo la soglia, e «ye» resta «ye»: la prima lettera non si perde', async ({ app }) => {
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ doppioTocco: { sogliaMs: 300, lettere: [{ lettera: 'y', url: 'https://example.com/' }] } }));
  const page = await casa(app);
  const campo = page.locator('#input');
  await campo.focus();
  await page.keyboard.press('y');
  await expect(campo).toHaveValue('y', { timeout: 2_000 });
  await campo.fill('');
  await page.keyboard.type('ye', { delay: 30 });
  await expect(campo).toHaveValue('ye');
  await campo.fill('');
  await page.keyboard.type('yes, certo', { delay: 20 });
  await expect(campo).toHaveValue('yes, certo');
});

test('dal tasto destro di un tasto gli do una lettera premendola, e due volte quella lettera lo usa', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await casa(app);
  await page.locator('#altro .dash-altro-app[data-id="cerca"]').click({ button: 'right' });
  await menuDi(page).scegli('Assegna una lettera');
  await page.keyboard.press('c');
  await expect.poll(() => lettere(app)).toEqual([{ lettera: 'c', tasto: 'cerca' }]);
  await expect(page.locator('#altro .dash-altro-app[data-id="cerca"]')).toHaveAttribute('title', /cc$/);
  await expect(page.locator('#input')).toHaveValue('');

  await page.locator('#input').focus();
  await page.keyboard.press('c');
  await page.keyboard.press('c');
  await expect(page.locator('#cercaFilo')).toBeVisible();
  await expect(page.locator('#input')).toHaveValue('');
  await page.keyboard.press('Escape');

  // Cambiata dal suo tasto destro, la vecchia lettera non vale più.
  await page.locator('#altro .dash-altro-app[data-id="cerca"]').click({ button: 'right' });
  await menuDi(page).scegli('Cambia lettera (cc)');
  await page.keyboard.press('f');
  await expect.poll(() => lettere(app)).toEqual([{ lettera: 'f', tasto: 'cerca' }]);
  await page.locator('#altro .dash-altro-app[data-id="cerca"]').click({ button: 'right' });
  await page.locator('.dash-menu .dash-menu-voce', { hasText: 'Togli la lettera' }).click();
  await expect.poll(() => lettere(app)).toEqual([]);
});

test('a parole: «assegna yy a example.com» lo scrive fra le lettere, e le Preferenze lo mostrano', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const page = await casa(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 'p1', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"doppio tocco","valore":"y example.com"}' }] },
  ]);
  await page.locator('#input').fill('fai che yy apra example.com');
  await page.locator('#sendBtn').click();
  await expect.poll(() => lettere(app), { timeout: 10_000 }).toEqual([{ lettera: 'y', url: 'https://example.com/' }]);
  const pref = await openTab('filo://preferences/preferences.html');
  await expect(pref.locator('#doppioToccoLettere .mem-riga')).toHaveText(['yy → example.com×']);
});
