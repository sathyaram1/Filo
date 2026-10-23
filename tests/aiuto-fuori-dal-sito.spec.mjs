// #1509.3 — Quello che l'utente scrive o seleziona nell'Aiuto su un sito, e quello che l'Aiuto risponde, non lo legge il
// sito: né dalla selezione, né dalla copia, né con la ricerca del browser. Il pannello sta nello strato sopra la scheda e
// lavora sulla pagina sotto chiedendo al suo frame principale. Regola: patterns/i-riquadri-di-filo-su-un-sito-stanno-sopra-la-scheda.md

import { test, expect } from './fixtures/electron.mjs';
import { paginaDelloStrato } from './helpers/riquadri.mjs';
import * as Gesti from './helpers/gestiVeri.mjs';

const DOMANDA = 'zibaldone-segreto-15093 del mio conto';
const RISPOSTA = 'Risposta-riservata-15093 sul tuo conto.';

// Lo script del sito: annota ogni selezione, ogni copia, ogni tasto e ogni nodo che entra nel suo documento.
const SPIA = `<script>
  window.__letti = [];
  window.__nodi = [];
  const leggi = () => { try { const s = String(getSelection()); if (s) window.__letti.push(s); } catch (_) {} };
  document.addEventListener('selectionchange', leggi, true);
  for (const t of ['copy', 'cut', 'selectstart', 'keydown', 'keyup', 'mouseup', 'input', 'beforeinput']) window.addEventListener(t, (e) => { leggi(); if (e.data) window.__letti.push(e.data); if (e.key && e.key.length === 1) window.__letti.push(e.key); }, true);
  setInterval(leggi, 50);
  new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) window.__nodi.push(n.outerHTML || n.textContent || ''); })
    .observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  window.trova = (s) => { try { getSelection().removeAllRanges(); } catch (_) {} return window.find(s, false, false, true); };
  window.cosaHaVisto = () => window.__letti.join(' | ') + ' ' + window.__nodi.join(' ') + ' ' + document.documentElement.outerHTML;
  window.__clic = 0;
</script>`;
const PAGINA = `<!doctype html><html><head><meta charset="utf-8"><title>Banca della prova</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif"><h1>Il tuo conto</h1>
  <button id="vai" style="margin-top:40px" onclick="window.__clic++">Vai ai movimenti</button>
  <details id="altro" style="position:absolute;right:60px;top:300px"><summary aria-expanded="false" aria-controls="dentro">Altro</summary><p id="dentro">Dettagli</p></details>
  ${SPIA}</body></html>`;

// Il modello finto dell'Aiuto: risponde con quello che il test gli mette in coda e tiene ogni richiesta.
async function prepara(app, risposte) {
  await app.evaluate(async (_e, risposte) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.HELP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__aiuto = [];
    globalThis.__risposte = risposte.slice();
    const risposta = ({ attempts, messages }) => {
      const fatto = (text) => ({ text, finishReason: 'stop', model: attempts[0].model, provider: attempts[0].provider, usage: {}, toolCalls: [], reasoningDetails: [] });
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      if (!sistema.includes('# Protocollo di risposta')) return fatto('{}');
      globalThis.__aiuto.push(JSON.stringify(messages));
      return fatto(JSON.stringify(globalThis.__risposte.shift() || { text: 'Fine.', status: 'done' }));
    };
    const P = globalThis.SN_PROVIDERS;
    P.completeWithFallback = async (o) => risposta(o);
    P.streamCompleteWithFallback = async (o) => { const r = risposta(o); try { o.onDelta && o.onDelta(r.text); } catch (_) {} return r; };
  }, risposte);
}

async function apriAiuto(app, shell, openTab, testServer) {
  const sito = await testServer.openReady(openTab, PAGINA);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const strato = await paginaDelloStrato(app, sito);
  await strato.waitForSelector('.sn-sidebar-input textarea', { timeout: 10_000 });
  return { sito, strato };
}

const statoNellaBarra = (app, url) => app.evaluate(({ BrowserWindow }, u) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  const t = tm.tabs.find((x) => x.view?.webContents?.getURL() === u);
  return t && t.aiuto ? t.aiuto.pannello : null;
}, url);

async function nienteAlSito(sito, parola) {
  await sito.waitForTimeout(400);
  expect(await sito.evaluate(() => window.cosaHaVisto())).not.toContain(parola);
  expect(await sito.evaluate((s) => window.trova(s), parola)).toBe(false);
  expect(await sito.evaluate(() => document.querySelector('.sn-sidebar, .sn-sidebar-conv, [data-sn-riquadro]')), 'nel documento del sito non entra il pannello').toBeNull();
}

test('Aiuto su un sito: la domanda scritta, selezionata e copiata e la risposta non le legge il sito', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app, [{ text: RISPOSTA, status: 'done' }]);
  const { sito, strato } = await apriAiuto(app, shell, openTab, testServer);
  await expect.poll(() => statoNellaBarra(app, sito.url())).toBe('aperto');

  await strato.locator('.sn-sidebar-input textarea').click();
  await strato.keyboard.insertText(DOMANDA);
  await strato.keyboard.press('ControlOrMeta+A');
  await strato.keyboard.press('ControlOrMeta+C');
  await nienteAlSito(sito, 'zibaldone');

  await strato.keyboard.press('Enter');
  const risposta = strato.locator('.sn-sidebar-msg-assistant', { hasText: 'Risposta-riservata-15093' });
  await expect(risposta).toBeVisible({ timeout: 15_000 });
  // L'Aiuto ha letto la pagina sotto, non lo strato: il modello ha il titolo del sito e la domanda.
  const richiesta = await app.evaluate(() => globalThis.__aiuto[0]);
  expect(richiesta).toContain('Banca della prova');
  expect(richiesta).toContain('Vai ai movimenti');
  expect(richiesta).toContain('zibaldone-segreto-15093');

  // La risposta selezionata e copiata: il sito non la vede.
  await risposta.click({ clickCount: 3 });
  await strato.keyboard.press('ControlOrMeta+C');
  await nienteAlSito(sito, 'Risposta-riservata');
  await nienteAlSito(sito, 'zibaldone');

  // Chiuso dal suo ×, la barra laterale lo sa chiuso.
  await strato.locator('.sn-sidebar-close').click();
  await expect.poll(() => statoNellaBarra(app, sito.url())).toBe('chiuso');
  await expect(strato.locator('.sn-sidebar')).toHaveCount(0);
});

test('Aiuto su un sito: Filo apre la sezione sulla pagina, il passo indicato sta lì e il clic dell\'utente fa andare avanti', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app, [
    { text: 'Apro la sezione.', highlight: { selector: '#altro', action: 'reveal' }, status: 'continue' },
    { text: 'Premi il bottone.', highlight: { selector: '#vai', action: 'click', note: 'Nota-riservata-15093 qui' }, status: 'continue', collapse: false },
    { text: 'Fatto, sei nei movimenti.', status: 'done' },
  ]);
  const { sito, strato } = await apriAiuto(app, shell, openTab, testServer);
  await strato.locator('.sn-sidebar-input textarea').click();
  await strato.keyboard.insertText('dove vedo i movimenti?');
  await strato.keyboard.press('Enter');

  // Il reveal lo fa Filo sulla pagina sotto, e il giro dopo lo sa.
  await expect.poll(() => sito.evaluate(() => document.querySelector('#altro').open), { timeout: 15_000 }).toBe(true);
  await expect(strato.locator('.sn-sidebar-log', { hasText: 'sezione aperta' })).toBeVisible();
  // La cornice del passo è nella pagina, la sua nota nello strato, sopra il bottone: il sito non la legge.
  await expect.poll(() => sito.evaluate(() => !!document.querySelector('.sn-highlight')), { timeout: 15_000 }).toBe(true);
  const nota = strato.locator('.sn-nota-del-passo', { hasText: 'Nota-riservata-15093' });
  await expect(nota).toBeVisible();
  const b = await sito.locator('#vai').boundingBox();
  const n = await nota.boundingBox();
  expect(n.y + n.height <= b.y + 1 || n.y >= b.y + b.height - 1, 'la nota sta sopra o sotto il bottone').toBe(true);
  expect(Math.abs(n.x - Math.max(4, b.x))).toBeLessThan(2);
  await nienteAlSito(sito, 'Nota-riservata');
  const p = await strato.locator('.sn-sidebar').boundingBox();
  expect(b.x + b.width <= p.x || b.x >= p.x + p.width || b.y + b.height <= p.y || b.y >= p.y + p.height, 'il pannello copre il passo').toBe(true);

  // Il clic vero dell'utente sul bottone, attraverso lo strato: la pagina lo riceve e l'Aiuto prosegue.
  await strato.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect.poll(() => sito.evaluate(() => window.__clic)).toBe(1);
  await expect(strato.locator('.sn-sidebar-log', { hasText: 'click su' })).toBeVisible({ timeout: 15_000 });
  await expect(strato.locator('.sn-sidebar-msg-assistant', { hasText: 'Fatto, sei nei movimenti' })).toBeVisible({ timeout: 15_000 });
  expect(await app.evaluate(() => globalThis.__aiuto[2])).toContain('l\'utente ha cliccato');
  await expect.poll(() => sito.evaluate(() => !!document.querySelector('.sn-highlight'))).toBe(false);
  await expect(strato.locator('.sn-nota-del-passo')).toHaveCount(0);
});

test('Aiuto su un sito: il testo proposto per un campo lo vede solo l\'utente, e Accetta lo scrive nel campo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app, [
    { text: 'Scrivo la causale.', highlight: { selector: '#causale', action: 'fill', value: 'Affitto-15093 ottobre', note: 'Causale' }, status: 'continue', collapse: false },
    { text: 'Fatto, ora conferma.', status: 'done' },
  ]);
  const sito = await testServer.openReady(openTab, `<!doctype html><title>Bonifico</title><body style="margin:0;padding:40px">
    <label>Causale <input id="causale" style="width:240px"></label>${SPIA}</body>`);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const strato = await paginaDelloStrato(app, sito);
  await strato.waitForSelector('.sn-sidebar-input textarea', { timeout: 10_000 });
  await strato.locator('.sn-sidebar-input textarea').click();
  await strato.keyboard.insertText('scrivi la causale');
  await strato.keyboard.press('Enter');
  const accetta = strato.locator('.sn-nota-del-passo .sn-highlight-accept');
  await expect(accetta).toBeVisible({ timeout: 15_000 });
  await expect(strato.locator('.sn-nota-del-passo')).toContainText('Affitto-15093 ottobre');
  // Finché l'utente non accetta, il testo proposto il sito non lo vede.
  await nienteAlSito(sito, 'Affitto-15093');
  await expect(sito.locator('#causale')).toHaveValue('');
  // Un clic finto sul bottone, da codice, non lo accetta.
  await strato.evaluate(() => document.querySelector('.sn-highlight-accept').click());
  await sito.waitForTimeout(300);
  await expect(sito.locator('#causale')).toHaveValue('');
  await accetta.click();
  await expect(sito.locator('#causale')).toHaveValue('Affitto-15093 ottobre');
  await expect(strato.locator('.sn-sidebar-log', { hasText: 'testo inserito' })).toBeVisible({ timeout: 15_000 });
  await expect(strato.locator('.sn-sidebar-msg-assistant', { hasText: 'Fatto, ora conferma' })).toBeVisible({ timeout: 15_000 });
  await expect(strato.locator('.sn-nota-del-passo')).toHaveCount(0);
});

test('Aiuto su un sito: un pannello sopra il passo si sposta di lato', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app, [{ text: 'È qui.', highlight: { selector: '#lontano', action: 'click', note: 'qui' }, status: 'done', collapse: false }]);
  const sito = await testServer.openReady(openTab, `<!doctype html><title>Largo</title><body style="margin:0">
    <button id="lontano" style="position:absolute;right:30px;top:200px;width:160px;height:40px">Sotto il pannello</button></body>`);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const strato = await paginaDelloStrato(app, sito);
  await strato.waitForSelector('.sn-sidebar-input textarea', { timeout: 10_000 });
  const prima = await strato.locator('.sn-sidebar').boundingBox();
  const b = await sito.locator('#lontano').boundingBox();
  expect(b.x < prima.x + prima.width && b.x + b.width > prima.x, 'all\'inizio il pannello sta sopra il bottone').toBe(true);
  await strato.locator('.sn-sidebar-input textarea').click();
  await strato.keyboard.insertText('dov\'è?');
  await strato.keyboard.press('Enter');
  await expect.poll(async () => {
    const p = await strato.locator('.sn-sidebar').boundingBox();
    return b.x + b.width <= p.x || b.x >= p.x + p.width;
  }, { timeout: 15_000 }).toBe(true);
});

// Lo strato copre la pagina solo dove ci sono i riquadri (la cornice, #1509.3): con l'Aiuto aperto un trascinamento
// sulla pagina arriva alla pagina, e il pannello si sposta e si scrive con i gesti veri del sistema.
test('con l\'Aiuto aperto un trascinamento sulla pagina arriva alla pagina', async ({ app, shell, openTab, testServer }) => {
  test.skip(!Gesti.disponibili(), 'servono un display X e XTest (lo schermo virtuale delle prove su Linux)');
  test.setTimeout(90_000);
  const sito = await testServer.openReady(openTab, `<!doctype html><html><head><meta charset="utf-8"><title>Trascina</title></head>
    <body style="margin:0;padding:40px;font:16px sans-serif">
    <div id="sorgente" draggable="true" style="width:120px;height:60px;background:#c55;color:#fff">Trascinami</div>
    <div id="meta" style="margin-top:80px;width:300px;height:120px;border:3px dashed #555">Qui</div>
    <script>window.__lasciati = [];
      document.getElementById('sorgente').addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', 'ciao'));
      const m = document.getElementById('meta');
      m.addEventListener('dragover', (e) => e.preventDefault());
      m.addEventListener('drop', (e) => { e.preventDefault(); window.__lasciati.push(e.dataTransfer.getData('text/plain')); });
    </script></body></html>`);
  await Gesti.finestraASchermo(app);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const strato = await paginaDelloStrato(app, sito);
  await strato.waitForSelector('.sn-sidebar-input textarea', { timeout: 10_000 });

  // Il pannello si sposta dalla testata, anche oltre la sua cornice di prima.
  const prima = await strato.locator('.sn-sidebar').boundingBox();
  const testata = await Gesti.sulloSchermo(app, sito, strato, '.sn-sidebar-title');
  Gesti.trascina(testata, { x: testata.x - 300, y: testata.y });
  await expect.poll(async () => (await strato.locator('.sn-sidebar').boundingBox()).x).toBeLessThan(prima.x - 200);

  // Si scrive nella casella coi tasti veri: la tastiera è dello strato.
  const casella = await Gesti.sulloSchermo(app, sito, strato, '.sn-sidebar-input textarea');
  Gesti.trascina(casella, casella);
  Gesti.scrivi('ciaofilo');
  await expect(strato.locator('.sn-sidebar-input textarea')).toHaveValue('ciaofilo');

  // Il trascinamento fra due punti della pagina, fuori dal pannello: la pagina lo riceve e lo lascia cadere.
  Gesti.trascina(await Gesti.sulloSchermo(app, sito, sito, '#sorgente'), await Gesti.sulloSchermo(app, sito, sito, '#meta'));
  await expect.poll(() => sito.evaluate(() => window.__lasciati)).toEqual(['ciao']);
});
