// #843 — Filo si spegne su un sito e si riaccende in tre modi equivalenti: dal tasto destro sul sito, chiedendolo a
// Filo (home e Aiuto della pagina) e dall'elenco della pagina Altro, che accetta un indirizzo incollato. La scheda già
// aperta segue l'elenco senza ricaricare (#589.2); su un sito spento il tasto destro offre «Riaccendi Filo su questo sito».

import { test, expect } from './fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina } from './helpers/chatFinta.mjs';
import { clickConfirm } from './helpers/confirm.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { paginaDellAiuto } from './helpers/riquadri.mjs';

const SITO = 'filo-843.test';
const DOCS = 'docs.filo-843.test';
const SOTTO = 'a.docs.filo-843.test';
const ALTRO = 'altro-843.test';
test.use({ hostInPiu: [SITO, DOCS, SOTTO, ALTRO] });

const PAGINA = `<!doctype html><html><head><meta charset="utf-8"><title>Pagina 843</title></head>
<body style="padding:40px;font:16px sans-serif"><p id="testo">Un paragrafo qualunque, senza un menu del sito.</p></body></html>`;

const esclusi = (app) => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).blocklist);

async function apriSu(openTab, testServer, host) {
  const page = await openTab(testServer.html(PAGINA).replace('127.0.0.1', host));
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}

const finestraDiRiserva = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.isVisible() && x.webContents.getURL().startsWith('data:text/html'));
  return w ? w.webContents.executeJavaScript("[...document.querySelectorAll('.item .lbl')].map((n) => n.textContent)") : [];
});
const scegliDiRiserva = (app, voce) => app.evaluate(({ BrowserWindow }, v) => {
  const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.isVisible() && x.webContents.getURL().startsWith('data:text/html'));
  return w.webContents.executeJavaScript(`[...document.querySelectorAll('button.item')].find((b) => b.textContent.trim() === ${JSON.stringify(v)}).click()`);
}, voce);

async function tastoDestro(page) {
  await page.locator('#testo').click({ button: 'right' });
}

test('dal menu del tasto destro: Filo si spegne sul sito, la scheda aperta segue senza ricaricare e si riaccende da lì', async ({ app, openTab, testServer, avvisi }) => {
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ blocklist: ['banca-843.test'] }); });
  const page = await apriSu(openTab, testServer, SITO);
  await page.evaluate(() => { window.__nonRicaricata = 843; });

  await tastoDestro(page);
  const voce = menuDi(page).locator('.sn-menu .sn-menu-item', { hasText: 'Spegni Filo su questo sito' });
  await expect(voce).toBeVisible({ timeout: 5000 });
  await voce.click();
  await expect.poll(() => esclusi(app), { timeout: 5000 }).toEqual(['banca-843.test', SITO]);
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show', { hasText: `Filo è spento su ${SITO}` })).toBeVisible({ timeout: 5000 });

  // Il tasto destro dopo, sulla stessa scheda: niente menu di Filo, e in cima la voce per riaccenderlo.
  await page.waitForTimeout(300);
  await tastoDestro(page);
  await expect.poll(() => finestraDiRiserva(app), { timeout: 5000 }).toContain('Riaccendi Filo su questo sito');
  expect((await finestraDiRiserva(app))[0]).toBe('Riaccendi Filo su questo sito');
  await expect(menuDi(page).locator('.sn-menu')).toHaveCount(0);

  await scegliDiRiserva(app, 'Riaccendi Filo su questo sito');
  await expect.poll(() => esclusi(app), { timeout: 5000 }).toEqual(['banca-843.test']);
  await expect(vista.locator('.shell-notif.show', { hasText: `Filo è di nuovo acceso su ${SITO}` })).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(300);
  await tastoDestro(page);
  await expect(menuDi(page).locator('.sn-menu .sn-menu-item', { hasText: 'Spegni Filo su questo sito' })).toBeVisible({ timeout: 5000 });
  expect(await page.evaluate(() => window.__nonRicaricata), 'la scheda si è ricaricata').toBe(843);
});

test('«Annulla» nell\'avviso rimette Filo com\'era', async ({ app, openTab, testServer, avvisi }) => {
  const page = await apriSu(openTab, testServer, SITO);
  await tastoDestro(page);
  await menuDi(page).locator('.sn-menu .sn-menu-item', { hasText: 'Spegni Filo su questo sito' }).click();
  await expect.poll(() => esclusi(app), { timeout: 5000 }).toEqual([SITO]);
  const vista = await avvisi();
  await vista.locator('.shell-notif.show', { hasText: `Filo è spento su ${SITO}` }).locator('button', { hasText: 'Annulla' }).click();
  await expect.poll(() => esclusi(app), { timeout: 5000 }).toEqual([]);
  await page.waitForTimeout(300);
  await tastoDestro(page);
  await expect(menuDi(page).locator('.sn-menu')).toBeVisible({ timeout: 5000 });
});

test('la pagina Altro accetta un indirizzo incollato, lo mostra ridotto al sito, e il sito coi sottodomini resta senza menu di Filo', async ({ app, openTab, testServer }) => {
  const altro = await openTab('filo://options/altro.html');
  const casella = altro.locator('#blocklist');
  await expect(casella).toHaveValue('', { timeout: 8000 });
  await expect(altro.locator('#h-blocklist')).toHaveText('Siti dove Filo è spento');
  await expect(altro.locator('main')).not.toContainText(/estensione/i);

  await app.evaluate(({ clipboard }) => clipboard.writeText('https://www.Docs.Filo-843.test/document/d/x'));
  await casella.click();
  await altro.keyboard.press('Control+V');
  await expect.poll(() => esclusi(app), { timeout: 5000 }).toEqual([DOCS]);
  await expect(casella).toHaveValue(DOCS);

  // Una riga che non è un sito si dice, e resta dov'era.
  await altro.keyboard.type('\nfaceb');
  await altro.locator('#h-blocklist').click();
  await expect(altro.locator('#blocklistError')).toBeVisible();
  await expect(altro.locator('#blocklistError')).toContainText('faceb');
  await expect(casella).toHaveValue(`${DOCS}\nfaceb`);
  expect(await esclusi(app)).toEqual([DOCS]);

  for (const host of [DOCS, SOTTO]) {
    const page = await apriSu(openTab, testServer, host);
    await page.waitForTimeout(300);
    await tastoDestro(page);
    await expect.poll(() => finestraDiRiserva(app), { timeout: 5000 }).toContain('Riaccendi Filo su questo sito');
    await expect(menuDi(page).locator('.sn-menu'), `menu di Filo su ${host}`).toHaveCount(0);
  }
});

test('la pagina Altro accetta più siti incollati sulla stessa riga e li mostra uno per riga', async ({ app, openTab }) => {
  const altro = await openTab('filo://options/altro.html');
  const casella = altro.locator('#blocklist');
  await expect(casella).toHaveValue('', { timeout: 8000 });
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), `${DOCS}, ${ALTRO}`);
  await casella.click();
  await altro.keyboard.press('Control+V');
  await altro.locator('#h-blocklist').click();
  await expect.poll(() => esclusi(app), { timeout: 5000 }).toEqual([DOCS, ALTRO]);
  await expect(casella).toHaveValue(`${DOCS}\n${ALTRO}`);
  await expect(altro.locator('#blocklistError')).toBeHidden();
});

test('dalla home: «spegni Filo su …» lo aggiunge senza togliere gli altri e «riaccendi» lo toglie; la pagina Altro aperta segue', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8000 });
  const chat = await home(app);
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ blocklist: ['banca-843.test'] }); });
  const altro = await openTab('filo://options/altro.html');
  const casella = altro.locator('#blocklist');
  await expect(casella).toHaveValue('banca-843.test', { timeout: 8000 });

  // Un'impostazione riuscita chiude il turno (#1130): la frase va scritta insieme.
  const imposta = (valore, id, text) => ({ text, toolCalls: [{ id, name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'siti_filo_spento', valore }) }] });
  await modelloFinto(app, [imposta(`aggiungi ${DOCS}`, 'i1', 'Spento.')]);
  await chiedi(chat, `spegni Filo su ${DOCS}`);
  await expect.poll(() => esclusi(app), { timeout: 10_000 }).toEqual(['banca-843.test', DOCS]);
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Spento.' })).toBeVisible({ timeout: 10_000 });

  // La pagina Altro già aperta mostra il sito nuovo, e il ritocco dopo non lo toglie.
  await expect(casella).toHaveValue(`banca-843.test\n${DOCS}`, { timeout: 5000 });
  await casella.click();
  await altro.keyboard.press('Control+End');
  await altro.keyboard.type(`\n${ALTRO}`);
  await expect.poll(() => esclusi(app), { timeout: 5000 }).toEqual(['banca-843.test', DOCS, ALTRO]);

  await modelloFinto(app, [imposta(`togli ${DOCS}`, 'i2', 'Riacceso.')]);
  await chiedi(chat, `riaccendi Filo su ${DOCS}`);
  await expect.poll(() => esclusi(app), { timeout: 10_000 }).toEqual(['banca-843.test', ALTRO]);
  await expect(casella).toHaveValue(`banca-843.test\n${ALTRO}`, { timeout: 5000 });
  await ripristina(app);
});

test('«Ripristina tutto» in Preferenze svuota l\'elenco anche nella pagina Altro già aperta', async ({ app, openTab }) => {
  await app.evaluate(async (_e, d) => { await globalThis.SN_STORAGE.updateSettings({ blocklist: ['banca-843.test', d] }); }, DOCS);
  const altro = await openTab('filo://options/altro.html');
  const casella = altro.locator('#blocklist');
  await expect(casella).toHaveValue(`banca-843.test\n${DOCS}`, { timeout: 8000 });
  const pref = await openTab('filo://preferences/preferences.html');
  await pref.locator('#resetAllSettings').scrollIntoViewIfNeeded();
  await pref.locator('#resetAllSettings').click();
  await clickConfirm(pref, 'ok', { timeout: 5000 });
  await expect.poll(() => esclusi(app), { timeout: 5000 }).toEqual([]);
  await altro.bringToFront();
  await expect(casella).toHaveValue('', { timeout: 5000 });
  // Il ritocco dopo non rimanda i siti di prima.
  await casella.click();
  await altro.keyboard.type(ALTRO);
  await expect.poll(() => esclusi(app), { timeout: 5000 }).toEqual([ALTRO]);
});

// L'Aiuto della pagina riceve la risposta della prima coppia [parola, risposta] la cui parola sta nell'ultima richiesta.
async function aiutoFinto(app, risposte) {
  await app.evaluate(async (_e, r) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.HELP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    const risposta = ({ attempts, messages }) => {
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      if (!sistema.includes('# Protocollo di risposta')) return { text: '{"message":"Ciao.","suggestions":[],"issues":[]}', model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      const ultimo = JSON.stringify([...messages].reverse().find((m) => m.role === 'user') || '');
      const scelta = r.find(([parola]) => ultimo.includes(parola)) || r[r.length - 1];
      return { text: scelta[1], model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    P.completeWithFallback = async (o) => risposta(o);
    P.streamCompleteWithFallback = async (o) => risposta(o);
  }, risposte);
}

test('all\'Aiuto della pagina: «spegni Filo su questo sito» lo spegne lì, senza toccare gli altri, e «riaccendilo» lo riaccende', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ blocklist: ['banca-843.test'] }); });
  const filo = (valore, text) => JSON.stringify({ action: 'filo', filo: { type: 'IMPOSTA_PREFERENZA', chiave: 'siti_filo_spento', valore }, text });
  await aiutoFinto(app, [['riaccendi', filo('togli questo sito', 'Lo riaccendo.')], ['spegni', filo('aggiungi questo sito', 'Lo spengo qui.')]]);
  const page = await apriSu(openTab, testServer, DOCS);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const aiuto = await paginaDellAiuto(app, page);
  const casella = aiuto.locator('.sn-sidebar-input textarea');
  await expect(casella).toBeVisible({ timeout: 8000 });

  await casella.fill('spegni Filo su questo sito');
  await casella.press('Enter');
  await expect.poll(() => esclusi(app), { timeout: 10_000 }).toEqual(['banca-843.test', DOCS]);
  await expect(aiuto.locator('.sn-sidebar-log', { hasText: `Filo spento su ${DOCS}` })).toBeVisible({ timeout: 5000 });
  await page.locator('#testo').click({ button: 'right' });
  await expect.poll(() => finestraDiRiserva(app), { timeout: 5000 }).toContain('Riaccendi Filo su questo sito');
  await expect(menuDi(page).locator('.sn-menu')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await casella.fill('riaccendilo');
  await casella.press('Enter');
  await expect.poll(() => esclusi(app), { timeout: 10_000 }).toEqual(['banca-843.test']);
  await expect(aiuto.locator('.sn-sidebar-log', { hasText: `Filo riacceso su ${DOCS}` })).toBeVisible({ timeout: 5000 });
});
