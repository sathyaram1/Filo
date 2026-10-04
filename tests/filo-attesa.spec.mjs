// #578 — Il filo dell'attesa: quello che la chat mostra mentre Filo lavora.
//
// Prima: una rotella e «Sta ragionando · …» con l'ultima frase del ragionamento ancora incompleta, che cresceva a
// strappi e troncava le parole; le azioni si vedevano solo aprendo la cronologia; nessun modo di fermare Filo.
// Ogni test asserisce il successo visto dall'utente, e senza il lavoro di #578 sarebbe rosso
// (regole: patterns/il-filo-dell-attesa.md):
//  (A) un filo che ondeggia, nessuna scritta di stato, la trama del ragionamento; due strumenti chiamati insieme
//      fanno UN nodo col titolo calcolato; alla risposta il gomitolo col riassunto, che si srotola con un clic;
//  (B) un passo che non riesce: il cappio si riapre e il puntino non si forma;
//  (C) il quadrato al posto dell'invio ferma subito: filo tagliato, ragionamento a metà aperto, il blocco resta
//      srotolato, la chiamata al modello si interrompe; poi lo stesso posto offre «riprendi»;
//  (D) riprendere non riesegue le azioni già fatte, e il modello sa che erano fatte;
//  (E) Invio da tastiera ferma come il quadrato, e un'azione nominata dopo lo stop non parte;
//  (F) l'opacità della trama è un token estetico che arriva fino alla chat;
//  (G) il tasto destro sul blocco ferma, riprende e riavvolge come i tasti;
//  (H) con meno movimento il filo sta fermo e il gomitolo compare già fatto.

import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

// L'accoglienza di un profilo nuovo, a metà, ridisegna la conversazione quando la home si ricarica: qui serve chiusa.
async function senzaAccoglienza(app, page) {
  await app.evaluate(async () => {
    const M = globalThis.SN_FILO_MEMORY;
    await M.setOnboarding(globalThis.SN_ONBOARDING.close(await M.getOnboarding()));
  });
  await page.reload();
  await expect(page.locator('#input')).toBeVisible();
}

async function configureModel(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

// Un modello finto a copione. Ogni passo: { pensa: [pezzi], ogni: ms, strumenti: [{id,name,arguments}],
// dopoStrumenti: ms, testo, sordo }. Rispetta lo stop (signal) salvo `sordo`; registra i messaggi ricevuti e gli stop.
async function copione(app, passi) {
  await app.evaluate(async (_, passiJson) => {
    const passi = JSON.parse(passiJson);
    const P = globalThis.SN_PROVIDERS;
    if (!globalThis.__origStream) globalThis.__origStream = P.streamCompleteWithFallback;
    globalThis.__messaggi = [];
    globalThis.__interrotte = 0;
    let n = 0;
    P.streamCompleteWithFallback = async ({ attempts, messages, signal, onReasoning, onDelta, onToolCall }) => {
      globalThis.__messaggi.push(messages);
      const p = passi[Math.min(n, passi.length - 1)];
      n += 1;
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      const aspetta = (ms) => new Promise((ok, ko) => {
        const t = setTimeout(ok, ms);
        if (signal && !p.sordo) {
          if (signal.aborted) { clearTimeout(t); globalThis.__interrotte += 1; const e = new Error('aborted'); e.name = 'AbortError'; ko(e); return; }
          signal.addEventListener('abort', () => { clearTimeout(t); globalThis.__interrotte += 1; const e = new Error('aborted'); e.name = 'AbortError'; ko(e); }, { once: true });
        }
      });
      for (const pezzo of p.pensa || []) {
        try { onReasoning && onReasoning(pezzo); } catch (_) {}
        await aspetta(p.ogni || 120);
      }
      if (p.strumenti && p.strumenti.length) {
        for (const s of p.strumenti) { try { onToolCall && onToolCall({ id: s.id, name: s.name }); } catch (_) {} }
        await aspetta(p.dopoStrumenti || 200);
        return { ...base, text: '', toolCalls: p.strumenti, finishReason: 'tool_calls' };
      }
      const testo = p.testo || 'Fatto.';
      try { onDelta && onDelta(testo); } catch (_) {}
      return { ...base, text: testo, toolCalls: [], finishReason: 'stop' };
    };
  }, JSON.stringify(passi));
}
// Come le Preferenze: il cambio passa dal main e arriva a tutte le pagine aperte.
async function impostazioni(app, settings) {
  await app.evaluate(async (_, s) => globalThis.__filoHandlers.handleMessage(
    { type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: s },
    { url: 'filo://preferences/preferences.html' },
  ), settings);
}
async function ripristina(app) {
  await app.evaluate(() => {
    if (globalThis.__origStream) globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.__origStream;
  });
}

const PENSIERO_1 = ['L\'utente vuole due timer, ', 'uno per la pasta e uno per l\'uovo. ', 'Li avvio insieme, ', 'sono indipendenti. '];
const PENSIERO_2 = ['Sono partiti tutti e due. ', 'Rispondo in breve. '];

test('A — il filo, la trama, un nodo per due strumenti insieme, poi il gomitolo che si srotola', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await senzaAccoglienza(app, page);
  await copione(app, [
    {
      pensa: PENSIERO_1, ogni: 450, dopoStrumenti: 1200,
      strumenti: [
        { id: 'a1', name: 'TIMER', arguments: '{"secondi":300,"etichetta":"Pasta"}' },
        { id: 'a2', name: 'TIMER', arguments: '{"secondi":60,"etichetta":"Uovo"}' },
      ],
    },
    { pensa: PENSIERO_2, ogni: 500, testo: 'Due timer partiti: pasta 5 minuti, uovo 1 minuto.' },
  ]);

  await page.locator('#input').fill('timer per la pasta e per l\'uovo');
  await page.locator('#sendBtn').click();

  const blocco = page.locator('.dash-activity');
  await expect(blocco).toHaveAttribute('data-phase', 'reason', { timeout: 5_000 });
  // Nessuna scritta di stato: niente «Sta ragionando», niente rotella. Il filo c'è e la trama scorre.
  const trama = blocco.locator('.dash-activity-trama');
  await expect(trama).toBeVisible();
  await expect(trama).toContainText('pasta');
  await expect(blocco).not.toContainText('Sta ragionando');
  await expect(page.locator('.dash-activity-icon')).toHaveCount(0);
  const d1 = await blocco.locator('.dash-activity-filo-tratto').getAttribute('d');
  expect((d1 || '').length).toBeGreaterThan(20);
  // Il filo è vivo: il tratto cambia da un fotogramma all'altro.
  await expect.poll(async () => blocco.locator('.dash-activity-filo-tratto').getAttribute('d'), { timeout: 2_000 }).not.toBe(d1);
  // La trama è piccola e sfumata: si intravede, non si legge.
  const stile = await trama.evaluate((el) => ({ op: Number(getComputedStyle(el).opacity), fs: parseFloat(getComputedStyle(el).fontSize) }));
  expect(stile.op).toBeGreaterThan(0.3);
  expect(stile.op).toBeLessThan(0.7);
  expect(stile.fs).toBeLessThan(12);
  // La sezione la stringe sul suo ultimo pezzo: cresce in coda, non si riaccorcia.
  await page.screenshot({ path: 'tests/.shots/filo-attesa-pensa.png' });

  // Gli strumenti partono: la riga dice cosa sta facendo, il filo si annoda UNA volta per i due timer.
  const testa = blocco.locator('.dash-activity-seg-head').first();
  await expect(testa).toHaveText('Avvio un timer…', { timeout: 6_000 });
  await expect(blocco).toHaveAttribute('data-phase', 'act');
  await expect(blocco.locator('.dash-activity-nodo')).toHaveCount(1);
  await page.screenshot({ path: 'tests/.shots/filo-attesa-agisce.png' });
  // L'esito: il titolo definitivo, calcolato dal verbo e dal conto.
  await expect(testa).toHaveText('Avviati due timer · Pasta, Uovo', { timeout: 6_000 });
  await expect.poll(async () => Number(await blocco.locator('.dash-activity-nodo').getAttribute('r')), { timeout: 3_000 })
    .toBeGreaterThan(2.5);

  // Comincia la risposta: il filo si avvolge, resta una riga col riassunto e la durata.
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Due timer partiti' })).toBeVisible({ timeout: 10_000 });
  const capo = blocco.locator('.dash-activity-head');
  await expect(capo).toBeVisible();
  await expect(blocco.locator('.dash-activity-label')).toHaveText(/^Ha avviato 2 timer · \d+ s$/);
  await expect(capo).toHaveAttribute('aria-expanded', 'false');
  await expect(blocco.locator('.dash-activity-body')).toBeHidden({ timeout: 3_000 });
  await expect(blocco).toHaveAttribute('data-filo', 'gomitolo');
  // Il gomitolo è lo stesso filo mandato sulla spirale: sta tutto nella colonna del filo, alto quanto la riga.
  await page.waitForTimeout(1_200);
  const box = await blocco.locator('.dash-activity-filo-tratto').evaluate((p) => { const b = p.getBBox(); return { w: b.width, h: b.height, x: b.x }; });
  expect(box.w).toBeLessThan(26);
  expect(box.h).toBeLessThan(26);
  // L'ultimo pensiero non si vede prima di srotolare.
  const coda = blocco.locator('.dash-activity-reasoning', { hasText: 'Rispondo in breve.' });
  await expect(coda).toBeHidden();
  await page.screenshot({ path: 'tests/.shots/filo-attesa-gomitolo.png' });

  // Un clic srotola: il nodo col suo titolo, e sotto la coda (l'ultimo pensiero) senza titolo.
  await capo.click();
  await expect(capo).toHaveAttribute('aria-expanded', 'true');
  const body = blocco.locator('.dash-activity-body');
  await expect(body).toBeVisible();
  await expect(blocco.locator('.dash-activity-seg-head', { hasText: 'Avviati due timer' })).toBeVisible();
  await expect(coda).toBeVisible();
  await page.waitForTimeout(1_200);
  await page.screenshot({ path: 'tests/.shots/filo-attesa-srotolato.png' });
  // Aprire il nodo: il ragionamento che ci ha portato e gli esiti, uno alla volta.
  await blocco.locator('.dash-activity-seg-head', { hasText: 'Avviati due timer' }).click();
  const nodo = blocco.locator('.dash-activity-seg', { has: page.locator('.dash-activity-seg-head', { hasText: 'Avviati due timer' }) });
  await expect(nodo.locator('.dash-activity-reasoning')).toContainText('uno per la pasta');
  await expect(nodo.locator('.dash-activity-row', { hasText: 'Pasta' })).toBeVisible();
  await expect(nodo.locator('.dash-activity-row', { hasText: 'Uovo' })).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/filo-attesa-nodo-aperto.png' });
  // Il nodo sta sulla sua riga.
  const yNodo = Number(await blocco.locator('.dash-activity-nodo').getAttribute('cy'));
  const yRiga = await nodo.evaluate((el) => el.offsetTop + 12);
  expect(Math.abs(yNodo - yRiga)).toBeLessThan(3);
  // Il passaggio del mouse sul nodo dice il titolo esteso.
  await blocco.locator('.dash-activity-nodo-presa').hover();
  await expect(page.locator('.dash-filo-hint')).toHaveText('Avviati due timer · Pasta, Uovo');
  // Un clic riavvolge.
  await capo.click();
  await expect(body).toBeHidden({ timeout: 3_000 });

  const timers = await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers());
  expect(timers.map((t) => t.label).sort()).toEqual(['Pasta', 'Uovo']);
  await ripristina(app);
});

test('A2 — tema scuro: il filo e il gomitolo restano nel colore d\'accento', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await senzaAccoglienza(app, page);
  await impostazioni(app, { theme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-sn-theme', 'dark', { timeout: 5_000 });
  await copione(app, [
    { pensa: ['Controllo cosa so fare. ', 'Poi rispondo. '], ogni: 500, strumenti: [{ id: 'c1', name: 'CAPACITA_DETTAGLIO', arguments: '{"ids":["save-for-later"]}' }], dopoStrumenti: 900 },
    { pensa: ['Ho il dettaglio. '], ogni: 400, testo: 'Sì, lo so fare.' },
  ]);
  await page.locator('#input').fill('sai salvare per dopo?');
  await page.locator('#sendBtn').click();
  const blocco = page.locator('.dash-activity');
  await expect(blocco.locator('.dash-activity-seg-head').first()).toHaveText('Verifico cosa so fare…', { timeout: 6_000 });
  await page.screenshot({ path: 'tests/.shots/filo-attesa-scuro-agisce.png' });
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Sì, lo so fare.' })).toBeVisible({ timeout: 10_000 });
  await blocco.locator('.dash-activity-head').click();
  await page.waitForTimeout(1_200);
  await page.screenshot({ path: 'tests/.shots/filo-attesa-scuro-srotolato.png' });
  const colore = await blocco.locator('.dash-activity-filo-tratto').evaluate((p) => getComputedStyle(p).stroke);
  expect(colore).toBe('rgb(192, 85, 43)');
  await ripristina(app);
});

test('B — un passo che non riesce: il cappio si stringe e si riapre, il puntino non si forma', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await senzaAccoglienza(app, page);
  await copione(app, [
    { pensa: ['Leggo il documento. '], ogni: 300, strumenti: [{ id: 'b1', name: 'LEGGI_DOCUMENTO', arguments: '{"percorso":"~/non-esiste-davvero-578.pdf"}' }] },
    { pensa: ['Non c\'è. '], ogni: 300, testo: 'Quel documento non c\'è.' },
  ]);
  await page.locator('#input').fill('leggi il pdf');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Quel documento non c' })).toBeVisible({ timeout: 10_000 });
  const blocco = page.locator('.dash-activity');
  await blocco.locator('.dash-activity-head').click();
  const testa = blocco.locator('.dash-activity-seg-head').first();
  await expect(testa).toContainText('Documento non letto');
  // Il puntino non c'è (raggio zero) e il cappio resta aperto sul filo, a srotolamento finito.
  await expect(blocco).toHaveAttribute('data-filo', 'srotolato');
  await expect.poll(() => blocco.locator('.dash-activity-filo-tratto').evaluate((p) => p.getBBox().width), { timeout: 4_000 })
    .toBeGreaterThan(7);
  expect(Number(await blocco.locator('.dash-activity-nodo').getAttribute('r'))).toBe(0);
  await page.screenshot({ path: 'tests/.shots/filo-attesa-cappio-aperto.png' });
  await ripristina(app);
});

test('C — il quadrato ferma subito: filo tagliato, ragionamento a metà aperto, blocco srotolato, poi «riprendi»', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await senzaAccoglienza(app, page);
  await copione(app, [
    { pensa: ['Cerco di capire cosa intende. ', 'Forse vuole un elenco lunghissimo, ', 'ci vorrà parecchio. ', 'Continuo a pensare. ', 'Ancora. ', 'Ancora un po\'. '], ogni: 900, testo: 'Non dovresti leggermi.' },
  ]);
  await page.locator('#input').fill('scrivimi un poema');
  const posto = await page.locator('#sendBtn').boundingBox();
  await page.locator('#sendBtn').click();
  const blocco = page.locator('.dash-activity');
  await expect(blocco).toHaveAttribute('data-phase', 'reason', { timeout: 5_000 });
  // Il posto dell'invio lo prende il quadrato.
  const ferma = page.locator('#stopBtn');
  await expect(ferma).toBeVisible();
  await expect(page.locator('#sendBtn')).toBeHidden();
  const quadrato = await ferma.boundingBox();
  for (const k of ['x', 'y', 'width', 'height']) expect(Math.abs(quadrato[k] - posto[k])).toBeLessThan(3);
  await page.screenshot({ path: 'tests/.shots/filo-attesa-quadrato.png' });
  await expect(blocco.locator('.dash-activity-seg[data-stato="pensa"] .dash-activity-trama')).toContainText('elenco', { timeout: 4_000 });

  await ferma.click();
  // Subito, senza aspettare il main: il filo si taglia e la riga in corso resta col ragionamento a metà, aperta.
  await expect(blocco).toHaveAttribute('data-fermato', '1', { timeout: 1_000 });
  const fermata = blocco.locator('.dash-activity-seg[data-stato="fermato"]');
  await expect(fermata.locator('.dash-activity-seg-head')).toHaveText('Fermato qui');
  await expect(fermata.locator('.dash-activity-reasoning')).toBeVisible();
  await expect(fermata.locator('.dash-activity-reasoning')).toContainText('Cerco di capire');
  await expect(blocco.locator('.dash-activity-label')).toHaveText(/^Fermato · \d+ s$/);
  // Il blocco NON si arrotola.
  await expect(blocco).toHaveAttribute('data-filo', 'srotolato');
  await expect(blocco.locator('.dash-activity-body')).toBeVisible();
  // Al posto della risposta, una riga che dice che è stato fermato prima.
  await expect(page.locator('.dash-bubble-fermato')).toHaveText('Fermato prima della risposta.', { timeout: 5_000 });
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Non dovresti leggermi' })).toHaveCount(0);
  // La chiamata al modello si è interrotta davvero.
  expect(await app.evaluate(() => globalThis.__interrotte)).toBeGreaterThan(0);
  // Lo stesso posto offre di riprendere, finché non si scrive altro.
  const invio = page.locator('#sendBtn');
  await expect(invio).toBeVisible();
  await expect(ferma).toBeHidden();
  await expect(invio).toHaveAttribute('aria-label', 'Riprendi');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/.shots/filo-attesa-fermato.png' });
  await page.locator('#input').fill('altro');
  await expect(invio).toHaveAttribute('aria-label', 'Invia');
  await page.locator('#input').fill('');
  await expect(invio).toHaveAttribute('aria-label', 'Riprendi');
  // Il blocco fermato si riavvolge e si srotola come gli altri.
  await blocco.locator('.dash-activity-head').click();
  await expect(blocco.locator('.dash-activity-body')).toBeHidden({ timeout: 3_000 });
  await ripristina(app);
});

test('D — riprendere non riesegue le azioni già fatte, e il modello sa che erano fatte', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await senzaAccoglienza(app, page);
  await copione(app, [
    { pensa: ['Avvio il timer. '], ogni: 200, strumenti: [{ id: 'd1', name: 'TIMER', arguments: '{"secondi":120,"etichetta":"Tè"}' }] },
    { pensa: ['Ora penso a lungo a cosa dire. ', 'Molto a lungo. ', 'Ancora. ', 'Ancora. ', 'Ancora. '], ogni: 900, testo: 'Mai.' },
    { pensa: ['Riprendo: il timer c\'è già. '], ogni: 200, testo: 'Il timer del tè è partito.' },
  ]);
  await page.locator('#input').fill('timer per il tè');
  await page.locator('#sendBtn').click();
  const blocco = page.locator('.dash-activity').first();
  await expect(blocco.locator('.dash-activity-seg-head').first()).toHaveText(/Avviato un timer · Tè/, { timeout: 8_000 });
  await expect(blocco.locator('.dash-activity-seg[data-stato="pensa"] .dash-activity-trama')).toContainText('lungo', { timeout: 5_000 });
  await page.locator('#stopBtn').click();
  await expect(page.locator('.dash-bubble-fermato')).toBeVisible({ timeout: 5_000 });
  // Il nodo dell'azione fatta resta, col suo esito.
  await expect(blocco.locator('.dash-activity-seg-head', { hasText: 'Avviato un timer' })).toBeVisible();
  expect((await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers())).length).toBe(1);

  await expect(page.locator('#sendBtn')).toHaveAttribute('aria-label', 'Riprendi');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Il timer del tè è partito.' })).toBeVisible({ timeout: 10_000 });
  // La riga «fermato prima della risposta» lascia il posto alla risposta.
  await expect(page.locator('.dash-bubble-fermato')).toHaveCount(0);
  // Nessun timer rifatto, e il modello ha letto che era già stato fatto, poi la richiesta di riprendere.
  const timers = await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers());
  expect(timers.map((t) => t.label)).toEqual(['Tè']);
  const ultimi = await app.evaluate(() => globalThis.__messaggi[globalThis.__messaggi.length - 1]);
  const testo = ultimi.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
  expect(testo).toContain('ti ha fermato a metà lavoro');
  expect(testo).toContain('ERANO GIÀ STATE FATTE');
  expect(testo).toContain('riprendere il lavoro da dove ti eri fermato');
  // Nessuna bolla dell'utente per il «riprendi»: non l'ha scritto lui.
  await expect(page.locator('.dash-bubble-user')).toHaveCount(1);
  await expect(page.locator('#sendBtn')).toHaveAttribute('aria-label', 'Invia');
  await page.screenshot({ path: 'tests/.shots/filo-attesa-ripreso.png' });
  await ripristina(app);
});

test('E — Invio ferma come il quadrato, e un\'azione nominata dopo lo stop non parte', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await senzaAccoglienza(app, page);
  // Il modello finto non ascolta lo stop: la sua chiamata finisce lo stesso e chiede un timer. Non deve partire.
  await copione(app, [
    { pensa: ['Metto un timer. '], ogni: 200, strumenti: [{ id: 'e1', name: 'TIMER', arguments: '{"secondi":60,"etichetta":"Mai"}' }], dopoStrumenti: 2500, sordo: true },
  ]);
  await page.locator('#input').fill('timer di un minuto');
  await page.locator('#input').press('Enter');
  const blocco = page.locator('.dash-activity');
  await expect(blocco.locator('.dash-activity-seg-head').first()).toHaveText('Avvio un timer…', { timeout: 5_000 });
  await page.locator('#input').press('Enter');
  await expect(blocco).toHaveAttribute('data-fermato', '1', { timeout: 1_000 });
  await expect(page.locator('.dash-bubble-fermato')).toBeVisible({ timeout: 6_000 });
  expect((await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers())).length).toBe(0);
  await ripristina(app);
});

test('F — l\'opacità della trama è un token estetico che arriva fino alla chat', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await senzaAccoglienza(app, page);
  await impostazioni(app, { themeTokens: { 'filo.trama.opacity': '0.25' } });
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--dash-trama-opacity').trim()), { timeout: 5_000 })
    .toBe('0.25');
  await copione(app, [{ pensa: ['Un pensiero lungo ', 'che scorre ', 'per un po\'. ', 'Ancora. '], ogni: 700, testo: 'Ok.' }]);
  await page.locator('#input').fill('ciao');
  await page.locator('#sendBtn').click();
  const trama = page.locator('.dash-activity-trama');
  await expect(trama).toBeVisible({ timeout: 5_000 });
  expect(Number(await trama.evaluate((el) => getComputedStyle(el).opacity))).toBeCloseTo(0.25, 2);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ok.' })).toBeVisible({ timeout: 10_000 });
  await impostazioni(app, { themeTokens: {} });
  await ripristina(app);
});

test('G — il tasto destro sul blocco che lavora offre «Ferma», poi «Riprendi» e «Riavvolgi»', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await senzaAccoglienza(app, page);
  await copione(app, [
    { pensa: ['Ci penso a lungo. ', 'Ancora. ', 'Ancora. ', 'Ancora. ', 'Ancora. '], ogni: 900, testo: 'Mai.' },
    { pensa: ['Riprendo. '], ogni: 200, testo: 'Eccomi di nuovo.' },
  ]);
  await page.locator('#input').fill('pensaci');
  await page.locator('#sendBtn').click();
  const blocco = page.locator('.dash-activity');
  const trama = blocco.locator('.dash-activity-seg[data-stato="pensa"] .dash-activity-trama');
  await expect(trama).toContainText('a lungo', { timeout: 5_000 });
  const menu = page.locator('.sn-menu');
  await trama.click({ button: 'right' });
  await menu.getByText('Ferma', { exact: true }).click();
  await expect(blocco).toHaveAttribute('data-fermato', '1', { timeout: 1_000 });
  await expect(page.locator('.dash-bubble-fermato')).toBeVisible({ timeout: 5_000 });

  await blocco.locator('.dash-activity-head').click({ button: 'right' });
  await expect(menu.getByText('Riavvolgi', { exact: true })).toBeVisible();
  await menu.getByText('Riprendi da dove si era fermato').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Eccomi di nuovo.' })).toBeVisible({ timeout: 10_000 });
  await ripristina(app);
});

test('H — con meno movimento il filo non ondeggia e il gomitolo compare già fatto', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await senzaAccoglienza(app, page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await copione(app, [{ pensa: ['Ci penso con calma. ', 'Ancora un momento. ', 'Quasi. ', 'Ecco. '], ogni: 700, testo: 'Calmo.' }]);
  await page.locator('#input').fill('ciao');
  await page.locator('#sendBtn').click();
  const blocco = page.locator('.dash-activity');
  const tratto = blocco.locator('.dash-activity-filo-tratto');
  await expect(blocco).toHaveAttribute('data-phase', 'reason', { timeout: 5_000 });
  await page.waitForTimeout(300);
  const d1 = await tratto.getAttribute('d');
  await page.waitForTimeout(400);
  expect(await tratto.getAttribute('d')).toBe(d1);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Calmo.' })).toBeVisible({ timeout: 10_000 });
  // Niente avvolgimento animato: il gomitolo c'è già, e le righe sono già chiuse.
  await expect(blocco).toHaveAttribute('data-filo', 'gomitolo');
  expect(await blocco.locator('.dash-activity-body').evaluate((el) => el.hidden)).toBe(true);
  await ripristina(app);
});
