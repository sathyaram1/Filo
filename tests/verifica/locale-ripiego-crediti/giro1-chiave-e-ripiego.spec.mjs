// Verifica del ramo ripiego-crediti, primo giro — la chiave OpenRouter propria
// nella pagina Crediti e il ripiego sui crediti di Filo.
//
// Cosa era stato chiesto: la chiave propria ha la priorità; se OpenRouter la
// rifiuta (non valida, ritirata, credito finito) si usano i crediti di Filo;
// la chiave si mette in Crediti, si riconosce dagli ultimi caratteri, si
// toglie, e la pagina dice quanto si è speso e quanto resta; il server
// raccoglie i dati di spesa che gli servono.
//
// Il banco: server dei crediti VERO (filo-security) su un archivio in memoria,
// OpenRouter finto dentro l'app che risponde per chiave.
import { test, expect } from '@playwright/test';
import {
  avviaServer, avviaFilo, apriCrediti, fintoOpenRouter, impostaOpenRouter,
  chiamateOpenRouter, righeRegistro, chiediInChat, cartellaFiloSecurity,
} from './helpers/banco.mjs';

test.skip(!cartellaFiloSecurity(), 'filo-security non è accanto al repo: il server dei crediti non si può far girare');

let server;
test.beforeEach(async () => { server = await avviaServer(); });
test.afterEach(async () => { await server.chiudi(); });

async function chiudi(filo) { try { await filo.app.close(); } catch (_) {} }

const PROPRIA = 'sk-or-v1-propria-0123456789ABCDEF';
const CODA = PROPRIA.slice(-6);
const primoWallet = () => [...server.store.docs.wallets.values()][0];
const chiavePersonale = () => server.keys.keys.get(primoWallet().keyHash).key;

async function riscatta(page, code) {
  await page.fill('#inviteCode', code);
  await page.click('#redeemBtn');
  await expect(page.locator('#redeemForm')).toBeHidden({ timeout: 15_000 });
  await expect(page.locator('#balance')).not.toHaveText('—', { timeout: 15_000 });
}

async function mettiChiave(page, key) {
  await expect(page.locator('#ownKeyForm')).toBeVisible({ timeout: 15_000 });
  await page.fill('#ownKeyInput', key);
  await page.click('#ownKeySaveBtn');
  await expect(page.locator('#ownKeyHave')).toBeVisible({ timeout: 15_000 });
}

async function apriHome(filo) {
  const dash = await filo.openTab('filo://dashboard/dashboard.html');
  await expect(dash.locator('#homeMessage')).not.toHaveText('…', { timeout: 15_000 });
  return dash;
}

const chiamateChat = async (app) => (await chiamateOpenRouter(app)).filter((c) => c.url.includes('/chat/completions'));

test('la chiave si mette in Crediti, si riconosce dagli ultimi sei caratteri, dice spesa e residuo, ha la priorità sui crediti di Filo, e si toglie con conferma (anche l’Annulla)', async () => {
  test.setTimeout(180_000);
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    await riscatta(page, code);
    await fintoOpenRouter(filo.app, { byKey: { [PROPRIA]: { keyInfo: { limit: 10, usage: 1.23, limit_remaining: 8.77 } } } });

    // Prima della chiave: la sezione c'è, col campo.
    await expect(page.locator('#ownKeySection')).toBeVisible();
    await expect(page.locator('#ownKeyForm')).toBeVisible();
    expect(await page.locator('#ownKeyInput').getAttribute('type')).toBe('password');

    await mettiChiave(page, PROPRIA);
    await expect(page.locator('#ownKeyTail')).toHaveText(`…${CODA}`);
    // La chiave intera non deve comparire da nessuna parte nella pagina.
    expect(await page.locator('body').innerText()).not.toContain(PROPRIA);
    await expect(page.locator('#ownKeyBalance')).toHaveText('Spesi 1,23 $ · restano 8,77 $ su 10,00 $', { timeout: 15_000 });
    const nota = await page.locator('#walletNote').innerText();
    const regola = await page.locator('#ownKeyRule').innerText();
    console.log('[nota]', `con la chiave: nota «${nota}», regola «${regola}», saldo «${await page.locator('#balance').innerText()}»`);
    expect(nota).toMatch(/tua chiave/i);

    // Le Impostazioni vedono la stessa chiave (è lo stesso campo).
    const opts = await filo.openTab('filo://options/options.html');
    await expect(opts.locator('#apiKey')).toHaveValue(PROPRIA, { timeout: 15_000 });

    // La priorità: la chat parte con la chiave propria, non con la personale.
    const dash = await apriHome(filo);
    const bolla = await chiediInChat(dash, 'ciao');
    expect(await bolla.innerText()).toContain('Ciao dal modello finto.');
    const calls = await chiamateChat(filo.app);
    expect(calls.length).toBe(1);
    expect(calls[0].key).toBe(PROPRIA);
    await expect(dash.locator('.dash-bubble-note[data-key-fallback]')).toHaveCount(0);
    // Con la chiave propria il consumo è dell'utente: nessuna riga nel registro di Filo.
    await dash.waitForTimeout(6000);
    expect((await righeRegistro(filo.app)).length).toBe(0);

    // Togliere: la domanda compare al posto del pulsante; Annulla la richiude.
    await page.click('#ownKeyRemoveBtn');
    await expect(page.locator('#ownKeyConfirm')).toBeVisible();
    await expect(page.locator('#ownKeyRemoveBtn')).toBeHidden();
    await page.click('#ownKeyRemoveNo');
    await expect(page.locator('#ownKeyConfirm')).toBeHidden();
    await expect(page.locator('#ownKeyRemoveBtn')).toBeVisible();
    await expect(page.locator('#ownKeyTail')).toHaveText(`…${CODA}`);
    // Sì, toglila.
    await page.click('#ownKeyRemoveBtn');
    await page.click('#ownKeyRemoveYes');
    await expect(page.locator('#ownKeyForm')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#ownKeyHave')).toBeHidden();
    // La nota «stai usando la tua chiave» non deve restare a schermo (nascosta
    // col testo vecchio dentro va bene: non si legge).
    if (await page.locator('#walletNote').isVisible()) {
      expect(await page.locator('#walletNote').innerText()).not.toMatch(/tua chiave/i);
    }
    await opts.reload();
    await expect(opts.locator('#apiKey')).toHaveValue('', { timeout: 15_000 });
    // Da qui in poi paga la personale.
    await chiediInChat(dash, 'e adesso?');
    const dopo = await chiamateChat(filo.app);
    expect(dopo.length).toBe(2);
    expect(dopo[1].key).toBe(chiavePersonale());
    console.log('[nota]', 'tolta la chiave: la chat riparte con la personale');
  } finally { await chiudi(filo); }
});

test('OpenRouter rifiuta la chiave propria (402, poi 401, poi 403): la risposta arriva coi crediti di Filo, la riga sotto lo dice, la pagina Crediti mostra il rifiuto, e la riga del registro d’uso parte per il server', async () => {
  test.setTimeout(240_000);
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    await riscatta(page, code);
    await fintoOpenRouter(filo.app, { byKey: { [PROPRIA]: { status: 402 } } });
    await mettiChiave(page, PROPRIA);
    // Spesa e residuo di una chiave rifiutata: la pagina lo dice, non resta muta.
    await expect(page.locator('#ownKeyBalance')).not.toHaveText(/Chiedo a OpenRouter/, { timeout: 15_000 });
    console.log('[nota]', `chiave rifiutata (402), riga spesa/residuo: «${await page.locator('#ownKeyBalance').innerText()}»`);

    const dash = await apriHome(filo);
    const bolla = await chiediInChat(dash, 'ciao');
    expect(await bolla.innerText()).toContain('Ciao dal modello finto.');
    const calls = await chiamateChat(filo.app);
    expect(calls.map((c) => c.key)).toEqual([PROPRIA, chiavePersonale()]);
    const riga = dash.locator('.dash-bubble-note[data-key-fallback]');
    await expect(riga).toHaveCount(1);
    const testoRiga = await riga.innerText();
    console.log('[nota]', `riga sotto la risposta: «${testoRiga}»`);
    expect(testoRiga).toMatch(/rifiutato la tua chiave/i);
    expect(testoRiga).toMatch(/credito è finito/i);
    expect(testoRiga).toMatch(/crediti di Filo/i);

    // La pagina Crediti aperta accanto lo mostra da sé.
    await expect(page.locator('#ownKeyRefusal')).toBeVisible({ timeout: 15_000 });
    const rifiuto = await page.locator('#ownKeyRefusal').innerText();
    console.log('[nota]', `pagina Crediti: «${rifiuto}»`);
    expect(rifiuto).toMatch(/credito è finito/);
    expect(rifiuto).toMatch(/crediti/);

    // Il registro d'uso: la chiamata l'ha pagata la personale, la riga parte.
    await expect.poll(async () => (await righeRegistro(filo.app)).length, { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
    const righe = await righeRegistro(filo.app);
    const r = righe[0];
    console.log('[nota]', `riga del registro: ${JSON.stringify(r)}`);
    expect(r.pseudonym).toBe(primoWallet().pseudonym);
    expect(r.action).toBe('filo_chat');
    expect(r.costUsd).toBeCloseTo(0.0021, 6);
    expect(r.credits).toBeGreaterThan(0);
    expect(r.servedBy).toBe('FintoHost');
    expect(Object.keys(r).sort()).toEqual(['action', 'at', 'completionTokens', 'costUsd', 'credits', 'model', 'promptTokens', 'pseudonym', 'servedBy']);
    // Il server VERO la riconcilia col consumo della chiave senza segnalare niente.
    server.store.docs.usage.push(...righe);
    server.keys.keys.get(primoWallet().keyHash).usageUsd = righe.reduce((s, x) => s + x.costUsd, 0);
    const rec = await server.reconcile();
    console.log('[nota]', `riconciliazione: ${JSON.stringify(rec)}`);
    expect(rec.flagged).toBe(0);
    expect(rec.errors).toBe(0);

    // 401: non la riconosce.
    await impostaOpenRouter(filo.app, { byKey: { [PROPRIA]: { status: 401 } } });
    await chiediInChat(dash, 'ancora');
    const righe401 = dash.locator('.dash-bubble-note[data-key-fallback]');
    await expect(righe401).toHaveCount(2);
    expect(await righe401.nth(1).innerText()).toMatch(/non la riconosce/);
    await expect(page.locator('#ownKeyRefusal')).toHaveText(/non la riconosce/, { timeout: 15_000 });
    // 403: bloccata.
    await impostaOpenRouter(filo.app, { byKey: { [PROPRIA]: { status: 403 } } });
    await chiediInChat(dash, 'e ancora');
    await expect(dash.locator('.dash-bubble-note[data-key-fallback]')).toHaveCount(3);
    await expect(page.locator('#ownKeyRefusal')).toHaveText(/bloccato/, { timeout: 15_000 });
    // Una chiamata che fallisce per altro (429) NON ripiega: è la rete, non la chiave.
    await impostaOpenRouter(filo.app, { byKey: { [PROPRIA]: { status: 429 } } });
    const prima = (await chiamateChat(filo.app)).length;
    const err = await chiediInChat(dash, 'limite');
    const dopo429 = await chiamateChat(filo.app);
    console.log('[nota]', `429 sulla propria: la chat dice «${(await err.innerText()).slice(0, 120)}», chiavi usate ${JSON.stringify(dopo429.slice(prima).map((c) => c.key === PROPRIA ? 'propria' : 'personale'))}`);
    expect(dopo429.slice(prima).some((c) => c.key === chiavePersonale())).toBe(false);

    // Tolta la chiave, il rifiuto sparisce con lei; rimessa una chiave, non torna.
    await page.click('#ownKeyRemoveBtn');
    await page.click('#ownKeyRemoveYes');
    await expect(page.locator('#ownKeyForm')).toBeVisible({ timeout: 15_000 });
    await impostaOpenRouter(filo.app, { byKey: { [PROPRIA]: { status: 200 } } });
    await mettiChiave(page, PROPRIA);
    await expect(page.locator('#ownKeyRefusal')).toBeHidden();
    await expect(page.locator('#ownKeyRule')).toHaveText(/prova prima lei/);
  } finally { await chiudi(filo); }
});

test('senza portafoglio: la chiave rifiutata è un errore che porta a Crediti; con portafoglio ma anche i crediti di Filo finiti, l’errore dice cosa fare', async () => {
  test.setTimeout(180_000);
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    await fintoOpenRouter(filo.app, { byKey: { [PROPRIA]: { status: 402 } } });
    // Senza portafoglio.
    await mettiChiave(page, PROPRIA);
    const regola = await page.locator('#ownKeyRule').innerText();
    console.log('[nota]', `senza portafoglio, regola: «${regola}»`);
    expect(regola).toMatch(/paghi tu/i);
    const dash = await apriHome(filo);
    const bolla = await chiediInChat(dash, 'ciao');
    const testo = await bolla.innerText();
    console.log('[nota]', `senza portafoglio, chiave rifiutata: «${testo.slice(0, 200)}»`);
    expect(testo).toMatch(/chiave|credit/i);
    await expect(bolla.locator('button', { hasText: 'Apri Crediti' })).toBeVisible();
    expect((await chiamateChat(filo.app)).length).toBe(1);

    // Ora col portafoglio: la personale pure rifiutata (402).
    await riscatta(page, code);
    await impostaOpenRouter(filo.app, { byKey: { [PROPRIA]: { status: 402 }, [chiavePersonale()]: { status: 402 } } });
    const bolla2 = await chiediInChat(dash, 'entrambe');
    const testo2 = await bolla2.innerText();
    console.log('[nota]', `propria 402 e personale 402: «${testo2.slice(0, 300)}»`);
    const calls = await chiamateChat(filo.app);
    expect(calls.slice(1).map((c) => c.key)).toEqual([PROPRIA, chiavePersonale()]);
    expect(testo2).toMatch(/credit/i);
    await expect(page.locator('#ownKeyRefusal')).toBeVisible({ timeout: 15_000 });
  } finally { await chiudi(filo); }
});

test('la chiave messa e tolta dalle Impostazioni si vede subito in Crediti, e viceversa', async () => {
  test.setTimeout(180_000);
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    await riscatta(page, code);
    await fintoOpenRouter(filo.app, {});
    const opts = await filo.openTab('filo://options/options.html');
    // Il campo della chiave nelle Impostazioni sta nella parte «avanzata», che
    // compare solo togliendo «usa i modelli predefiniti» (era già così).
    await expect(opts.locator('#useDefaultModels')).toBeVisible({ timeout: 15_000 });
    if (await opts.locator('#useDefaultModels').isChecked()) await opts.click('#useDefaultModels');
    await expect(opts.locator('#apiKey')).toBeVisible({ timeout: 15_000 });
    await opts.fill('#apiKey', PROPRIA);
    await opts.dispatchEvent('#apiKey', 'change');
    await expect(page.locator('#ownKeyHave')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#ownKeyTail')).toHaveText(`…${CODA}`);
    await opts.fill('#apiKey', '');
    await opts.dispatchEvent('#apiKey', 'change');
    await expect(page.locator('#ownKeyForm')).toBeVisible({ timeout: 15_000 });
    // E da Crediti alle Impostazioni: riaperte, la vedono.
    await mettiChiave(page, PROPRIA);
    await opts.reload();
    await expect(opts.locator('#useDefaultModels')).toBeVisible({ timeout: 15_000 });
    if (await opts.locator('#useDefaultModels').isChecked()) await opts.click('#useDefaultModels');
    await expect(opts.locator('#apiKey')).toHaveValue(PROPRIA, { timeout: 15_000 });
    await page.click('#ownKeyRemoveBtn');
    await page.click('#ownKeyRemoveYes');
    await expect(page.locator('#ownKeyForm')).toBeVisible({ timeout: 15_000 });
    await opts.reload();
    await expect(opts.locator('#useDefaultModels')).toBeVisible({ timeout: 15_000 });
    if (await opts.locator('#useDefaultModels').isChecked()) await opts.click('#useDefaultModels');
    await expect(opts.locator('#apiKey')).toHaveValue('', { timeout: 15_000 });

    // La porta: le Impostazioni già aperte (campo vuoto) mentre la chiave si
    // mette in Crediti. Cambiare QUALUNQUE altra cosa nelle Impostazioni non
    // deve portarsi via la chiave appena messa.
    await mettiChiave(page, PROPRIA);
    await expect(page.locator('#ownKeyTail')).toHaveText(`…${CODA}`);
    await opts.fill('#monthlyLimit', '7');
    await opts.dispatchEvent('#monthlyLimit', 'change');
    await opts.waitForTimeout(1500);
    const dopo = await filo.app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).apiKeys.openrouter);
    console.log('[nota]', `Impostazioni aperte prima della chiave, poi un altro campo cambiato: la chiave ${dopo ? 'resta' : 'SPARISCE'}`);
    await expect(page.locator('#ownKeyHave')).toBeVisible({ timeout: 5000 });
    expect(dopo).toBe(PROPRIA);
  } finally { await chiudi(filo); }
});

test('input limite nel campo della chiave: vuoto, soli spazi, spazi attorno, diecimila caratteri, HTML; e le varianti di spesa/residuo (nessun tetto, OpenRouter muto)', async () => {
  test.setTimeout(180_000);
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    await riscatta(page, code);
    await fintoOpenRouter(filo.app, {});
    // Vuoto e soli spazi: un rifiuto leggibile, niente chiave salvata.
    for (const v of ['', '   ']) {
      await page.fill('#ownKeyInput', v);
      await page.click('#ownKeySaveBtn');
      await expect(page.locator('#ownKeyMsg')).toBeVisible();
      await expect(page.locator('#ownKeyForm')).toBeVisible();
    }
    console.log('[nota]', `vuoto: «${await page.locator('#ownKeyMsg').innerText()}»`);
    // Spazi attorno: si toglie la cornice.
    await mettiChiave(page, `  ${PROPRIA}  `);
    await expect(page.locator('#ownKeyTail')).toHaveText(`…${CODA}`);
    expect((await filo.app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).apiKeys.openrouter))).toBe(PROPRIA);
    await page.click('#ownKeyRemoveBtn');
    await page.click('#ownKeyRemoveYes');
    await expect(page.locator('#ownKeyForm')).toBeVisible({ timeout: 15_000 });
    // HTML: testo, non markup.
    const html = '<img src=x onerror="document.title=\'xss\'">';
    await mettiChiave(page, html);
    await expect(page.locator('#ownKeyTail')).toHaveText(`…${html.slice(-6)}`);
    expect(await page.title()).not.toBe('xss');
    expect(await page.locator('#ownKeyTail img').count()).toBe(0);
    await page.click('#ownKeyRemoveBtn');
    await page.click('#ownKeyRemoveYes');
    await expect(page.locator('#ownKeyForm')).toBeVisible({ timeout: 15_000 });
    // Diecimila caratteri: si salva, la coda è leggibile, la pagina non sborda.
    const lunga = 'sk-or-v1-' + 'x'.repeat(10_000) + 'FINE99';
    await mettiChiave(page, lunga);
    await expect(page.locator('#ownKeyTail')).toHaveText('…FINE99');
    const sborda = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(sborda).toBe(false);
    await page.click('#ownKeyRemoveBtn');
    await page.click('#ownKeyRemoveYes');
    await expect(page.locator('#ownKeyForm')).toBeVisible({ timeout: 15_000 });
    // Nessun tetto sulla chiave: solo la spesa.
    await impostaOpenRouter(filo.app, { byKey: { [PROPRIA]: { keyInfo: { limit: null, usage: 0.5, limit_remaining: null } } } });
    await mettiChiave(page, PROPRIA);
    await expect(page.locator('#ownKeyBalance')).toHaveText('Spesi 0,50 $ · nessun tetto', { timeout: 15_000 });
    // OpenRouter muto (500) sulla domanda: la riga lo dice, non resta «Chiedo a OpenRouter…».
    await page.click('#ownKeyRemoveBtn');
    await page.click('#ownKeyRemoveYes');
    await expect(page.locator('#ownKeyForm')).toBeVisible({ timeout: 15_000 });
    await impostaOpenRouter(filo.app, { byKey: { [PROPRIA]: { keyInfoStatus: 500 } } });
    await mettiChiave(page, PROPRIA);
    await expect(page.locator('#ownKeyBalance')).not.toHaveText(/Chiedo a OpenRouter/, { timeout: 15_000 });
    const muto = await page.locator('#ownKeyBalance').innerText();
    console.log('[nota]', `OpenRouter muto sulla spesa: «${muto}»`);
    expect(muto.length).toBeGreaterThan(5);
    // Doppio clic sul salva con la stessa chiave: niente doppia riga, niente errore.
  } finally { await chiudi(filo); }
});

test('aspetto: la sezione della chiave in tema chiaro e scuro, col rifiuto a schermo', async () => {
  test.setTimeout(180_000);
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    await riscatta(page, code);
    await fintoOpenRouter(filo.app, { byKey: { [PROPRIA]: { status: 402 } } });
    await mettiChiave(page, PROPRIA);
    await expect(page.locator('#ownKeyBalance')).not.toHaveText(/Chiedo a OpenRouter/, { timeout: 15_000 });
    const dash = await apriHome(filo);
    await chiediInChat(dash, 'ciao');
    await expect(page.locator('#ownKeyRefusal')).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: 'tests/.shots/ripiego-crediti-chiaro.png', fullPage: true });
    await dash.screenshot({ path: 'tests/.shots/ripiego-chat-chiaro.png' });
    await filo.app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }); });
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('ownKeyHave').hidden, null, { timeout: 15_000 });
    await expect(page.locator('#ownKeyBalance')).not.toHaveText(/Chiedo a OpenRouter/, { timeout: 15_000 });
    await page.screenshot({ path: 'tests/.shots/ripiego-crediti-scuro.png', fullPage: true });
    await dash.reload();
    await expect(dash.locator('#homeMessage')).not.toHaveText('…', { timeout: 15_000 });
    await chiediInChat(dash, 'ciao di nuovo');
    await dash.screenshot({ path: 'tests/.shots/ripiego-chat-scuro.png' });
  } finally { await chiudi(filo); }
});
