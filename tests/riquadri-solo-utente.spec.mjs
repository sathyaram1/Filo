// #1071 — Riquadri di Filo dentro un sito: la bozza del feedback iniziata su un sito tornava nella casella dentro un
// altro sito, che la leggeva; e lo script del sito premeva Invia (feedback, attacco red-team) o l'invio della domanda
// (spiegazione, Modifica) facendo spendere una chiamata o dei crediti. Regola: patterns/un-pezzo-di-filo-in-un-sito-ubbidisce-solo-all-utente.md.

import { test, expect } from './fixtures/electron.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { nelMondoDiFilo, statoDi, conta, clicca, scrivi } from './helpers/riquadri.mjs';
import { cartellaTemporanea, togliCartella } from './helpers/percorsi.mjs';

const SEGRETO = 'bozza-segreta-1071 del mio conto';
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// Lo script del sito: guarda tutto ciò che entra nel suo documento e prova a premere e riempire i riquadri di Filo.
const ATTACCO = `<script>
  window.__visti = [];
  new MutationObserver((ms) => {
    for (const m of ms) for (const n of m.addedNodes) window.__visti.push(n.outerHTML || n.textContent || '');
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  window.cosaVede = () => document.documentElement.outerHTML + ' ' + window.__visti.join(' ');
  window.attacca = () => {
    const host = document.querySelector('[data-sn-riquadro]');
    const bersagli = [host, document.activeElement, ...document.querySelectorAll('button, textarea, input')].filter(Boolean);
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'finto.png', { type: 'image/png' });
    for (const el of bersagli) {
      if (el.matches && el.matches('textarea, input') && el.id !== 'campo') el.value = 'scritto dal sito';
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, composed: true }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        el.dispatchEvent(new DragEvent('drop', { bubbles: true, composed: true, dataTransfer: dt }));
        el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, composed: true, clipboardData: dt }));
      } catch (_) {}
    }
    for (const b of document.querySelectorAll('.sn-fb-send, .sn-popup-send, .sn-editbox-replace, [data-sc], .sn-rt-send')) b.click();
    const nostri = '[class*="sn-fb-"], [class*="sn-popup"], [class*="sn-editbox"], [class*="sn-rt-"]';
    return { host: !!host, ombra: !!(host && host.shadowRoot), nostri: document.querySelectorAll(nostri).length };
  };
</script>`;

const pagina = (corpo) => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif">${corpo}${ATTACCO}</body></html>`;

const chiaveBozza = (origine) => `sn_feedback_draft_text@${origine}`;
const bozzaSalvata = (app, chiave) => app.evaluate(async (_e, k) => (await globalThis.chrome.storage.local.get([k]))[k] || '', chiave);

// Nel mondo dei content script della scheda: chi manda SUBMIT_FEEDBACK lo lascia qui, e il main non lo vede.
const spiaInvii = (app, page) => nelMondoDiFilo(app, page, () => {
  window.__inviati = [];
  const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = (m, ...r) => {
    if (m && m.type === 'submit_feedback') { window.__inviati.push(m.payload && m.payload.text); return Promise.resolve({ ok: true, id: 'prova-1071' }); }
    return orig(m, ...r);
  };
  return true;
});
const inviati = (app, page) => nelMondoDiFilo(app, page, () => window.__inviati.slice());

test('la bozza del feedback resta sul sito dove è nata: un altro sito non la riceve, non la legge e non invia per l\'utente', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const a = await testServer.openReady(openTab, pagina('<p>Sito A</p>'));
  await nelMondoDiFilo(app, a, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, a, '.sn-fb-text')).not.toBeNull();
  await scrivi(app, a, '.sn-fb-text', SEGRETO);
  await expect.poll(() => bozzaSalvata(app, chiaveBozza(testServer.origin))).toBe(SEGRETO);
  // Anche il sito dove la si scrive vede solo un host vuoto.
  const vistoDaA = await a.evaluate(() => window.cosaVede());
  expect(vistoDaA).not.toContain('sn-fb-text');
  await a.keyboard.press('Escape');
  await expect.poll(() => conta(app, a, '.sn-fb-modal')).toBe(0);

  const b = await testServer.openReady(openTab, pagina('<p>Sito B</p>'), { pubblico: true });
  await spiaInvii(app, b);
  await nelMondoDiFilo(app, b, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, b, '.sn-fb-text')).not.toBeNull();
  await b.waitForTimeout(600);
  expect((await statoDi(app, b, '.sn-fb-text')).valore, 'la bozza di A non torna nella casella di B').toBe('');
  // Nemmeno il codice di Filo dentro B la può chiedere: il main la dà solo al sito che l'ha scritta.
  const chiesta = await nelMondoDiFilo(app, b, async (k) => JSON.stringify(await chrome.storage.local.get([k])), chiaveBozza(testServer.origin));
  expect(chiesta).toBe('{}');
  const vistoDaB = await b.evaluate((s) => ({ html: window.cosaVede(), trovato: window.find(s) }), SEGRETO);
  expect(vistoDaB.html).not.toContain(SEGRETO);
  expect(vistoDaB.trovato, 'la ricerca del browser non trova la bozza di A dentro B').toBe(false);

  // L'utente scrive su B; lo script di B preme, trascina e incolla da sé: niente parte e niente si allega.
  await scrivi(app, b, '.sn-fb-text', 'Su B il tasto indietro non va');
  const esito = await b.evaluate(() => window.attacca());
  expect(esito).toEqual({ host: true, ombra: false, nostri: 0 });
  await b.waitForTimeout(800);
  expect(await inviati(app, b)).toEqual([]);
  expect(await conta(app, b, '.sn-fb-modal')).toBe(1);
  expect(await conta(app, b, '.sn-fb-thumb, .sn-fb-file-chip')).toBe(0);

  // L'utente allega dal suo selettore: l'immagine entra. Un file su disco, come lo sceglie lui: coi byte in memoria
  // Playwright fabbrica l'evento del campo, e il riquadro non lo ascolta.
  const cartella = cartellaTemporanea('filo-1071-');
  const foto = join(cartella, 'schermata.png');
  writeFileSync(foto, Buffer.from(PNG_1X1, 'base64'));
  const [selettore] = await Promise.all([b.waitForEvent('filechooser'), clicca(app, b, '.sn-fb-attach')]);
  await selettore.setFiles(foto);
  await expect.poll(() => conta(app, b, '.sn-fb-thumb')).toBe(1);

  // Il clic vero dell'utente invia.
  await clicca(app, b, '.sn-fb-send');
  await expect.poll(() => inviati(app, b)).toEqual(['Su B il tasto indietro non va']);

  togliCartella(cartella);

  // Tornato su A, la sua bozza è lì.
  await nelMondoDiFilo(app, a, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(async () => (await statoDi(app, a, '.sn-fb-text'))?.valore).toBe(SEGRETO);
});

test('nel riquadro del feedback su un sito: Ctrl+Z annulla invece di tornare indietro, e Incolla dal tasto destro scrive e salva', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const prima = testServer.html(pagina('<p>Pagina di prima</p>'));
  const page = await openTab(prima);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  const dopo = testServer.html(pagina('<p>Pagina di adesso</p>'));
  await page.goto(dopo);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, page, '.sn-fb-text')).not.toBeNull();
  await scrivi(app, page, '.sn-fb-text', 'abc');
  await page.keyboard.press('Control+Z');
  await page.waitForTimeout(800);
  expect(page.url(), 'Ctrl+Z dentro la casella del feedback non porta via la pagina').toBe(dopo);
  expect(await conta(app, page, '.sn-fb-modal')).toBe(1);

  await app.evaluate(({ clipboard }) => clipboard.writeText('dagli appunti 1071'));
  const campo = await statoDi(app, page, '.sn-fb-text');
  await page.mouse.click(campo.x + 20, campo.y + 15, { button: 'right' });
  await expect(page.locator('.sn-menu .sn-menu-paste-main').first()).toBeVisible({ timeout: 8000 });
  await page.locator('.sn-menu .sn-menu-paste-main').first().click();
  await expect.poll(async () => (await statoDi(app, page, '.sn-fb-text'))?.valore).toContain('dagli appunti 1071');
  // L'Incolla di Filo lo sente anche il riquadro, chiuso ai gesti finti: la bozza lo salva.
  await expect.poll(() => bozzaSalvata(app, chiaveBozza(testServer.origin))).toContain('dagli appunti 1071');
});

// Provider finto nel main: conta le chiamate al modello, risponde subito.
async function contaChiamate(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash', [C.ACTIONS.EDIT_TEXT]: 'deepseek-flash', [C.ACTIONS.FOLLOWUP || 'followup']: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__chiamate1071 = 0;
    globalThis.__domande1071 = 0;
    const orig = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...orig,
      complete: async () => { globalThis.__chiamate1071++; return { text: 'TESTO RISCRITTO 1071', usage: {} }; },
      streamComplete: async ({ onDelta }) => { globalThis.__chiamate1071++; globalThis.__domande1071++; onDelta('Risposta del modello.'); return { text: 'Risposta del modello.', usage: {} }; },
    };
  });
}
const chiamate = (app) => app.evaluate(() => globalThis.__chiamate1071);
// Le risposte in streaming: spiegazione e domande. Il correttore, che lavora anche nella casella della domanda, no.
const domande = (app) => app.evaluate(() => globalThis.__domande1071);

test('spiegazione su un sito: lo script del sito non manda domande, la domanda dell\'utente parte', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await contaChiamate(app);
  const page = await testServer.openReady(openTab, pagina('<p id="parola" style="font-size:20px">supercalifragilistico</p>'));
  await page.locator('#parola').dblclick();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('explain-selection', win);
  });
  await expect.poll(async () => (await statoDi(app, page, '.sn-popup-body'))?.testo || '', { timeout: 15_000 }).toContain('Risposta del modello');
  await expect.poll(() => domande(app)).toBe(1);
  expect(await page.evaluate(() => window.cosaVede())).not.toContain('Risposta del modello');

  // Lo script del sito riempie e preme: nessuna chiamata in più.
  const esito = await page.evaluate(() => window.attacca());
  expect(esito).toEqual({ host: true, ombra: false, nostri: 0 });
  await page.waitForTimeout(800);
  expect(await domande(app)).toBe(1);

  // L'utente scrive la domanda e preme Invio: parte.
  await scrivi(app, page, '.sn-popup-input', 'e in breve?');
  await page.keyboard.press('Enter');
  await expect.poll(() => domande(app)).toBe(2);
});

test('Modifica su un sito: lo script del sito non fa riscrivere né sostituire, l\'utente sì', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await contaChiamate(app);
  const page = await testServer.openReady(openTab, pagina('<textarea id="campo" style="width:400px;height:80px">Un testo con un erore.</textarea>'));
  await page.locator('#campo').click();
  await page.evaluate(() => { const t = document.querySelector('#campo'); t.focus(); t.select(); });
  await page.locator('#campo').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible({ timeout: 10_000 });
  await page.locator('.sn-menu .sn-menu-item', { hasText: 'Modifica' }).click();
  await expect.poll(() => statoDi(app, page, '.sn-editbox')).not.toBeNull();
  // Il tasto destro sulla selezione prepara già la sua spiegazione: si contano le chiamate da qui.
  await page.waitForTimeout(1500);
  const prima = await chiamate(app);

  const esito = await page.evaluate(() => window.attacca());
  expect(esito).toEqual({ host: true, ombra: false, nostri: 0 });
  await page.waitForTimeout(800);
  expect(await chiamate(app)).toBe(prima);

  await clicca(app, page, 'button[data-sc="fix"]');
  await expect.poll(async () => (await statoDi(app, page, '.sn-editbox-proposed'))?.testo || '').toContain('RISCRITTO');
  expect(await chiamate(app)).toBe(prima + 1);
  // Lo script del sito preme Sostituisci: il campo resta com'era.
  await page.evaluate(() => window.attacca());
  await page.waitForTimeout(400);
  await expect(page.locator('#campo')).toHaveValue('Un testo con un erore.');
  await clicca(app, page, '.sn-editbox-replace');
  await expect(page.locator('#campo')).toHaveValue('TESTO RISCRITTO 1071');
});

test('attacco red-team su un sito: lo script del sito non lo manda e non legge la bozza di un altro sito', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const a = await testServer.openReady(openTab, pagina('<p>Sito A</p>'));
  await nelMondoDiFilo(app, a, () => globalThis.SN_REDTEAM_ATTACK_UI.open());
  await expect.poll(() => statoDi(app, a, '.sn-rt-attack')).not.toBeNull();
  await scrivi(app, a, '.sn-rt-attack', SEGRETO);
  await expect.poll(() => bozzaSalvata(app, `sn_redteam_attack_draft@${testServer.origin}`)).toBe(SEGRETO);
  await nelMondoDiFilo(app, a, () => globalThis.SN_REDTEAM_ATTACK_UI.close());

  const b = await testServer.openReady(openTab, pagina('<p>Sito B</p>'), { pubblico: true });
  // Un utente con l'accesso e crediti: l'invio costerebbe davvero.
  await nelMondoDiFilo(app, b, () => {
    window.__rt = [];
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (m, ...r) => {
      if (m && m.type === 'auth_status') return Promise.resolve({ ok: true, signedIn: true });
      if (m && m.type === 'get_credits') return Promise.resolve({ ok: true, credits: 500 });
      if (m && m.type === 'redteam_submit') { window.__rt.push(m.attackText); return Promise.resolve({ status: 'error' }); }
      return orig(m, ...r);
    };
    return true;
  });
  await nelMondoDiFilo(app, b, () => globalThis.SN_REDTEAM_ATTACK_UI.open());
  await expect.poll(() => statoDi(app, b, '.sn-rt-attack')).not.toBeNull();
  await b.waitForTimeout(600);
  expect((await statoDi(app, b, '.sn-rt-attack')).valore, 'la bozza di A non torna su B').toBe('');
  await scrivi(app, b, '.sn-rt-attack', 'attacco scritto su B');
  await expect.poll(async () => (await statoDi(app, b, '.sn-rt-send'))?.disabilitato).toBe(false);
  const esito = await b.evaluate(() => window.attacca());
  expect(esito).toEqual({ host: true, ombra: false, nostri: 0 });
  await b.waitForTimeout(800);
  expect(await nelMondoDiFilo(app, b, () => window.__rt.slice())).toEqual([]);
  await clicca(app, b, '.sn-rt-send');
  await expect.poll(() => nelMondoDiFilo(app, b, () => window.__rt.slice())).toEqual(['attacco scritto su B']);
});

// Gli aiuti di Filo per scrivere lavorano anche dentro i riquadri chiusi: il correttore si aggancia alla casella e
// il suo strato, che ripete il testo, sta nel riquadro e non nel documento del sito.
test('nei riquadri su un sito la correzione automatica lavora, e il testo ripetuto dal correttore non entra nel sito', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await contaChiamate(app);
  await app.evaluate(async () => { await globalThis.chrome.storage.local.set({ sn_autocorrect: { perchè: 'perché' } }); });
  const page = await testServer.openReady(openTab, pagina('<p id="parola" style="font-size:20px">supercalifragilistico</p>'));

  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, page, '.sn-fb-text')).not.toBeNull();
  await clicca(app, page, '.sn-fb-text');
  await page.keyboard.type('perchè ', { delay: 30 });
  await expect.poll(async () => (await statoDi(app, page, '.sn-fb-text'))?.valore).toBe('perché ');
  await page.keyboard.type('la frase segreta del feedback', { delay: 5 });
  await expect.poll(() => conta(app, page, '.sn-spell-overlay')).toBe(1);
  expect(await page.evaluate(() => window.cosaVede())).not.toContain('frase segreta');
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.close());

  await page.locator('#parola').dblclick();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('explain-selection', win);
  });
  await expect.poll(async () => (await statoDi(app, page, '.sn-popup-body'))?.testo || '', { timeout: 15_000 }).toContain('Risposta del modello');
  await clicca(app, page, '.sn-popup-input');
  await page.keyboard.type('perchè ', { delay: 30 });
  await expect.poll(async () => (await statoDi(app, page, '.sn-popup-input'))?.valore).toBe('perché ');
});

test('Modifica dentro la casella del feedback su un sito: Sostituisci arriva alla bozza, e il suggerimento dell\'istruzione è intero', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await contaChiamate(app);
  const page = await testServer.openReady(openTab, pagina('<p>Sito</p>'));
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, page, '.sn-fb-text')).not.toBeNull();
  const campo = await statoDi(app, page, '.sn-fb-text');
  await scrivi(app, page, '.sn-fb-text', 'testo con erore');
  await page.keyboard.press('Control+A');
  await page.mouse.click(campo.x + 30, campo.y + 12, { button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible({ timeout: 10_000 });
  await page.locator('.sn-menu .sn-menu-item', { hasText: 'Modifica' }).click();
  await expect.poll(() => statoDi(app, page, '.sn-editbox')).not.toBeNull();
  const segnaposto = await nelMondoDiFilo(app, page, () => globalThis.SN_FILO_UI._test.trova('.sn-editbox-instruction').placeholder);
  expect(segnaposto).toContain('"rendi più formale"');
  await clicca(app, page, 'button[data-sc="fix"]');
  await expect.poll(async () => (await statoDi(app, page, '.sn-editbox-proposed'))?.testo || '').toContain('RISCRITTO');
  await clicca(app, page, '.sn-editbox-replace');
  await expect.poll(async () => (await statoDi(app, page, '.sn-fb-text'))?.valore).toBe('TESTO RISCRITTO 1071');
  await expect.poll(() => bozzaSalvata(app, chiaveBozza(testServer.origin))).toBe('TESTO RISCRITTO 1071');
});
