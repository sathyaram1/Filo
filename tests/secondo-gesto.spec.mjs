// #1296 — Un secondo gesto non annulla quello appena partito, e fermare vale da quando si preme. Regole:
// patterns/il-filo-dell-attesa.md. Ogni prova asserisce il successo visto dall'utente, e senza il lavoro è rossa:
//  (A) doppio clic sul tasto d'invio o su «Riprendi»: il secondo clic cade sul quadrato appena comparso, che non ferma;
//  (B) Invio con del testo mentre Filo lavora manda un seguito: il lavoro arriva in fondo e il seguito ha risposta,
//      letto al passo dopo del turno o, se il turno non ne ha, appena finisce; fermare lo rimette nella casella;
//  (C) un riquadro di conferma appena comparso non si chiude per un clic fuori; Esc resta immediato;
//  (D) fermato prima del primo pensiero, la punta del filo tagliato non copre la riga sotto;
//  (E) nell'accoglienza lo stop si scrive quando si preme: ricaricare subito non rifà il turno fermato;
//  (F) dopo uno stop durante un'azione lenta, una conversazione nuova risponde senza aspettare quell'azione.

import { test, expect } from './fixtures/electron.mjs';
import { CONFIRM_HOST, confirmState, aspettaConfermaPronta } from './helpers/confirm.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';
import {
  newtabPage, configureModel, copione, ripristina, testoDellaChiamata, ricercaLenta, lasciaLaRicerca, ricercaPartita,
  quadratoPronto,
} from './helpers/copione.mjs';

const chiamate = (app) => app.evaluate(() => globalThis.__messaggi.length);
const ultimaChiamata = (app) => app.evaluate(() => globalThis.__messaggi[globalThis.__messaggi.length - 1]);
const ordineDelFilo = (page) => page.evaluate(() => [...document.querySelectorAll('#bubbles .dash-bubble, #bubbles .dash-bubble-fermato')]
  .filter((b) => !b.hidden && (b.textContent || '').trim())
  .map((b) => `${b.classList.contains('dash-bubble-user') ? 'utente' : b.classList.contains('dash-bubble-fermato') ? 'fermo' : 'filo'}: ${(b.textContent || '').trim()}`));

test('A — doppio clic sul tasto d\'invio: la risposta arriva, il quadrato appena comparso non ferma', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await copione(app, [{ pensa: ['Ci penso un attimo. ', 'Ecco. '], ogni: 400, testo: 'Risposta arrivata.' }]);
  await page.locator('#input').fill('ciao');
  // Il doppio clic di Playwright: i due clic nello stesso punto senza pausa, il secondo trova già il quadrato.
  await page.locator('#sendBtn').dblclick();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Risposta arrivata.' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.dash-bubble-fermato')).toHaveCount(0);
  expect(await app.evaluate(() => globalThis.__interrotte)).toBe(0);

  // Un doppio clic umano: un quinto di secondo fra i due.
  await page.locator('#input').fill('ancora');
  const b = await page.locator('#sendBtn').boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(200);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Risposta arrivata.' })).toHaveCount(2, { timeout: 10_000 });
  await expect(page.locator('.dash-bubble-fermato')).toHaveCount(0);

  // Dopo la frazione di secondo il quadrato ferma come sempre, e Invio a vuoto anche.
  await page.locator('#input').fill('e poi');
  await page.locator('#sendBtn').click();
  await quadratoPronto(page);
  await page.locator('#stopBtn').click();
  await expect(page.locator('.dash-bubble-fermato')).toHaveText('Fermato prima della risposta.', { timeout: 5_000 });
  await ripristina(app);
});

test('A2 — doppio clic su «Riprendi» dopo un fermo: il lavoro ripreso arriva in fondo', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await copione(app, [
    { pensa: ['Penso a lungo. ', 'Ancora. ', 'Ancora. ', 'Ancora. ', 'Ancora. '], ogni: 900, testo: 'Mai.' },
    { pensa: ['Riprendo. ', 'Quasi. '], ogni: 400, testo: 'Ripreso fino in fondo.' },
  ]);
  await page.locator('#input').fill('pensaci');
  await page.locator('#sendBtn').click();
  await quadratoPronto(page);
  await page.locator('#stopBtn').click();
  const invio = page.locator('#sendBtn');
  await expect(invio).toHaveAttribute('aria-label', 'Riprendi', { timeout: 5_000 });
  await expect(invio).toBeVisible();
  await invio.dblclick();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ripreso fino in fondo.' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.dash-bubble-fermato')).toHaveCount(0);
  expect(await chiamate(app)).toBe(2);
  await ripristina(app);
});

test('B — Invio con del testo mentre Filo lavora: il lavoro va in fondo e il seguito lo legge al passo dopo', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await copione(app, [
    { pensa: ['Metto il timer. '], ogni: 200, dopoStrumenti: 1_500, strumenti: [{ id: 'b1', name: 'TIMER', arguments: '{"secondi":120,"etichetta":"Pasta"}' }] },
    { pensa: ['Ha aggiunto una cosa. '], ogni: 200, testo: 'Timer messo, e ho letto anche il seguito.' },
  ]);
  await page.locator('#input').fill('metti un timer di due minuti');
  await page.locator('#input').press('Enter');
  const blocco = page.locator('.dash-activity').first();
  await expect(blocco.locator('.dash-activity-seg-head').first()).toHaveText('Avvio un timer…', { timeout: 5_000 });
  await page.locator('#input').fill('e poi dimmi anche che ore sono');
  await page.locator('#input').press('Enter');
  // Il seguito è subito nella conversazione, in attesa; la casella è libera e il lavoro non si ferma.
  const attesa = page.locator('.dash-bubble-user.dash-bubble-attesa', { hasText: 'e poi dimmi anche che ore sono' });
  await expect(attesa).toBeVisible({ timeout: 1_000 });
  await expect(page.locator('#input')).toHaveValue('');
  await expect(page.locator('#stopBtn')).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/secondo-gesto-seguito-in-attesa.png' });

  await expect(page.locator('.dash-bubble-filo', { hasText: 'ho letto anche il seguito' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.dash-bubble-fermato')).toHaveCount(0);
  await expect(blocco).not.toHaveAttribute('data-fermato', '1');
  expect((await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers())).map((t) => t.label)).toEqual(['Pasta']);
  // Un turno solo: il seguito è arrivato al modello nel secondo passo, dopo l'esito del timer.
  expect(await chiamate(app)).toBe(2);
  const seconda = await ultimaChiamata(app);
  const ultimo = seconda[seconda.length - 1];
  expect(ultimo.role).toBe('user');
  expect(testoDellaChiamata([ultimo])).toContain('e poi dimmi anche che ore sono');
  expect(testoDellaChiamata(seconda.slice(0, -1))).toContain('Pasta');
  // Non è più in attesa: è un messaggio come gli altri, e la risposta sta sotto.
  await expect(page.locator('.dash-bubble-attesa')).toHaveCount(0);
  const ordine = await ordineDelFilo(page);
  expect(ordine.slice(-3)).toEqual([
    'utente: metti un timer di due minuti',
    'utente: e poi dimmi anche che ore sono',
    'filo: Timer messo, e ho letto anche il seguito.',
  ]);
  await page.screenshot({ path: 'tests/.shots/secondo-gesto-seguito-letto.png' });
  // L'archivio racconta lo stesso, nello stesso ordine: riaperta, la chat è uguale.
  const archivio = await page.evaluate(async () => {
    const chats = await new Promise((ok) => chrome.runtime.sendMessage({ type: self.SN_MSG.MSG.FILO_CHAT_LIST }, ok));
    const id = (chats.chats || chats.list || [])[0]?.id;
    const r = await new Promise((ok) => chrome.runtime.sendMessage({ type: self.SN_MSG.MSG.FILO_CHAT_GET, id }, ok));
    return (r.chat.messages || []).map((m) => `${m.role}: ${m.text}`);
  });
  expect(archivio).toEqual([
    'user: metti un timer di due minuti',
    'user: e poi dimmi anche che ore sono',
    'filo: Timer messo, e ho letto anche il seguito.',
  ]);
  await ripristina(app);
});

test('B2 — il seguito arrivato all\'ultimo passo parte appena il turno finisce, e ha la sua risposta', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await copione(app, [
    { pensa: ['Rispondo alla prima. ', 'Ci vuole un po\'. ', 'Ecco. '], ogni: 600, testo: 'Prima risposta.' },
    { pensa: ['Il seguito. '], ogni: 200, testo: 'Risposta al seguito.' },
  ]);
  await page.locator('#input').fill('prima domanda');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-activity-trama').first()).toContainText('prima', { timeout: 5_000 });
  await page.locator('#input').fill('seconda domanda');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-bubble-attesa', { hasText: 'seconda domanda' })).toBeVisible({ timeout: 1_000 });
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Risposta al seguito.' })).toBeVisible({ timeout: 15_000 });
  expect(await chiamate(app)).toBe(2);
  const seconda = await ultimaChiamata(app);
  expect(testoDellaChiamata([seconda[seconda.length - 1]])).toContain('seconda domanda');
  expect(testoDellaChiamata(seconda)).toContain('Prima risposta.');
  await expect(page.locator('.dash-bubble-attesa')).toHaveCount(0);
  // La prima risposta resta sotto la prima domanda: il seguito si mette in fila dopo di lei.
  const ordine = await ordineDelFilo(page);
  expect(ordine.slice(-4)).toEqual([
    'utente: prima domanda', 'filo: Prima risposta.', 'utente: seconda domanda', 'filo: Risposta al seguito.',
  ]);
  await expect(page.locator('#sendBtn')).toHaveAttribute('aria-label', 'Invia');
  await ripristina(app);
});

test('B3 — fermare con un seguito in attesa lo rimette nella casella; dal tasto destro lo si riprende prima', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  const lungo = { pensa: ['Penso a lungo. ', 'Ancora. ', 'Ancora. ', 'Ancora. ', 'Ancora. '], ogni: 900, testo: 'Mai.' };
  await copione(app, [lungo, lungo, { pensa: ['Ok. '], ogni: 100, testo: 'Fatto.' }]);
  await page.locator('#input').fill('pensaci');
  await page.locator('#input').press('Enter');
  await quadratoPronto(page);
  await page.locator('#input').fill('anzi, aggiungi questo');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-bubble-attesa')).toBeVisible({ timeout: 1_000 });
  // Invio a casella vuota resta lo stop.
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-bubble-fermato')).toHaveText('Fermato prima della risposta.', { timeout: 5_000 });
  // Il seguito non è partito né perso: è di nuovo nella casella, e Invio lo manda.
  await expect(page.locator('.dash-bubble-attesa')).toHaveCount(0);
  await expect(page.locator('#input')).toHaveValue('anzi, aggiungi questo');
  await page.waitForTimeout(800);
  expect(await chiamate(app)).toBe(1);

  // Dal tasto destro sul seguito in attesa: «Rimetti nella casella», e non parte più.
  await page.locator('#input').press('Enter');
  await quadratoPronto(page);
  await page.locator('#input').fill('questo no');
  await page.locator('#input').press('Enter');
  const attesa = page.locator('.dash-bubble-attesa', { hasText: 'questo no' });
  await expect(attesa).toBeVisible({ timeout: 1_000 });
  await attesa.click({ button: 'right' });
  await menuDi(page).locator('.sn-menu').getByText('Rimetti nella casella').click();
  await expect(page.locator('.dash-bubble-attesa')).toHaveCount(0);
  await expect(page.locator('#input')).toHaveValue('questo no');
  await page.locator('#stopBtn').click();
  await expect(page.locator('.dash-bubble-fermato')).toHaveCount(1, { timeout: 5_000 });
  await page.waitForTimeout(800);
  expect(await chiamate(app)).toBe(2);
  expect(testoDellaChiamata(await ultimaChiamata(app))).not.toContain('questo no');
  await ripristina(app);
});

test('C — la conferma che si apre da sola non si chiude per un clic fuori mentre compare; Esc e Annulla restano subito', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await copione(app, [
    { pensa: ['Imposto lo stile. '], ogni: 100, dopoStrumenti: 100, strumenti: [{ id: 'c1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'stile_agente', valore: 'Rispondi in breve.' }) }] },
    { pensa: ['Chiedo conferma. '], ogni: 100, testo: 'Ti chiedo conferma.' },
  ]);
  await page.locator('#input').fill('rispondimi in breve da ora in poi');
  await page.locator('#input').press('Enter');
  // Il clic che l'utente aveva già in corso cade sullo sfondo nell'istante in cui il riquadro compare.
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  await page.mouse.click(8, 8);
  await page.waitForTimeout(150);
  await page.mouse.click(8, 8);
  await expect(page.locator(CONFIRM_HOST)).toBeVisible();
  expect((await confirmState(page)).text).toContain('Rispondi in breve.');
  // Esc chiude subito.
  await page.keyboard.press('Escape');
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);

  // Il doppio clic sul pulsante in chat: il primo apre, il secondo cade sullo sfondo e non annulla.
  const btn = page.locator('.dash-bubble-filo .dash-action-btn-primary').first();
  await expect(btn).toBeVisible();
  await btn.dblclick();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible();
  await page.waitForTimeout(700);
  await expect(page.locator(CONFIRM_HOST)).toBeVisible();
  // Passata la frazione di secondo, il clic fuori annulla come sempre.
  await aspettaConfermaPronta(page);
  await page.mouse.click(8, 8);
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);
  // E Annulla, appena aperto, chiude subito.
  await btn.click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible();
  expect(await page.evaluate(() => window.SN_CONFIRM_UI._test.click('cancel'))).toBe(true);
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);
  expect(await app.evaluate(async () => (await globalThis.SN_FILO_MEMORY.getMemory())?.stileAgente || '')).not.toContain('Rispondi in breve.');
  await ripristina(app);
});

test('D — fermato prima del primo pensiero: la punta del filo tagliato non copre la riga sotto', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  // Un modello che non mostra il ragionamento: niente trama, solo l'attesa.
  await copione(app, [{ prima: 30_000, testo: 'Mai.' }]);
  await page.locator('#input').fill('una domanda');
  await page.locator('#sendBtn').click();
  await quadratoPronto(page);
  await page.locator('#stopBtn').click();
  const nota = page.locator('.dash-bubble-fermato');
  await expect(nota).toHaveText('Fermato prima della risposta.', { timeout: 5_000 });
  await page.waitForTimeout(800);
  const misure = await page.evaluate(() => {
    const blocco = document.querySelector('.dash-activity[data-fermato="1"]');
    const tratto = blocco.querySelector('.dash-activity-filo-tratto');
    const svg = tratto.ownerSVGElement.getBoundingClientRect();
    const bb = tratto.getBBox();
    const r = document.querySelector('.dash-bubble-fermato').getBoundingClientRect();
    return { punta: svg.top + bb.y + bb.height, sinistraPunta: svg.left + bb.x, destraPunta: svg.left + bb.x + bb.width, nota: r.top, notaSinistra: r.left, fondoBlocco: blocco.getBoundingClientRect().bottom };
  });
  await page.screenshot({ path: 'tests/.shots/secondo-gesto-fermato-senza-pensiero.png' });
  expect(misure.punta, JSON.stringify(misure)).toBeLessThanOrEqual(misure.fondoBlocco + 0.5);
  expect(misure.punta, JSON.stringify(misure)).toBeLessThanOrEqual(misure.nota);
  await ripristina(app);
});

test('F — dopo uno stop durante un\'azione lenta una conversazione nuova risponde subito', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await ricercaLenta(app);
  await copione(app, [
    { pensa: ['Cerco gli orari. '], ogni: 100, dopoStrumenti: 100, strumenti: [{ id: 'f1', name: 'CERCA_WEB', arguments: '{"query":"orari treni"}' }] },
    { pensa: ['Altro argomento. '], ogni: 100, testo: 'Sono le dieci.' },
  ]);
  await page.locator('#input').fill('orari treni');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-activity-seg-head').first()).toHaveText(/Cerco sul web/, { timeout: 5_000 });
  await ricercaPartita(app);
  await quadratoPronto(page);
  await page.locator('#stopBtn').click();
  await expect(page.locator('#sendBtn')).toHaveAttribute('aria-label', 'Riprendi', { timeout: 5_000 });
  // Una conversazione nuova: la risposta arriva con la ricerca vecchia ancora in volo.
  await page.locator('#input').fill('/clear');
  await page.locator('#input').press('Enter');
  await page.locator('#input').fill('che ore sono?');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Sono le dieci.' })).toBeVisible({ timeout: 5_000 });
  expect(await app.evaluate(() => globalThis.__ricercheFinite)).toBe(0);
  // L'altra non sa niente della ricerca fermata della prima.
  expect(testoDellaChiamata(await ultimaChiamata(app))).not.toContain('ERANO GIÀ STATE FATTE');
  await lasciaLaRicerca(app);
  await expect(page.locator('.dash-activity').first().locator('.dash-activity-seg-head').first()).toHaveText(/Cercato sul web/, { timeout: 5_000 });
  await ripristina(app);
});

test.describe(() => {
  test.use({ accoglienzaFatta: false });

  test('E — accoglienza fermata durante un\'azione lenta: ricaricare subito o aprire una scheda non rifà il turno', async ({ app, shell }) => {
    test.setTimeout(90_000);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await newtabPage(app);
    await configureModel(app);
    await ricercaLenta(app);
    await copione(app, [
      { pensa: ['Cerco qualcosa su Luca. '], ogni: 100, dopoStrumenti: 100, strumenti: [{ id: 'e1', name: 'CERCA_WEB', arguments: '{"query":"Luca"}' }] },
      { pensa: ['Rispondo. '], ogni: 100, testo: 'Piacere Luca, non dovevi leggermi.' },
    ]);
    await page.reload();
    await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });
    await page.locator('#input').fill('mi chiamo Luca');
    await page.locator('#input').press('Enter');
    await expect(page.locator('.dash-activity-seg-head').last()).toHaveText(/Cerco sul web/, { timeout: 6_000 });
    await ricercaPartita(app);
    await quadratoPronto(page);
    await page.locator('#stopBtn').click();
    await expect(page.locator('#sendBtn')).toHaveAttribute('aria-label', 'Riprendi', { timeout: 3_000 });
    // Subito, con la ricerca ancora in volo: lo stop è già scritto.
    expect(await app.evaluate(async () => (await globalThis.SN_FILO_MEMORY.getOnboarding()).fermato)).toBe(true);
    await page.reload();
    await expect(page.locator('.dash-bubble-fermato')).toHaveText('Fermato prima della risposta.', { timeout: 15_000 });
    await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
    await expect.poll(() => app.windows().filter((w) => w.url().startsWith('filo://newtab')).length, { timeout: 10_000 }).toBe(2);
    const nuova = app.windows().find((w) => w.url().startsWith('filo://newtab') && w !== page);
    await expect(nuova.locator('.dash-bubble-fermato')).toHaveText('Fermato prima della risposta.', { timeout: 8_000 });
    await lasciaLaRicerca(app);
    await page.waitForTimeout(2_000);
    expect(await chiamate(app)).toBe(1);
    await expect(page.locator('.dash-bubble-filo', { hasText: 'non dovevi leggermi' })).toHaveCount(0);
    await expect(page.locator('#sendBtn')).toHaveAttribute('aria-label', 'Riprendi');
    await ripristina(app);
  });

  test('E2 — accoglienza fermata mentre Filo prepara la richiesta: ricaricare subito non la fa partire', async ({ app, shell }) => {
    test.setTimeout(90_000);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await newtabPage(app);
    await configureModel(app);
    await copione(app, [{ pensa: ['Rispondo. '], ogni: 100, testo: 'Piacere Luca, non dovevi leggermi.' }]);
    await page.reload();
    await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });
    // Prima del modello si leggono saldo, batteria e rete: qui tre secondi.
    await app.evaluate(() => {
      const S = globalThis.SN_SISTEMA_MAIN;
      const orig = S && S.statoPerChat;
      globalThis.__statoOrig = orig;
      const lento = async (...a) => { await new Promise((ok) => setTimeout(ok, 3_000)); return orig ? orig.apply(S, a) : null; };
      if (S) S.statoPerChat = lento; else globalThis.SN_SISTEMA_MAIN = { statoPerChat: lento };
    });
    await page.locator('#input').fill('mi chiamo Luca');
    await page.locator('#input').press('Enter');
    await quadratoPronto(page);
    await page.locator('#stopBtn').click();
    await expect(page.locator('#sendBtn')).toHaveAttribute('aria-label', 'Riprendi', { timeout: 3_000 });
    await expect.poll(() => app.evaluate(async () => (await globalThis.SN_FILO_MEMORY.getOnboarding()).fermato), { timeout: 1_000 }).toBe(true);
    await page.reload();
    await expect(page.locator('.dash-bubble-fermato')).toHaveText('Fermato prima della risposta.', { timeout: 15_000 });
    await page.waitForTimeout(4_000);
    expect(await chiamate(app)).toBe(0);
    await expect(page.locator('.dash-bubble-filo', { hasText: 'non dovevi leggermi' })).toHaveCount(0);
    await app.evaluate(() => { if (globalThis.SN_SISTEMA_MAIN && globalThis.__statoOrig) globalThis.SN_SISTEMA_MAIN.statoPerChat = globalThis.__statoOrig; });
    await ripristina(app);
  });
});
