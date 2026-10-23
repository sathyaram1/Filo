// #1071 — Riquadri di Filo sopra un sito: la bozza del feedback iniziata su un sito tornava nella casella dentro un
// altro sito, che la leggeva; e lo script del sito premeva Invia (feedback, attacco red-team) o l'invio della domanda
// (spiegazione, Modifica) facendo spendere una chiamata o dei crediti. Dal #1509.1 i riquadri stanno nello strato sopra
// la scheda: il sito non ne vede nemmeno l'host. Regola: patterns/i-riquadri-di-filo-su-un-sito-stanno-sopra-la-scheda.md.

import { test, expect } from './fixtures/electron.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { nelMondoDiFilo, neiRiquadri, nelloStrato, statoDi, conta, clicca, scrivi, paginaDelloStrato, tastoSullaScheda } from './helpers/riquadri.mjs';
import { cartellaTemporanea, togliCartella } from './helpers/percorsi.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

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

// Dove vive il riquadro (lo strato sopra il sito): chi manda SUBMIT_FEEDBACK lo lascia qui, e il main non lo vede.
// Si mette a riquadro aperto, perché lo strato nasce con lui.
const spiaInvii = (app, page) => neiRiquadri(app, page, () => {
  window.__inviati = [];
  const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = (m, ...r) => {
    if (m && m.type === 'submit_feedback') { window.__inviati.push(m.payload && m.payload.text); return Promise.resolve({ ok: true, id: 'prova-1071' }); }
    return orig(m, ...r);
  };
  return true;
});
const inviati = (app, page) => neiRiquadri(app, page, () => window.__inviati.slice());

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
  await tastoSullaScheda(app, a, 'Escape');
  await expect.poll(() => conta(app, a, '.sn-fb-modal')).toBe(0);

  const b = await testServer.openReady(openTab, pagina('<p>Sito B</p>'), { pubblico: true });
  await nelMondoDiFilo(app, b, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, b, '.sn-fb-text')).not.toBeNull();
  await spiaInvii(app, b);
  await b.waitForTimeout(600);
  expect((await statoDi(app, b, '.sn-fb-text')).valore, 'la bozza di A non torna nella casella di B').toBe('');
  // Nemmeno il codice di Filo dentro B la può chiedere: il main la dà solo al sito che l'ha scritta.
  const chiesta = await nelMondoDiFilo(app, b, async (k) => JSON.stringify(await chrome.storage.local.get([k])), chiaveBozza(testServer.origin));
  expect(chiesta).toBe('{}');
  // Nemmeno lo strato sopra B, che parla come B.
  expect(await nelloStrato(app, b, async (k) => JSON.stringify(await chrome.storage.local.get([k])), chiaveBozza(testServer.origin))).toBe('{}');
  const vistoDaB = await b.evaluate((s) => ({ html: window.cosaVede(), trovato: window.find(s) }), SEGRETO);
  expect(vistoDaB.html).not.toContain(SEGRETO);
  expect(vistoDaB.trovato, 'la ricerca del browser non trova la bozza di A dentro B').toBe(false);

  // L'utente scrive su B; lo script di B preme, trascina e incolla da sé: niente parte e niente si allega.
  await scrivi(app, b, '.sn-fb-text', 'Su B il tasto indietro non va');
  const esito = await b.evaluate(() => window.attacca());
  expect(esito).toEqual({ host: false, ombra: false, nostri: 0 });
  await b.waitForTimeout(800);
  expect(await inviati(app, b)).toEqual([]);
  expect(await conta(app, b, '.sn-fb-modal')).toBe(1);
  expect(await conta(app, b, '.sn-fb-thumb, .sn-fb-file-chip')).toBe(0);

  // L'utente allega dal suo selettore: l'immagine entra. Un file su disco, come lo sceglie lui: coi byte in memoria
  // Playwright fabbrica l'evento del campo, e il riquadro non lo ascolta.
  const cartella = cartellaTemporanea('filo-1071-');
  const foto = join(cartella, 'schermata.png');
  writeFileSync(foto, Buffer.from(PNG_1X1, 'base64'));
  const strato = await paginaDelloStrato(app, b);
  const [selettore] = await Promise.all([strato.waitForEvent('filechooser'), clicca(app, b, '.sn-fb-attach')]);
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
  const dove = await scrivi(app, page, '.sn-fb-text', 'abc');
  await dove.keyboard.press('Control+Z');
  await page.waitForTimeout(800);
  expect(page.url(), 'Ctrl+Z dentro la casella del feedback non porta via la pagina').toBe(dopo);
  expect(await conta(app, page, '.sn-fb-modal')).toBe(1);

  await app.evaluate(({ clipboard }) => clipboard.writeText('dagli appunti 1071'));
  const campo = await statoDi(app, page, '.sn-fb-text');
  await dove.mouse.click(campo.x + 20, campo.y + 15, { button: 'right' });
  await expect(menuDi(dove).locator('.sn-menu .sn-menu-paste-main').first()).toBeVisible({ timeout: 8000 });
  await menuDi(dove).locator('.sn-menu .sn-menu-paste-main').first().click();
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
// Il conto quando smette di muoversi: il correttore della casella della pagina, che col fuoco nello strato resta
// agganciata, finisce il suo controllo di quello che c'era già scritto (dopo la sua pausa, 3,5 s).
async function chiamateFerme(app) {
  let prima = -1;
  let ora = await chiamate(app);
  while (ora !== prima) {
    await new Promise((r) => setTimeout(r, 4000));
    prima = ora;
    ora = await chiamate(app);
  }
  return ora;
}
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
  expect(esito).toEqual({ host: false, ombra: false, nostri: 0 });
  await page.waitForTimeout(800);
  expect(await domande(app)).toBe(1);

  // L'utente scrive la domanda e preme Invio: parte.
  const dove = await scrivi(app, page, '.sn-popup-input', 'e in breve?');
  await dove.keyboard.press('Enter');
  await expect.poll(() => domande(app)).toBe(2);
});

test('Modifica su un sito: lo script del sito non fa riscrivere né sostituire, l\'utente sì', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await contaChiamate(app);
  const page = await testServer.openReady(openTab, pagina('<textarea id="campo" style="width:400px;height:80px">Un testo con un erore.</textarea>'));
  await page.locator('#campo').click();
  await page.evaluate(() => { const t = document.querySelector('#campo'); t.focus(); t.select(); });
  await page.locator('#campo').click({ button: 'right' });
  await expect(menuDi(page).locator('.sn-menu')).toBeVisible({ timeout: 10_000 });
  await menuDi(page).locator('.sn-menu .sn-menu-item', { hasText: 'Modifica' }).click();
  await expect.poll(() => statoDi(app, page, '.sn-editbox')).not.toBeNull();
  // Il tasto destro sulla selezione prepara già la sua spiegazione: si contano le chiamate da qui.
  const prima = await chiamateFerme(app);

  const esito = await page.evaluate(() => window.attacca());
  expect(esito).toEqual({ host: false, ombra: false, nostri: 0 });
  await page.waitForTimeout(800);
  expect(await chiamate(app)).toBe(prima);

  await clicca(app, page, 'button[data-sc="fix"]');
  await expect.poll(async () => (await statoDi(app, page, '.sn-editbox-proposed'))?.testo || '').toContain('RISCRITTO');
  expect(await chiamate(app)).toBe(prima + 1);
  // Lo script del sito preme Sostituisci: nel campo non arriva la riscrittura.
  await page.evaluate(() => window.attacca());
  await page.waitForTimeout(400);
  expect(await page.locator('#campo').inputValue()).not.toContain('RISCRITTO');
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
  await neiRiquadri(app, a, () => globalThis.SN_REDTEAM_ATTACK_UI.close());

  const b = await testServer.openReady(openTab, pagina('<p>Sito B</p>'), { pubblico: true });
  await nelMondoDiFilo(app, b, () => globalThis.SN_REDTEAM_ATTACK_UI.open());
  await expect.poll(() => statoDi(app, b, '.sn-rt-attack')).not.toBeNull();
  await neiRiquadri(app, b, () => globalThis.SN_REDTEAM_ATTACK_UI.close());
  // Un utente con l'accesso e crediti: l'invio costerebbe davvero. La spia sta nello strato, dove gira il pannello.
  await neiRiquadri(app, b, () => {
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
  expect(esito).toEqual({ host: false, ombra: false, nostri: 0 });
  await b.waitForTimeout(800);
  expect(await neiRiquadri(app, b, () => window.__rt.slice())).toEqual([]);
  await clicca(app, b, '.sn-rt-send');
  await expect.poll(() => neiRiquadri(app, b, () => window.__rt.slice())).toEqual(['attacco scritto su B']);
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
  const dove = await clicca(app, page, '.sn-fb-text');
  await dove.keyboard.type('perchè ', { delay: 30 });
  await expect.poll(async () => (await statoDi(app, page, '.sn-fb-text'))?.valore).toBe('perché ');
  await dove.keyboard.type('la frase segreta del feedback', { delay: 5 });
  await expect.poll(() => conta(app, page, '.sn-spell-overlay')).toBe(1);
  expect(await page.evaluate(() => window.cosaVede())).not.toContain('frase segreta');
  await neiRiquadri(app, page, () => globalThis.SN_FEEDBACK_UI.close());

  await page.locator('#parola').dblclick();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('explain-selection', win);
  });
  await expect.poll(async () => (await statoDi(app, page, '.sn-popup-body'))?.testo || '', { timeout: 15_000 }).toContain('Risposta del modello');
  await clicca(app, page, '.sn-popup-input');
  await dove.keyboard.type('perchè ', { delay: 30 });
  await expect.poll(async () => (await statoDi(app, page, '.sn-popup-input'))?.valore).toBe('perché ');
});

test('Modifica dentro la casella del feedback su un sito: Sostituisci arriva alla bozza, e il suggerimento dell\'istruzione è intero', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await contaChiamate(app);
  const page = await testServer.openReady(openTab, pagina('<p>Sito</p>'));
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, page, '.sn-fb-text')).not.toBeNull();
  const campo = await statoDi(app, page, '.sn-fb-text');
  const dove = await scrivi(app, page, '.sn-fb-text', 'testo con erore');
  await dove.keyboard.press('Control+A');
  await dove.mouse.click(campo.x + 30, campo.y + 12, { button: 'right' });
  await expect(menuDi(dove).locator('.sn-menu')).toBeVisible({ timeout: 10_000 });
  await menuDi(dove).locator('.sn-menu .sn-menu-item', { hasText: 'Modifica' }).click();
  await expect.poll(() => statoDi(app, page, '.sn-editbox')).not.toBeNull();
  const segnaposto = await neiRiquadri(app, page, () => globalThis.SN_FILO_UI._test.trova('.sn-editbox-instruction').placeholder);
  expect(segnaposto).toContain('"rendi più formale"');
  await clicca(app, page, 'button[data-sc="fix"]');
  await expect.poll(async () => (await statoDi(app, page, '.sn-editbox-proposed'))?.testo || '').toContain('RISCRITTO');
  await clicca(app, page, '.sn-editbox-replace');
  await expect.poll(async () => (await statoDi(app, page, '.sn-fb-text'))?.valore).toBe('TESTO RISCRITTO 1071');
  await expect.poll(() => bozzaSalvata(app, chiaveBozza(testServer.origin))).toBe('TESTO RISCRITTO 1071');
});

// Un sito con scorciatoie a un tasto ignora i tasti scritti in un suo campo; il campo di un riquadro chiuso, da fuori,
// non sembra un campo: i tasti non devono arrivare ai suoi gestori, o «k» mette in pausa e «/» porta via il cursore.
const SCORCIATOIE = `<script>
  window.__comandi = [];
  const cerca = () => document.querySelector('#cerca') || document.body.appendChild(Object.assign(document.createElement('input'), { id: 'cerca' }));
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (e.key === 'k') { e.preventDefault(); window.__comandi.push('pausa'); }
    if (e.key === '/') { e.preventDefault(); cerca().focus(); }
  });
  // Chi ascolta prima della casella, sul documento o sulla finestra: vede solo l'host del riquadro.
  for (const dove of [document, window]) {
    dove.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === 'k' || e.key === ' ') { e.preventDefault(); window.__comandi.push('in cattura ' + e.key); }
    }, true);
  }
</script>`;

test('nei riquadri su un sito con scorciatoie da tastiera quello che l\'utente scrive resta nella casella', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await contaChiamate(app);
  const page = await testServer.openReady(openTab, pagina(`<p id="parola" style="font-size:20px">supercalifragilistico</p>${SCORCIATOIE}`));
  const sitoFermo = async () => {
    expect(await page.evaluate(() => window.__comandi), 'il sito non prende i tasti come comandi').toEqual([]);
    expect(await page.evaluate(() => (document.querySelector('#cerca') || {}).value || ''), 'il testo non finisce nel sito').toBe('');
  };

  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, page, '.sn-fb-text')).not.toBeNull();
  const dove = await clicca(app, page, '.sn-fb-text');
  await dove.keyboard.type('ok kiwi / poi', { delay: 20 });
  expect((await statoDi(app, page, '.sn-fb-text')).valore).toBe('ok kiwi / poi');
  await sitoFermo();
  await dove.keyboard.press('Escape');
  await expect.poll(() => conta(app, page, '.sn-fb-modal')).toBe(0);

  await page.locator('#parola').dblclick();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('explain-selection', win);
  });
  await expect.poll(async () => (await statoDi(app, page, '.sn-popup-body'))?.testo || '', { timeout: 15_000 }).toContain('Risposta del modello');
  await clicca(app, page, '.sn-popup-input');
  await dove.keyboard.type('e kiwi / poi', { delay: 20 });
  expect((await statoDi(app, page, '.sn-popup-input')).valore).toBe('e kiwi / poi');
  await sitoFermo();
  await dove.keyboard.press('Escape');
  await expect.poll(() => conta(app, page, '.sn-popup')).toBe(0);

  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<textarea id="campo">Un testo con un erore.</textarea>'));
  await page.evaluate(() => { const t = document.querySelector('#campo'); t.focus(); t.select(); });
  await page.locator('#campo').click({ button: 'right' });
  await expect(menuDi(page).locator('.sn-menu')).toBeVisible({ timeout: 10_000 });
  await menuDi(page).locator('.sn-menu .sn-menu-item', { hasText: 'Modifica' }).click();
  await expect.poll(() => statoDi(app, page, '.sn-editbox-instruction')).not.toBeNull();
  await clicca(app, page, '.sn-editbox-instruction');
  await dove.keyboard.type('ok kiwi / poi', { delay: 20 });
  expect((await statoDi(app, page, '.sn-editbox-instruction')).valore).toBe('ok kiwi / poi');
  await sitoFermo();
  // L'Invio dell'utente arriva ancora al riquadro: riscrive, e nella casella non va a capo.
  const prima = await chiamate(app);
  await dove.keyboard.press('Enter');
  await expect.poll(() => chiamate(app)).toBe(prima + 1);
  expect((await statoDi(app, page, '.sn-editbox-instruction')).valore).toBe('ok kiwi / poi');
});

test('spiegazione su un sito: il clic finto del sito non apre i collegamenti della risposta, quello dell\'utente sì', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const risposta = 'Vuol dire straordinario. Vedi [la voce](https://example.org/voce).';
  await contaChiamate(app);
  await app.evaluate(async (_e, r) => {
    const orig = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = { ...orig, streamComplete: async ({ onDelta }) => { onDelta(r); return { text: r, usage: {} }; } };
  }, risposta);
  const page = await testServer.openReady(openTab, pagina('<p id="parola" style="font-size:20px">supercalifragilistico</p>'));
  await page.locator('#parola').dblclick();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('explain-selection', win);
  });
  await expect.poll(async () => (await statoDi(app, page, '.sn-popup-body'))?.testo || '', { timeout: 15_000 }).toContain('straordinario');
  await neiRiquadri(app, page, () => {
    window.__aperti = [];
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (m, ...r) => {
      if (m && m.type === 'apri_collegamento_filo') { window.__aperti.push(m.url); return Promise.resolve({ ok: true }); }
      return orig(m, ...r);
    };
  });
  const link = await statoDi(app, page, 'a.filo-md-link');
  const punto = { x: link.x + link.width / 2, y: link.y + link.height / 2 };
  // Il sito clicca dove vede il collegamento: nel suo documento lì c'è solo la sua pagina.
  await page.evaluate((p) => {
    const sotto = document.elementFromPoint(p.x, p.y) || document.body;
    for (const tipo of ['click', 'auxclick']) {
      sotto.dispatchEvent(new MouseEvent(tipo, { bubbles: true, composed: true, cancelable: true, clientX: p.x, clientY: p.y, detail: 1, button: tipo === 'auxclick' ? 1 : 0 }));
    }
  }, punto);
  await page.waitForTimeout(500);
  expect(await neiRiquadri(app, page, () => window.__aperti), 'lo script del sito non apre il collegamento').toEqual([]);
  await (await paginaDelloStrato(app, page)).mouse.click(punto.x, punto.y);
  await expect.poll(() => neiRiquadri(app, page, () => window.__aperti)).toEqual(['https://example.org/voce']);
});

// #592.16: col riquadro aperto dall'utente e il fuoco nella sua casella, la pagina scrive e preme di continuo per tre
// secondi, con ogni strada che ha (tasti e clic fabbricati, execCommand nel campo che ha il fuoco, requestSubmit).
const MARTELLO = `<script>
  window.martella = (ms) => new Promise((fine) => {
    const stop = Date.now() + ms;
    let giri = 0;
    const giro = () => {
      giri++;
      const host = document.querySelector('[data-sn-riquadro]');
      try { document.execCommand('insertText', false, ' domanda del sito'); } catch (_) {}
      for (const el of [host, document.activeElement, ...document.querySelectorAll('button')].filter(Boolean)) {
        for (const t of ['keydown', 'keypress', 'keyup']) {
          el.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, composed: true, cancelable: true }));
        }
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, detail: 1 }));
        if (typeof el.click === 'function') el.click();
      }
      try { document.execCommand('insertParagraph'); document.execCommand('insertLineBreak'); } catch (_) {}
      for (const f of document.forms) try { f.requestSubmit(); } catch (_) {}
      if (Date.now() < stop) setTimeout(giro, 20); else fine(giri);
    };
    giro();
  });
</script>`;

test('la pagina che scrive e preme di continuo nei riquadri aperti dall\'utente non fa partire niente: spiegazione, Modifica, feedback', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await contaChiamate(app);
  const page = await testServer.openReady(openTab, pagina(`<p id="parola" style="font-size:20px">supercalifragilistico</p>${MARTELLO}`));

  // Spiega: dopo la risposta l'utente mette il cursore nella casella della domanda e resta fermo.
  await page.locator('#parola').dblclick();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('explain-selection', win);
  });
  await expect.poll(async () => (await statoDi(app, page, '.sn-popup-body'))?.testo || '', { timeout: 15_000 }).toContain('Risposta del modello');
  await expect.poll(() => domande(app)).toBe(1);
  await clicca(app, page, '.sn-popup-input');
  expect(await page.evaluate(() => window.martella(3000))).toBeGreaterThan(20);
  await page.waitForTimeout(500);
  expect(await domande(app), 'nessuna domanda partita dalla pagina').toBe(1);
  await tastoSullaScheda(app, page, 'Escape');
  await expect.poll(() => conta(app, page, '.sn-popup')).toBe(0);

  // Modifica: l'utente la apre sulla selezione e mette il cursore nell'istruzione.
  await page.evaluate(() => document.body.insertAdjacentHTML('afterbegin', '<textarea id="campo" style="width:400px;height:80px">Un testo con un erore.</textarea>'));
  await page.locator('#campo').click();
  await page.evaluate(() => { const t = document.querySelector('#campo'); t.focus(); t.select(); });
  await page.locator('#campo').click({ button: 'right' });
  await expect(menuDi(page).locator('.sn-menu')).toBeVisible({ timeout: 10_000 });
  await menuDi(page).locator('.sn-menu .sn-menu-item', { hasText: 'Modifica' }).click();
  await expect.poll(() => statoDi(app, page, '.sn-editbox')).not.toBeNull();
  const prima = await chiamateFerme(app);
  await clicca(app, page, '.sn-editbox-instruction');
  await page.evaluate(() => window.martella(3000));
  await page.waitForTimeout(500);
  expect(await chiamate(app), 'nessuna riscrittura partita dalla pagina').toBe(prima);
  // Il sito scrive nel suo campo quello che vuole, ma la riscrittura non ci arriva.
  expect(await page.locator('#campo').inputValue()).not.toContain('RISCRITTO');
  await tastoSullaScheda(app, page, 'Escape');
  await expect.poll(() => conta(app, page, '.sn-editbox')).toBe(0);

  // Invia feedback: l'utente apre il modulo e mette il cursore nella casella.
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, page, '.sn-fb-text')).not.toBeNull();
  await spiaInvii(app, page);
  await scrivi(app, page, '.sn-fb-text', 'Il tasto indietro non va');
  await page.evaluate(() => window.martella(3000));
  await page.waitForTimeout(500);
  expect(await inviati(app, page), 'nessuna segnalazione partita dalla pagina').toEqual([]);
  expect(await conta(app, page, '.sn-fb-modal')).toBe(1);
  // Il clic vero dell'utente invia quello che c'è nella casella.
  await clicca(app, page, '.sn-fb-send');
  await expect.poll(async () => (await inviati(app, page)).length).toBe(1);
  expect((await inviati(app, page))[0]).toContain('Il tasto indietro non va');
});
