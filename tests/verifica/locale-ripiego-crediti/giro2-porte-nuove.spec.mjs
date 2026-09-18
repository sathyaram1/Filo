// Verifica del ramo ripiego-crediti, secondo giro. Le porte del primo giro
// sono chiuse (le sue prove sono verdi): qui si provano quelle accanto.
//
//  · il rifiuto ricordato in Crediti quando la chiave torna a funzionare
//    (ricarica del conto OpenRouter) o quando la chiave viene cambiata dalle
//    Impostazioni invece che da Crediti;
//  · la porta delle Impostazioni nel verso opposto (chiave tolta in Crediti,
//    vecchia scheda Impostazioni che risalva);
//  · «quanto resta» con un tetto sulla chiave più alto del credito del conto;
//  · un 403 di moderazione trattato come rifiuto della chiave;
//  · il ripiego su una strada che non è la chat (spiega);
//  · doppio clic e Invio ripetuto sul salva.
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
const SECONDA = 'sk-or-v1-seconda-ZZZZZZZZZZZZ654321';
const CODA = PROPRIA.slice(-6);
const primoWallet = () => [...server.store.docs.wallets.values()][0];
const chiavePersonale = () => server.keys.keys.get(primoWallet().keyHash).key;
const chiamateChat = async (app) => (await chiamateOpenRouter(app)).filter((c) => c.url.includes('/chat/completions'));

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
async function togliChiave(page) {
  await page.click('#ownKeyRemoveBtn');
  await page.click('#ownKeyRemoveYes');
  await expect(page.locator('#ownKeyForm')).toBeVisible({ timeout: 15_000 });
}
async function apriHome(filo) {
  const dash = await filo.openTab('filo://dashboard/dashboard.html');
  await expect(dash.locator('#homeMessage')).not.toHaveText('…', { timeout: 15_000 });
  return dash;
}
async function apriImpostazioni(filo) {
  const opts = await filo.openTab('filo://options/options.html');
  await expect(opts.locator('#useDefaultModels')).toBeVisible({ timeout: 15_000 });
  if (await opts.locator('#useDefaultModels').isChecked()) await opts.click('#useDefaultModels');
  await expect(opts.locator('#apiKey')).toBeVisible({ timeout: 15_000 });
  return opts;
}
const chiaveSalvata = (filo) => filo.app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).apiKeys.openrouter);

test('la chiave torna a funzionare (ricarica del conto): il rifiuto ricordato in Crediti non resta lì per sempre', async () => {
  test.setTimeout(180_000);
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    await riscatta(page, code);
    await fintoOpenRouter(filo.app, { byKey: { [PROPRIA]: { status: 402 } } });
    await mettiChiave(page, PROPRIA);
    const dash = await apriHome(filo);
    await chiediInChat(dash, 'ciao');
    await expect(page.locator('#ownKeyRefusal')).toBeVisible({ timeout: 15_000 });
    // L'utente ricarica il conto OpenRouter: la chiave risponde di nuovo.
    await impostaOpenRouter(filo.app, { byKey: { [PROPRIA]: { status: 200, keyInfo: { limit: null, usage: 0.7, limit_remaining: null }, account: { total_credits: 30, total_usage: 11.23 } } } });
    const bolla = await chiediInChat(dash, 'e adesso?');
    expect(await bolla.innerText()).toContain('Ciao dal modello finto.');
    const calls = await chiamateChat(filo.app);
    expect(calls[calls.length - 1].key).toBe(PROPRIA);
    // Nessuna riga «ho usato i crediti di Filo» sotto QUESTA risposta.
    await expect(dash.locator('.dash-bubble-note[data-key-fallback]')).toHaveCount(1);
    await page.waitForTimeout(1500);
    const rifiuto = page.locator('#ownKeyRefusal');
    const visibile = await rifiuto.isVisible();
    console.log('[nota]', `chiave di nuovo accettata, in Crediti il rifiuto ${visibile ? 'RESTA: «' + (await rifiuto.innerText()) + '»' : 'sparisce'}; riga spesa: «${await page.locator('#ownKeyBalance').innerText()}»`);
    // La chiave ha appena servito una chiamata: la pagina non può continuare a
    // dire che è rifiutata e che Filo usa i crediti.
    expect(visibile).toBe(false);
  } finally { await chiudi(filo); }
});

test('la chiave cambiata dalle Impostazioni mentre Crediti ricorda un rifiuto: il rifiuto era della chiave di prima', async () => {
  test.setTimeout(180_000);
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    await riscatta(page, code);
    await fintoOpenRouter(filo.app, { byKey: { [PROPRIA]: { status: 402 }, [SECONDA]: { status: 200 } } });
    await mettiChiave(page, PROPRIA);
    const dash = await apriHome(filo);
    await chiediInChat(dash, 'ciao');
    await expect(page.locator('#ownKeyRefusal')).toBeVisible({ timeout: 15_000 });
    // Strada equivalente: la chiave si cambia dalle Impostazioni.
    const opts = await apriImpostazioni(filo);
    await opts.fill('#apiKey', SECONDA);
    await opts.dispatchEvent('#apiKey', 'change');
    await expect(page.locator('#ownKeyTail')).toHaveText(`…${SECONDA.slice(-6)}`, { timeout: 15_000 });
    await page.waitForTimeout(1000);
    const visibile = await page.locator('#ownKeyRefusal').isVisible();
    console.log('[nota]', `chiave cambiata dalle Impostazioni: il rifiuto della vecchia ${visibile ? 'RESTA sotto la nuova' : 'sparisce'}`);
    expect(visibile).toBe(false);
    // E la stessa cosa da Crediti (togli + metti) — la strada del primo giro.
    await togliChiave(page);
    await impostaOpenRouter(filo.app, { byKey: { [SECONDA]: { status: 402 } } });
    await mettiChiave(page, SECONDA);
    await chiediInChat(dash, 'ancora');
    await expect(page.locator('#ownKeyRefusal')).toBeVisible({ timeout: 15_000 });
    await togliChiave(page);
    await mettiChiave(page, PROPRIA);
    await expect(page.locator('#ownKeyRefusal')).toBeHidden();
  } finally { await chiudi(filo); }
});

test('Impostazioni aperte con la chiave dentro, poi la chiave tolta in Crediti: un altro campo cambiato nelle Impostazioni non la rimette', async () => {
  test.setTimeout(180_000);
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    await riscatta(page, code);
    await fintoOpenRouter(filo.app, {});
    await mettiChiave(page, PROPRIA);
    const opts = await apriImpostazioni(filo);
    await expect(opts.locator('#apiKey')).toHaveValue(PROPRIA, { timeout: 15_000 });
    await togliChiave(page);
    await opts.fill('#monthlyLimit', '9');
    await opts.dispatchEvent('#monthlyLimit', 'change');
    await opts.waitForTimeout(1500);
    const dopo = await chiaveSalvata(filo);
    console.log('[nota]', `chiave tolta in Crediti, poi le Impostazioni (aperte prima) cambiano il limite: la chiave ${dopo ? 'TORNA' : 'resta tolta'}`);
    expect(dopo || '').toBe('');
    await expect(page.locator('#ownKeyForm')).toBeVisible({ timeout: 5000 });
    // E la chiamata dopo parte con la personale, non con quella tolta.
    const dash = await apriHome(filo);
    await chiediInChat(dash, 'ciao');
    const calls = await chiamateChat(filo.app);
    expect(calls[calls.length - 1].key).toBe(chiavePersonale());
  } finally { await chiudi(filo); }
});

test('quanto resta: un tetto sulla chiave più alto del credito del conto', async () => {
  test.setTimeout(120_000);
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    await riscatta(page, code);
    // Tetto 10 $ sulla chiave, spesi 1,23: per il tetto restano 8,77 $. Ma il
    // conto OpenRouter ha 2 $ in tutto: OpenRouter rifiuterà dopo 2 $, non
    // dopo 8,77.
    await fintoOpenRouter(filo.app, { byKey: { [PROPRIA]: { keyInfo: { limit: 10, usage: 1.23, limit_remaining: 8.77 }, account: { total_credits: 20, total_usage: 18 } } } });
    await mettiChiave(page, PROPRIA);
    await expect(page.locator('#ownKeyBalance')).not.toHaveText(/Chiedo a OpenRouter/, { timeout: 15_000 });
    const riga = await page.locator('#ownKeyBalance').innerText();
    console.log('[nota]', `tetto 10 $ (restano 8,77) ma conto con 2 $: la riga dice «${riga}»`);
    expect(riga).toMatch(/2,00 \$/);
  } finally { await chiudi(filo); }
});

test('un 403 (OpenRouter blocca la richiesta per moderazione) non è la chiave: niente ripiego a vuoto, niente rifiuto ricordato, e la chat non parla di credito finito', async () => {
  test.setTimeout(180_000);
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    await riscatta(page, code);
    // L'input è bloccato dalla moderazione: lo è con qualunque chiave.
    await fintoOpenRouter(filo.app, { byKey: { [PROPRIA]: { status: 403 }, [chiavePersonale()]: { status: 403 } } });
    await mettiChiave(page, PROPRIA);
    const dash = await apriHome(filo);
    const bolla = await chiediInChat(dash, 'testo bloccato');
    const testo = await bolla.innerText();
    const calls = await chiamateChat(filo.app);
    const chiavi = calls.map((c) => (c.key === PROPRIA ? 'propria' : (c.key === chiavePersonale() ? 'personale' : '?')));
    await page.waitForTimeout(1000);
    const rifiutoVisibile = await page.locator('#ownKeyRefusal').isVisible();
    const rifiuto = rifiutoVisibile ? await page.locator('#ownKeyRefusal').innerText() : '';
    console.log('[nota]', `403 su tutte e due: chiavi provate ${JSON.stringify(chiavi)}; chat «${testo.slice(0, 220).replace(/\n/g, ' / ')}»; Crediti ${rifiutoVisibile ? 'ricorda un rifiuto: «' + rifiuto + '»' : 'non ricorda rifiuti'}`);
    // Qualunque cosa faccia col ripiego, la frase all'utente non può dire che
    // il credito è finito: non lo è.
    expect(testo).not.toMatch(/credito è finito|crediti di Filo sono finiti/i);
    // E la pagina Crediti non può dire che la chiave è stata rifiutata.
    expect(rifiutoVisibile).toBe(false);
  } finally { await chiudi(filo); }
});

test('il ripiego vale anche fuori dalla chat: «spiega» con la chiave propria rifiutata arriva coi crediti di Filo e la riga d’uso parte', async () => {
  test.setTimeout(180_000);
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    await riscatta(page, code);
    await fintoOpenRouter(filo.app, { byKey: { [PROPRIA]: { status: 402 } } });
    await mettiChiave(page, PROPRIA);
    const r = await filo.app.evaluate(async () => {
      try {
        const MSG = globalThis.SN_MESSAGES;
        const res = await globalThis.SN_HANDLE_MESSAGE({ type: MSG.AI_REQUEST, action: 'explain', payload: { selection: 'ciao', sentence: 'ciao mondo' } }, {});
        return { ok: true, text: res && res.text };
      } catch (e) { return { ok: false, message: String(e && e.message || e) }; }
    });
    const calls = await chiamateChat(filo.app);
    console.log('[nota]', `spiega con la propria a 402: esito ${JSON.stringify(r)}; chiavi ${JSON.stringify(calls.map((c) => (c.key === PROPRIA ? 'propria' : 'personale')))}`);
    expect(r.ok).toBe(true);
    expect(String(r.text || '')).toContain('Ciao dal modello finto.');
    expect(calls.map((c) => c.key)).toEqual([PROPRIA, chiavePersonale()]);
    await expect(page.locator('#ownKeyRefusal')).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => (await righeRegistro(filo.app)).length, { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
    const riga = (await righeRegistro(filo.app))[0];
    expect(riga.action).toBe('explain');
    expect(riga.pseudonym).toBe(primoWallet().pseudonym);
    // E con la chiave che funziona, «spiega» non scrive righe nel registro di Filo.
    await impostaOpenRouter(filo.app, { byKey: { [PROPRIA]: { status: 200 } } });
    await filo.app.evaluate(async () => {
      const MSG = globalThis.SN_MESSAGES;
      await globalThis.SN_HANDLE_MESSAGE({ type: MSG.AI_REQUEST, action: 'explain', payload: { selection: 'ciao', sentence: 'ciao mondo' } }, {});
    });
    await page.waitForTimeout(5000);
    expect((await righeRegistro(filo.app)).length).toBe(1);
  } finally { await chiudi(filo); }
});

test('doppio clic e Invio ripetuto sul salva, togli ripetuto: una chiave sola, nessun errore, e la riga della spesa dopo l’uso', async () => {
  test.setTimeout(180_000);
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    await riscatta(page, code);
    await fintoOpenRouter(filo.app, { byKey: { [PROPRIA]: { keyInfo: { limit: null, usage: 0.5, limit_remaining: null }, account: { total_credits: 20, total_usage: 11.23 } } } });
    await expect(page.locator('#ownKeyForm')).toBeVisible({ timeout: 15_000 });
    await page.fill('#ownKeyInput', PROPRIA);
    await page.dblclick('#ownKeySaveBtn');
    await expect(page.locator('#ownKeyHave')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#ownKeyTail')).toHaveText(`…${CODA}`);
    expect(await chiaveSalvata(filo)).toBe(PROPRIA);
    await expect(page.locator('#ownKeyBalance')).toHaveText('Spesi 0,50 $ · restano 8,77 $ sul tuo conto OpenRouter', { timeout: 15_000 });
    const errori = await page.locator('#ownKeyMsg.is-error').count();
    expect(errori).toBe(0);
    // Togli, Annulla, Togli, Sì in fretta.
    await page.click('#ownKeyRemoveBtn');
    await page.click('#ownKeyRemoveNo');
    await page.click('#ownKeyRemoveBtn');
    await page.click('#ownKeyRemoveYes');
    await expect(page.locator('#ownKeyForm')).toBeVisible({ timeout: 15_000 });
    expect(await chiaveSalvata(filo) || '').toBe('');
    // Invio nel campo salva (è un modulo); due Invio di fila non fanno danni.
    await page.fill('#ownKeyInput', ` ${PROPRIA}\n`);
    await page.press('#ownKeyInput', 'Enter');
    await page.press('#ownKeyInput', 'Enter').catch(() => {});
    await expect(page.locator('#ownKeyHave')).toBeVisible({ timeout: 15_000 });
    expect(await chiaveSalvata(filo)).toBe(PROPRIA);
    // La riga della spesa dopo una chiamata pagata con la chiave: OpenRouter
    // ora dice 0,90 spesi. La pagina, ancora aperta, lo mostra?
    await expect(page.locator('#ownKeyBalance')).toHaveText(/Spesi 0,50/, { timeout: 15_000 });
    await impostaOpenRouter(filo.app, { byKey: { [PROPRIA]: { keyInfo: { limit: null, usage: 0.9, limit_remaining: null }, account: { total_credits: 20, total_usage: 11.63 } } } });
    const dash = await apriHome(filo);
    await chiediInChat(dash, 'ciao');
    await page.waitForTimeout(4000);
    const riga = await page.locator('#ownKeyBalance').innerText();
    console.log('[nota]', `dopo una chat pagata con la chiave, la pagina Crediti aperta dice «${riga}»; dopo il ricaricamento della pagina:`);
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('ownKeyHave').hidden, null, { timeout: 15_000 });
    await expect(page.locator('#ownKeyBalance')).toHaveText(/Spesi 0,90/, { timeout: 15_000 });
    console.log('[nota]', `«${await page.locator('#ownKeyBalance').innerText()}»`);
  } finally { await chiudi(filo); }
});
