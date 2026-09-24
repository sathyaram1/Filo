// Il diario del lavoro dice TUTTO quello che Filo ha fatto, e non promette
// quello che non è riuscito.
//
// Con gli strumenti nativi il modello chiama azioni che in chat non lasciano
// niente da cliccare (un appunto scritto, una lezione fissata, il proxy tolto,
// lo stile della pagina). Prima sparivano: nessuna riga, nessun bottone,
// nessuna traccia — l'utente non sapeva nemmeno dove fosse finito il suo
// appunto, e un turno fatto di sole azioni silenziose non lasciava blocco. Allo
// stesso tempo un documento inesistente veniva raccontato come «Leggo il
// documento…» e riassunto come «letto un documento»: un successo che non c'era.
//
// Ogni test asserisce il successo dal punto di vista dell'utente, e senza il
// fix sarebbe rosso:
//  (A) appunto e lezione hanno la loro riga e il riassunto le conta; il
//      bottone che porta all'editor resta;
//  (B) una lettura fallita lo DICE, e il riassunto non se ne vanta; un link a
//      un indirizzo non ammesso non lascia un bottone che al click non fa nulla;
//  (C) un'impostazione confermata nel popup entra nel diario, e al turno dopo
//      il modello sa che è stata confermata invece di tirare a indovinare;
//  (D) un guasto a metà: le azioni già fatte tornano al modello al tentativo
//      successivo, che non le rifà;
//  (E) un comando con la modalità terminale spenta dice perché non è partito, e
//      porta all'interruttore;
//  (F) «portami alla home» chiesto dalla home non ricarica la pagina: il lavoro
//      e la risposta restano da leggere;
//  (G) l'evento proposto si aggiunge davvero al calendario, e finché non lo si
//      aggiunge il diario lo chiama proposta.
//  (H) l'azione confermata nel popup lascia la sua riga anche quando non è
//      un'impostazione, e il bottone diventa una ricevuta invece di ripetere
//      «Filo vuole…» con la spunta davanti;
//  (I) l'azione che Filo lascia finire all'utente (riordino delle schede) si
//      raggiunge davvero, e ciò che l'utente finisce cliccando entra nel
//      diario e nel riassunto, comando confermato compreso.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/electron.mjs';
import { clickConfirm, fillConfirmInput, CONFIRM_HOST } from './helpers/confirm.mjs';

// Un evento vecchio piantato nella cartella: serve a G per vedere la ripulita.
const VECCHIO = 'vecchio-di-ieri.ics';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
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

// Provider finto: `giri` è la lista delle risposte, una per giro del modello.
async function fakeProvider(app, giri, slot = '__fake') {
  // In `app.evaluate` il primo parametro è il modulo Electron: l'argomento
  // nostro arriva per secondo.
  await app.evaluate(async (_electron, { giri: g, slot: s }) => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis[`${s}_restore`] = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis[`${s}_calls`] = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      globalThis[`${s}_calls`].push(JSON.parse(JSON.stringify(messages)));
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      if (giro.errore) throw new Error(giro.errore);
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: giro.text || '', toolCalls: calls, reasoningDetails: [],
        finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  }, { giri, slot });
}

const restore = (app, slot = '__fake') => app.evaluate((_electron, s) => {
  try { globalThis[`${s}_restore`]?.(); } catch (_) {}
}, slot);

test('A — appunto e lezione hanno la loro riga nel diario, e il riassunto le conta', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  await fakeProvider(app, [
    {
      toolCalls: [
        { id: 'a1', name: 'SALVA_APPUNTO', arguments: '{"testo":"comprare il latte","contesto":"spesa"}' },
        { id: 'a2', name: 'SALVA_LEZIONE', arguments: '{"testo":"L\'utente non beve caffè."}' },
      ],
    },
    { text: 'Segnato.' },
  ]);

  await page.locator('#input').fill('ricordami di comprare il latte, e sappi che non bevo caffè');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Segnato.' })).toBeVisible({ timeout: 10_000 });

  // Il blocco c'è (prima: nessun blocco, nessuna traccia) e il riassunto dice
  // entrambe le cose.
  const activity = page.locator('.dash-activity');
  await expect(activity).toHaveCount(1);
  await expect(activity).toHaveAttribute('data-phase', 'done');
  const label = activity.locator('.dash-activity-label');
  await expect(label).toContainText('salvato un appunto');
  await expect(label).toContainText('memorizzato una cosa');

  await activity.locator('.dash-activity-head').click();
  const body = activity.locator('.dash-activity-body');
  await expect(body.locator('.dash-activity-row', { hasText: 'Appunto salvato' })).toHaveCount(1);
  await expect(body.locator('.dash-activity-row', { hasText: 'spesa' })).toHaveCount(1);
  await expect(body.locator('.dash-activity-row', { hasText: 'Memorizzato' })).toHaveCount(1);
  await expect(body.locator('.dash-activity-row', { hasText: 'non beve caffè' })).toHaveCount(1);

  // Il bottone che porta dove l'appunto è finito resta: la riga racconta, il
  // bottone ci porta.
  await expect(page.locator('.dash-action-btn[data-action="openNotes"]')).toHaveCount(1);
  await page.screenshot({ path: 'tests/agent/.out/diario-azioni-silenziose.png' });

  await restore(app);
});

test('A2 — un byte nullo nell\'etichetta non arriva nel diario, e il colore tiene il suo controllo', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  await fakeProvider(app, [
    {
      toolCalls: [
        { id: 'z1', name: 'TIMER', arguments: '{"secondi":120,"etichetta":"pa\\u0000sta"}' },
        { id: 'z2', name: 'IMPOSTA_ESTETICA', arguments: '{"token":"accent","valore":"#3a7d44"}' },
      ],
    },
    { text: 'Fatto.' },
  ], '__fakeA2');

  await page.locator('#input').fill('timer 2 minuti e accento verde');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatto.' })).toBeVisible({ timeout: 10_000 });

  const activity = page.locator('.dash-activity');
  await activity.locator('.dash-activity-head').click();
  const riga = activity.locator('.dash-activity-body .dash-activity-row', { hasText: 'Timer avviato' });
  await expect(riga).toHaveCount(1);
  // Il byte nullo non arriva a schermo: l'etichetta resta leggibile.
  const testo = await riga.textContent();
  expect(testo).toContain('pasta');
  expect(testo.includes('\u0000')).toBe(false);

  // Il colore ha la sua riga E il controllo per aggiustare la tinta: una riga
  // nel diario non deve mai mangiarsi un bottone che porta da qualche parte.
  await expect(activity.locator('.dash-activity-body .dash-activity-row', { hasText: 'Aspetto' })).toHaveCount(1);
  await expect(page.locator('.dash-bubble-filo .dash-action-btn')).toHaveCount(1);

  await restore(app, '__fakeA2');
});

test('B — una lettura fallita lo dice, e un link non ammesso non lascia un bottone morto', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  await fakeProvider(app, [
    {
      toolCalls: [
        { id: 'b1', name: 'LEGGI_DOCUMENTO', arguments: '{"percorso":"~/non-esiste-davvero-12345.pdf"}' },
        { id: 'b2', name: 'NAVIGA', arguments: '{"url":"javascript:alert(1)","etichetta":"js"}' },
      ],
    },
    { text: 'Quel documento non c\'è.' },
  ], '__fakeB');

  await page.locator('#input').fill('leggi il pdf e apri il link');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Quel documento non c' })).toBeVisible({ timeout: 10_000 });

  const activity = page.locator('.dash-activity');
  const label = activity.locator('.dash-activity-label');
  // Il riassunto NON si vanta di una lettura che non è avvenuta.
  await expect(label).not.toContainText('letto un documento');
  await expect(label).not.toContainText('aperto una pagina');

  await activity.locator('.dash-activity-head').click();
  const body = activity.locator('.dash-activity-body');
  await expect(body.locator('.dash-activity-row', { hasText: 'Documento non letto' })).toHaveCount(1);
  await expect(body.locator('.dash-activity-row', { hasText: 'Link non aperto' })).toHaveCount(1);
  // Nessun chip che al click non farebbe niente.
  await expect(page.locator('.dash-action-btn', { hasText: 'js' })).toHaveCount(0);
  await page.screenshot({ path: 'tests/agent/.out/diario-non-riuscito.png' });

  await restore(app, '__fakeB');
});

test('C — un\'impostazione confermata entra nel diario e il modello lo sa al turno dopo', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  await fakeProvider(app, [
    { toolCalls: [{ id: 'c1', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"modalita_terminale","valore":true}' }] },
    { text: 'Ti chiedo conferma.' },
    { text: 'Sì, la modalità terminale è attiva.' },
  ], '__fakeC');

  await page.locator('#input').fill('attiva la modalità terminale');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ti chiedo conferma.' })).toBeVisible({ timeout: 10_000 });

  // Il popup si apre da sé: si conferma.
  const host = page.locator(CONFIRM_HOST);
  await expect(host).toBeVisible({ timeout: 5_000 });
  await clickConfirm(page, 'ok');
  await expect(host).toHaveCount(0, { timeout: 5_000 });

  // La conferma lascia la sua riga nel diario (prima: niente), e la riga dice
  // l'impostazione in italiano, non la chiave interna col valore grezzo.
  const activity = page.locator('.dash-activity');
  await activity.locator('.dash-activity-head').click();
  const riga = activity.locator('.dash-activity-body .dash-activity-row', { hasText: 'Impostato' });
  await expect(riga).toHaveCount(1, { timeout: 5_000 });
  await expect(riga).toContainText('Modalità terminale → attiva');
  await expect(riga).not.toContainText('modalita_terminale');

  // E il riassunto in cima si rifà: la conferma arriva a risposta già scritta,
  // e prima il blocco restava intitolato «Come ha lavorato» con dentro
  // l'impostazione cambiata.
  const label = activity.locator('.dash-activity-label');
  await expect(label).toContainText('impostazione', { timeout: 5_000 });
  await expect(label).not.toContainText('Come ha lavorato');

  // E al turno dopo il modello SA che è stata confermata.
  await page.locator('#input').fill('è attivo?');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'è attiva' })).toBeVisible({ timeout: 10_000 });
  const calls = await app.evaluate(() => globalThis.__fakeC_calls);
  const ultimo = JSON.stringify(calls[calls.length - 1]);
  expect(ultimo).toContain('ha CONFERMATO');
  expect(ultimo).toContain('modalita_terminale');

  await restore(app, '__fakeC');
});

test('D — guasto a metà: al nuovo tentativo il modello sa cosa era già stato fatto', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  await fakeProvider(app, [
    { toolCalls: [{ id: 'd1', name: 'TIMER', arguments: '{"secondi":300,"etichetta":"Pasta"}' }] },
    { errore: 'fetch failed' },
    { text: 'Il timer della pasta è già avviato.' },
  ], '__fakeD');

  await page.locator('#input').fill('timer per la pasta e dimmi quando');
  await page.locator('#sendBtn').click();

  // Il turno fallisce: compare l'errore col tasto Riprova.
  const retry = page.locator('.dash-action-btn', { hasText: 'Riprova' });
  await expect(retry).toBeVisible({ timeout: 15_000 });
  const timers = await app.evaluate(async () => (await globalThis.SN_FILO_MEMORY.listTimers()).map((t) => t.label));
  expect(timers).toContain('Pasta');

  await retry.click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'già avviato' })).toBeVisible({ timeout: 15_000 });

  // Il nuovo tentativo parte SAPENDO che il timer c'è già (prima: il modello
  // non lo sapeva e poteva avviarne un secondo).
  const calls = await app.evaluate(() => globalThis.__fakeD_calls);
  const ultimo = JSON.stringify(calls[calls.length - 1]);
  expect(ultimo).toContain('ERANO GIÀ STATE FATTE');
  expect(ultimo).toContain('Pasta');

  await restore(app, '__fakeD');
});

test('E — comando con la modalità terminale spenta: il riquadro dice perché, e porta all\'interruttore', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  // La modalità terminale è spenta: è il caso dell'utente che non sa nemmeno
  // che quell'interruttore esiste.
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: false } }); });

  await fakeProvider(app, [
    { toolCalls: [{ id: 'e1', name: 'ESEGUI_COMANDO', arguments: '{"comando":"ls -la"}' }] },
    { text: 'Non posso eseguirlo.' },
  ], '__fakeE');

  await page.locator('#input').fill('elenca i file');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Non posso eseguirlo.' })).toBeVisible({ timeout: 10_000 });

  // Il riquadro che spiega è TORNATO, ed è in vista sotto la risposta: non
  // dentro il diario, che è chiuso (prima restava solo «Azione non riuscita»).
  const blocco = page.locator('.dash-cmd-blocked');
  await expect(blocco).toBeVisible({ timeout: 5_000 });
  await expect(blocco).toContainText('modalità terminale è spenta');
  await expect(blocco).toContainText('ls -la');
  // E porta dove si accende, invece di lasciare l'utente a cercarlo.
  await expect(blocco.locator('button', { hasText: 'Apri Preferenze' })).toHaveCount(1);

  // Nel diario la riga dice cosa non è partito e perché, non un generico
  // «Azione non riuscita».
  const activity = page.locator('.dash-activity');
  await activity.locator('.dash-activity-head').click();
  const riga = activity.locator('.dash-activity-body .dash-activity-row', { hasText: 'Comando non eseguito' });
  await expect(riga).toHaveCount(1);
  await expect(riga).toContainText('modalità terminale è spenta');
  await page.screenshot({ path: 'tests/agent/.out/diario-terminale-spento.png' });

  await restore(app, '__fakeE');
});

test('F — «portami alla home» chiesto dalla home non ricarica niente: lavoro e risposta restano', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  await fakeProvider(app, [
    { toolCalls: [{ id: 'f1', name: 'COMANDO_FINESTRA', arguments: '{"comando":"home"}' }] },
    { text: 'Sei già qui, nella home.' },
  ], '__fakeF');

  // Un segno che solo una ricarica della pagina può cancellare.
  await page.evaluate(() => { window.__segnoVivo = 'io c\'ero'; });
  await page.locator('#input').fill('portami alla home');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Sei già qui' })).toBeVisible({ timeout: 10_000 });

  // La pagina NON si è ricaricata: la domanda, il blocco e la risposta sono
  // ancora lì (prima sparivano prima che l'utente potesse leggerli).
  expect(await page.evaluate(() => window.__segnoVivo)).toBe('io c\'ero');
  await expect(page.locator('.dash-bubble-user', { hasText: 'portami alla home' })).toHaveCount(1);

  const activity = page.locator('.dash-activity');
  await activity.locator('.dash-activity-head').click();
  await expect(activity.locator('.dash-activity-body .dash-activity-row', { hasText: 'Sei già nella home' })).toHaveCount(1);
  // E il titolo del blocco non conta un comando che non ha fatto niente.
  await expect(activity.locator('.dash-activity-label')).not.toContainText('azionato un comando della finestra');

  // E la home vuota resta a un click, quando l'utente ha finito di leggere.
  const torna = page.locator('.dash-action-btn', { hasText: 'Torna alla home' });
  await expect(torna).toHaveCount(1);
  await torna.click();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 5_000 });
  await expect(page.locator('.dash-bubble-user')).toHaveCount(0);

  await restore(app, '__fakeF');
});

test('G — l\'evento proposto si aggiunge davvero al calendario', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  await fakeProvider(app, [
    {
      toolCalls: [{
        id: 'g1',
        name: 'EVENTO_CALENDARIO',
        arguments: '{"data":"2026-09-24","ora":"15:00","titolo":"Riunione team","dettagli":"Sala 2","durata_min":30}',
      }],
    },
    { text: 'Eccolo, aggiungilo col bottone.' },
  ], '__fakeG');

  await page.locator('#input').fill('segna la riunione di giovedì alle 15');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Eccolo' })).toBeVisible({ timeout: 10_000 });

  // Il diario racconta una PROPOSTA: l'evento nel calendario non c'è ancora.
  const activity = page.locator('.dash-activity');
  await expect(activity.locator('.dash-activity-label')).toContainText('proposto un evento');
  await activity.locator('.dash-activity-head').click();
  const riga = activity.locator('.dash-activity-body .dash-activity-row', { hasText: 'Evento proposto' });
  await expect(riga).toHaveCount(1);
  await expect(riga).toContainText('24/09/2026 alle 15:00');
  await expect(riga).not.toContainText('Evento creato');

  // Un evento di ieri, per vedere se la cartella si ripulisce.
  const cartella = join(await app.evaluate(({ app: elApp }) => elApp.getPath('temp')), 'filo-eventi');
  mkdirSync(cartella, { recursive: true });
  writeFileSync(join(cartella, VECCHIO), 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
  const ieri = Date.now() - 48 * 60 * 60 * 1000;
  utimesSync(join(cartella, VECCHIO), ieri / 1000, ieri / 1000);

  // Il bottone è vivo (prima era spento: la proposta non portava da nessuna
  // parte) e all'utente consegna l'evento.
  const btn = page.locator('.dash-action-btn', { hasText: 'Aggiungi al calendario' });
  await expect(btn).toBeEnabled();
  await btn.click();
  await expect(page.locator('.dash-action-btn', { hasText: '✓' })).toHaveCount(1, { timeout: 10_000 });

  // L'evento è davvero uscito da Filo: il file che il calendario apre esiste e
  // contiene quello che l'utente ha chiesto.
  const dir = join(await app.evaluate(({ app: elApp }) => elApp.getPath('temp')), 'filo-eventi');
  // Gli eventi di ieri non restano lì per sempre: la cartella si ripulisce
  // da sola a ogni aggiunta, altrimenti cresce a ogni uso.
  expect(existsSync(join(dir, VECCHIO))).toBe(false);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.ics')) : [];
  expect(files.length).toBeGreaterThan(0);
  const ultimo = files.map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0].f;
  const ics = readFileSync(join(dir, ultimo), 'utf8');
  expect(ics).toContain('SUMMARY:Riunione team');
  expect(ics).toContain('DTSTART:20260924T150000');
  expect(ics).toContain('DTEND:20260924T153000');
  await page.screenshot({ path: 'tests/agent/.out/diario-evento-calendario.png' });

  await restore(app, '__fakeG');
});

test('H — l\'azione confermata lascia la sua riga, e il bottone diventa una ricevuta', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: 'Si chiama Ada.', PREFERENZE: 'Risposte brevi.' });
  });

  await fakeProvider(app, [
    { toolCalls: [{ id: 'h1', name: 'CANCELLA_MEMORIA', arguments: '{}' }] },
    { text: 'Dimmi di sì e dimentico tutto.' },
  ], '__fakeH');

  await page.locator('#input').fill('dimentica tutto quello che sai di me');
  await page.locator('#sendBtn').click();
  const btn = page.locator('.dash-action-btn').first();
  await expect(btn).toBeVisible({ timeout: 10_000 });
  await btn.click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  await fillConfirmInput(page, 'conferma');
  await clickConfirm(page, 'danger');

  // È successo davvero: il profilo è vuoto.
  await expect.poll(
    () => app.evaluate(async () => String(((await globalThis.SN_FILO_MEMORY.getMemory()) || {}).PROFILO || '')),
    { timeout: 10_000 },
  ).toBe('');

  // Il diario lo dice in cima e nella riga: prima restava «Conferma chiesta»
  // sotto un titolo «Come ha lavorato», e della cancellazione nessuna traccia.
  const activity = page.locator('.dash-activity');
  await expect(activity.locator('.dash-activity-label')).toContainText('cancellato la memoria');
  await activity.locator('.dash-activity-head').click();
  await expect(activity.locator('.dash-activity-body .dash-activity-row', { hasText: 'Memoria cancellata' })).toHaveCount(1);

  // Il bottone è la ricevuta di cosa è successo, non la frase al futuro.
  const testoBtn = await btn.textContent();
  expect(testoBtn).toContain('✓');
  expect(testoBtn).not.toContain('vuole');
  expect(testoBtn).not.toContain('Eliminare DEFINITIVAMENTE');

  await restore(app, '__fakeH');
});

test('I — quello che l\'utente finisce col bottone si raggiunge e finisce nel diario', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    win._filoTabs.runAutoTriage = async () => ({ archived: 3 });
  });

  await fakeProvider(app, [
    { toolCalls: [{ id: 'i1', name: 'PULISCI_TAB', arguments: '{}' }] },
    { text: 'Valuto le schede aperte.' },
  ], '__fakeI');

  await page.locator('#input').fill('riordina le schede e archivia quelle che non servono');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Valuto le schede aperte.' })).toBeVisible({ timeout: 10_000 });

  // Filo la propone e l'utente la finisce: la riga dice che è una proposta e
  // il bottone c'è. Prima il diario la dava per fallita e quella riga si
  // mangiava il bottone: la funzione non si raggiungeva più dalla chat.
  const activity = page.locator('.dash-activity');
  await activity.locator('.dash-activity-head').click();
  await expect(activity.locator('.dash-activity-body .dash-activity-row', { hasText: 'Riordino delle schede' })).toHaveCount(1);
  const btn = page.locator('.dash-action-btn', { hasText: 'Riordina e archivia' });
  await expect(btn).toBeVisible();
  await btn.click();
  await clickConfirm(page, 'ok', { timeout: 10_000 });

  // Finito il riordino, il diario racconta l'esito e il riassunto lo conta:
  // «Ha proposto di riordinare le schede» a cose fatte era una mezza verità.
  await expect(activity.locator('.dash-activity-body .dash-activity-row', { hasText: 'Archiviate 3 schede' })).toHaveCount(1, { timeout: 10_000 });
  await expect(activity.locator('.dash-activity-label')).toContainText('riordinato le schede');
  await restore(app, '__fakeI');

  // Il comando confermato nel popup: l'esito è un passo del lavoro, e il
  // riassunto lo conta come quello di un comando di sola lettura.
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }); });
  const cartella = `${process.env.FILO_USER_DATA || '/tmp'}/filo-diario-I-${Date.now()}`;
  await fakeProvider(app, [
    { toolCalls: [{ id: 'i2', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: `mkdir ${cartella}` }) }] },
    { text: 'Creo la cartella.' },
  ], '__fakeI2');
  await page.locator('#input').fill('crea la cartella');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Creo la cartella.' })).toBeVisible({ timeout: 10_000 });
  const cmdBtn = page.locator('.dash-bubble-actions .dash-action-btn').last();
  await cmdBtn.click();
  await clickConfirm(page, 'ok', { timeout: 10_000 });
  await expect(cmdBtn).toContainText('✓', { timeout: 15_000 });

  const ultimo = page.locator('.dash-activity').last();
  await ultimo.locator('.dash-activity-head').click();
  await expect(ultimo.locator('.dash-activity-body .dash-activity-cmd')).toHaveCount(1, { timeout: 10_000 });
  await expect(ultimo.locator('.dash-activity-label')).toContainText('eseguito un comando');

  await restore(app, '__fakeI2');
});

// (L) Il racconto deve sopravvivere alla chiusura della chat. Dell'azione
// l'archivio teneva il solo NOME, e la conversazione riaperta dalla Cronologia
// dava per riuscito tutto: «Ha cancellato la memoria» di una conferma mai data,
// «Ha eseguito un comando» di un comando mai partito, «Ha proposto un evento»
// di un appuntamento già nel calendario.
const archivio = (app) => app.evaluate(() => globalThis.SN_FILO_CHATS.list());

async function chatConAzione(app, tipo) {
  for (let i = 0; i < 40; i += 1) {
    const c = await archivio(app);
    const ha = (m) => Array.isArray(m.actions) && m.actions.some((a) => (a && a.type ? a.type : a) === tipo);
    if (c.length && c[0].messages.some(ha)) return c[0];
    await new Promise((r) => setTimeout(r, 250));
  }
  return (await archivio(app))[0] || null;
}

async function raccontoRiaperto(openTab, id) {
  const riaperta = await openTab(`filo://dashboard/dashboard.html?chat=${id}`);
  await expect(riaperta.locator('.dash-bubble').first()).toBeVisible({ timeout: 10_000 });
  return (await riaperta.locator('.dash-bubble-note[data-replay="1"]').allTextContents()).join(' | ');
}

test('L — la conversazione riaperta racconta com’è andata, non solo cosa Filo aveva nominato', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] }));

  // Una conferma che l'utente legge e non dà: la memoria è intatta.
  await fakeProvider(app, [
    { toolCalls: [{ id: 'l1', name: 'CANCELLA_MEMORIA', arguments: '{}' }] },
    { text: 'Posso cancellare tutto quello che so di te.' },
  ], '__fakeL1');
  await page.locator('#input').fill('dimentica tutto quello che sai di me');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Posso cancellare' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.dash-action-btn').first()).toBeVisible();
  const chatMem = await chatConAzione(app, 'CANCELLA_MEMORIA');
  expect(chatMem, 'la chat non è arrivata nell’archivio').toBeTruthy();
  const raccontoMem = await raccontoRiaperto(openTab, chatMem.id);
  expect(raccontoMem, 'niente da leggere nella chat riaperta').not.toBe('');
  expect(raccontoMem, `la memoria non è stata cancellata, e la chat riaperta racconta: ${raccontoMem}`)
    .not.toContain('cancellato la memoria');
  await restore(app, '__fakeL1');

  // Un comando che non è mai partito: la modalità terminale è spenta.
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: false } }); });
  const page2 = await newtabPage(app);
  await fakeProvider(app, [
    { toolCalls: [{ id: 'l2', name: 'ESEGUI_COMANDO', arguments: '{"comando":"ls -la"}' }] },
    { text: 'Ecco.' },
  ], '__fakeL2');
  await page2.locator('#input').fill('elenca i file');
  await page2.locator('#sendBtn').click();
  await expect(page2.locator('.dash-bubble-filo', { hasText: 'Ecco.' })).toBeVisible({ timeout: 15_000 });
  await expect(page2.locator('.dash-cmd-blocked')).toBeVisible();
  const chatCmd = await chatConAzione(app, 'ESEGUI_COMANDO');
  const raccontoCmd = await raccontoRiaperto(openTab, chatCmd.id);
  expect(raccontoCmd, `il comando non è partito, e la chat riaperta racconta: ${raccontoCmd}`)
    .not.toMatch(/eseguito un comando/i);
  await restore(app, '__fakeL2');
});

test('L2 — l’evento aggiunto col bottone resta aggiunto anche nella chat riaperta', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] }));

  await fakeProvider(app, [
    { toolCalls: [{ id: 'l3', name: 'EVENTO_CALENDARIO', arguments: '{"titolo":"Cena con Anna","data":"2026-10-02","ora":"20:30"}' }] },
    { text: 'Te lo segno.' },
  ], '__fakeL3');
  await page.locator('#input').fill('segnami la cena con Anna venerdì alle 20:30');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Te lo segno.' })).toBeVisible({ timeout: 15_000 });
  await page.locator('.dash-action-btn', { hasText: 'Aggiungi al calendario' }).click();
  await expect(page.locator('.dash-activity .dash-activity-label').first())
    .toContainText('aggiunto un evento al calendario', { timeout: 15_000 });

  const chat = await chatConAzione(app, 'EVENTO_CALENDARIO');
  const racconto = await raccontoRiaperto(openTab, chat.id);
  expect(racconto, `l’evento è nel calendario, e la chat riaperta racconta: ${racconto}`)
    .toContain('aggiunto un evento al calendario');
  await restore(app, '__fakeL3');
});

// (M) Due azioni dello stesso tipo nella stessa risposta restano due: il diario
// teneva una riga sola per tipo, e aggiungendo il primo appuntamento il secondo
// spariva dal racconto sostituito da una copia del primo.
test('M — due appuntamenti chiesti insieme restano due nel diario', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] }));

  await fakeProvider(app, [
    {
      toolCalls: [
        { id: 'm1', name: 'EVENTO_CALENDARIO', arguments: '{"titolo":"Cena con Anna","data":"2026-10-02","ora":"20:30"}' },
        { id: 'm2', name: 'EVENTO_CALENDARIO', arguments: '{"titolo":"Pranzo con Bruno","data":"2026-10-03","ora":"13:00"}' },
      ],
    },
    { text: 'Te li segno tutti e due.' },
  ], '__fakeM');
  await page.locator('#input').fill('segnami la cena con Anna venerdì e il pranzo con Bruno sabato');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Te li segno tutti e due.' })).toBeVisible({ timeout: 15_000 });

  const bottoni = page.locator('.dash-action-btn', { hasText: 'Aggiungi al calendario' });
  await expect(bottoni).toHaveCount(2, { timeout: 10_000 });
  await bottoni.first().click();
  await expect(page.locator('.dash-action-btn', { hasText: /Aperto nel calendario|Evento salvato/ }))
    .toBeVisible({ timeout: 10_000 });

  const activity = page.locator('.dash-activity');
  await activity.locator('.dash-activity-head').click();
  const righe = await activity.locator('.dash-activity-body .dash-activity-row').allTextContents();
  expect(righe.join(' | '), `il secondo appuntamento è sparito dal diario: ${JSON.stringify(righe)}`).toContain('Bruno');
  expect(righe.filter((t) => /aggiunt/i.test(t)).length, `un solo evento aggiunto: ${JSON.stringify(righe)}`).toBe(1);
  await expect(activity.locator('.dash-activity-label')).not.toContainText('aggiunto 2 eventi');

  await restore(app, '__fakeM');
});

// (N) Il riordino che non è potuto partire lo DICE. Il giudizio sulle schede
// può mancare (crediti finiti, chiave sbagliata, rete giù): Filo se lo teneva
// per sé e rispondeva «Nessuna scheda da archiviare», cioè la stessa frase di
// un riordino riuscito in cui non c'era niente da chiudere.
test('N — il riordino delle schede che non è potuto partire non si legge come riuscito', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await openTab(testServer.html('<html><body><h1>una</h1></body></html>'));
  await openTab(testServer.html('<html><body><h1>due</h1></body></html>'));
  await app.evaluate(() => {
    globalThis.__nOrig = globalThis.SN_TAB_TRIAGE_DECIDE;
    globalThis.SN_TAB_TRIAGE_DECIDE = async () => { throw new Error('crediti finiti'); };
  });

  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] }));

  await fakeProvider(app, [
    { toolCalls: [{ id: 'n1', name: 'PULISCI_TAB', arguments: '{}' }] },
    { text: 'Valuto le schede aperte.' },
  ], '__fakeN');
  await page.locator('#input').fill('riordina le schede e archivia quelle che non servono');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Valuto le schede aperte.' })).toBeVisible({ timeout: 15_000 });

  // Il bottone si prende per posizione: il suo testo cambia al click.
  const btn = page.locator('.dash-bubble-actions .dash-action-btn').first();
  await expect(btn).toHaveText(/Riordina e archivia/);
  await btn.click();
  await clickConfirm(page, 'ok', { timeout: 10_000 });
  await expect.poll(async () => ((await btn.textContent()) || '').trim(), { timeout: 30_000 })
    .not.toContain('Riordino in corso');

  const esito = ((await btn.textContent()) || '').trim();
  expect(esito, 'il riordino non è partito e il bottone dice l’esito di uno riuscito')
    .not.toContain('Nessuna scheda da archiviare');
  expect(esito).toContain('non riuscito');

  // E il diario non se ne vanta.
  const activity = page.locator('.dash-activity');
  await activity.locator('.dash-activity-head').click();
  await expect(activity.locator('.dash-activity-label')).not.toContainText('riordinato le schede');

  await app.evaluate(() => { globalThis.SN_TAB_TRIAGE_DECIDE = globalThis.__nOrig; });
  await restore(app, '__fakeN');
});
