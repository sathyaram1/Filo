// Verifica #530, giro 2 — due cose che il motore dà per lette senza esserlo, e
// cosa resta possibile a chi sceglie il livello più prudente.
//
// 1. Il compito si sporca quando un'azione di lettura PARTE, non quando porta
//    indietro qualcosa: una ricerca che non trova niente e un file che non
//    esiste lasciano il compito «contaminato», e la frase che Filo mostra
//    all'utente («in questo compito ho letto una ricerca sul web») dice una
//    cosa che non è successa.
// 2. A «Conservativo» basta una scheda web aperta perché OGNI conversazione
//    nasca contaminata: da lì le azioni di costo 3 non si fanno più, e la via
//    d'uscita che Filo suggerisce per prima — rifarlo in una conversazione
//    nuova — non cambia niente finché quella scheda resta lì.

import { test, expect } from '../../fixtures/electron.mjs';

test.setTimeout(90_000);

const exec = (app, action, opts) =>
  app.evaluate((_electron, { action, opts }) =>
    globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

const chat = (id) => ({
  tab: { id, url: 'filo://dashboard/dashboard.html' },
  url: 'filo://dashboard/dashboard.html',
});

const setLivello = (app, livello) =>
  app.evaluate((_e, l) => globalThis.SN_STORAGE.updateSettings({ autonomia: { livello: l } }), livello);

test('PORTA: una ricerca che non ha trovato niente sporca lo stesso il compito', async ({ app }) => {
  await setLivello(app, 'default');
  const s = chat(9630);
  const cerca = await exec(app, { type: 'CERCA_WEB', query: 'qualunque cosa' }, { sender: s });
  // Nel contenitore delle routine la rete non c'è: la ricerca fallisce e non
  // porta dentro niente. È lo stesso caso di un utente offline.
  expect(cerca.executed, 'qui la ricerca deve fallire, altrimenti la prova non dimostra niente').toBe(false);

  const lezione = await exec(app, { type: 'SALVA_LEZIONE', testo: 'Preferisce risposte brevi' }, { sender: s });
  expect(
    lezione.needsConfirm,
    'PORTA: la ricerca non ha portato dentro niente, e il compito è comunque contaminato',
  ).toBe(2);
  expect(
    String(lezione.motivo),
    'PORTA: il motivo mostrato all\'utente racconta una lettura che non è avvenuta',
  ).toMatch(/ho letto una ricerca sul web/i);
});

test('PORTA: un documento che non esiste sporca lo stesso il compito', async ({ app }) => {
  await setLivello(app, 'default');
  const s = chat(9631);
  const letto = await exec(app, { type: 'LEGGI_DOCUMENTO', percorso: '/tmp/questo-file-non-esiste-530.txt' }, { sender: s });
  expect(letto.executed, 'il file non c\'è: la lettura non può essere riuscita').toBe(false);

  const lezione = await exec(app, { type: 'SALVA_LEZIONE', testo: 'Preferisce risposte brevi' }, { sender: s });
  expect(
    lezione.needsConfirm,
    'PORTA: nessun contenuto è entrato nel contesto, e il compito è comunque contaminato',
  ).toBe(2);
});

test('PORTA: a «Conservativo» una scheda web aperta rende impossibile tutto ciò che è costo 3', async ({ app, openTab, testServer }) => {
  const url = testServer.html('<!doctype html><title>Una pagina qualunque</title><p>x</p>');
  const page = await openTab(url);
  await page.waitForLoadState('load').catch(() => {});

  // Il riepilogo di stato che accompagna OGNI turno di chat dichiara da sé di
  // aver messo nel contesto i titoli delle schede: è così che la fonte
  // «schede» entra in una conversazione appena nata, senza nessuna azione.
  let fonti = [];
  for (let i = 0; i < 25; i += 1) {
    fonti = await app.evaluate(async () => {
      try { return (await globalThis.SN_FILO_STATE.assemble()).fonti || []; } catch (_) { return []; }
    });
    if (fonti.includes('schede')) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  expect(fonti, 'il riepilogo deve dichiarare i titoli delle schede').toContain('schede');

  await setLivello(app, 'conservativo');
  const d = await app.evaluate(() => {
    const A = globalThis.SN_AUTONOMIA;
    return {
      stato: A.statoPerFonti(['schede'], 'conservativo'),
      costo3: A.decide({ livello: 'conservativo', fonti: ['schede'], costo: 3 }),
      costo2: A.decide({ livello: 'conservativo', fonti: ['schede'], costo: 2 }),
      uscita: A.valuta({ livello: 'conservativo', fonti: ['schede'], costo: 3 }).uscita,
    };
  });
  expect(d.stato).toBe('contaminato');
  expect(
    d.costo3,
    'PORTA: a Conservativo, con una qualunque scheda web aperta, mandare una segnalazione, '
    + 'lanciare un comando che modifica o svuotare l\'archivio non si possono più fare, in '
    + 'nessuna conversazione',
  ).toBe('no');
  expect(
    d.uscita,
    'PORTA: la prima strada che Filo suggerisce è una conversazione nuova, che nasce '
    + 'contaminata uguale finché quella scheda resta aperta',
  ).toMatch(/conversazione nuova/i);
});
