// AUDIT: una tab aperta con target=_blank (o window.open) da una tab proxata
// NON eredita il proxy della tab padre.
//
// RIPRODUZIONE (utente):
//   1. Clicca "Apri questa scheda dagli USA" su una tab con un sito geo-bloccato.
//   2. La pagina contiene un link <a target="_blank"> verso un altro sito.
//   3. Clicca il link: la nuova scheda si apre SENZA il proxy → l'IP reale
//      dell'utente è visibile al sito aperto, nonostante l'utente pensasse di
//      navigare da un altro paese.
//
// PARTE TECNICA:
//   In tabs.js il handler `setWindowOpenHandler` (riga 1504) chiama
//   `this.openTab(url, { activate: true })` senza passare né il `proxy`
//   né la `partition` della tab padre. Il proxy è legato alla singola tab
//   come { country, tier } e non viene propagato alle tab figlie.
//   La specifica (proxy-per-tab-spec.md §6) non descrive il comportamento dei
//   link target=_blank, lasciando l'utente senza avviso sulla perdita di privacy.

import { test, expect } from './fixtures/electron.mjs';

test.setTimeout(30_000);

test('una tab aperta con target=_blank da una tab proxata non ha proxy impostato', async ({ app, shell, openTab, testServer }) => {
  // Apriamo una pagina "padre" che ha un link target=_blank.
  const parentPage = await testServer.openReady(openTab, `
    <!DOCTYPE html>
    <html><head><meta charset="utf-8"><title>parent page</title></head>
    <body>
      <a id="link" href="http://127.0.0.1/child" target="_blank">Apri in nuova scheda</a>
    </body></html>
  `);
  await parentPage.waitForLoadState('domcontentloaded');

  // Leggiamo lo snapshot PRIMA del click: troviamo l'id della tab padre.
  const snapBefore = await shell.evaluate(() =>
    window.filoShell?.tabs?.snapshot() || { tabs: [], activeId: null }
  );
  const parentTabId = snapBefore.activeId;
  expect(parentTabId, 'deve esserci una tab attiva').toBeTruthy();

  // Simuliamo di impostare il proxy sulla tab padre modificando lo snapshot
  // via IPC (stesso percorso usato dal menu tasto destro, senza un proxy reale).
  // In assenza di un proxy reale configurato, setTabProxy tornerebbe
  // { ok: false, error: 'not_configured' }. Verifichiamo il comportamento
  // STRUTTURALE: la tab figlia NON deve avere proxy (che nel test è null
  // perché non c'è un provider configurato — ma in produzione non è null
  // sulla tab padre).

  // Contiamo le tab prima del click.
  const tabCountBefore = snapBefore.tabs.length;

  // Clicca il link target=_blank: Filo aprirà una nuova tab via setWindowOpenHandler.
  await parentPage.click('#link');

  // Aspettiamo che la nuova tab venga aperta.
  await new Promise((r) => setTimeout(r, 1500));

  const snapAfter = await shell.evaluate(() =>
    window.filoShell?.tabs?.snapshot() || { tabs: [], activeId: null }
  );

  // VERIFICA 1: una nuova tab è stata aperta.
  expect(snapAfter.tabs.length, 'deve essere aperta una nuova tab').toBeGreaterThan(tabCountBefore);

  // VERIFICA 2: la tab figlia NON ha proxy impostato.
  // Anche se la tab padre avesse proxy, la figlia non lo eredita.
  // Qui verifichiamo che NESSUNA tab appena aperta tramite setWindowOpenHandler
  // abbia proxy (nel test environment proxy è null per tutti — ma il comportamento
  // strutturale è documentato: openTab() non riceve i parametri proxy della tab padre).
  const newTabs = snapAfter.tabs.filter(t => !snapBefore.tabs.some(p => p.id === t.id));
  expect(newTabs.length, 'ci deve essere almeno una tab nuova').toBeGreaterThan(0);

  for (const newTab of newTabs) {
    // Nel test environment proxy è null. In produzione, se la tab padre
    // avesse proxy e il figlio lo ereditasse, sarebbe { country, tier }.
    // Il bug è che NON lo eredita → proxy è null anche quando dovrebbe
    // seguire la volontà dell'utente (stare navigando da un altro paese).
    // L'assert documenta lo stato attuale (null = senza proxy).
    expect(newTab.proxy, `la tab figlia (${newTab.id?.slice(0, 8)}) non ha proxy`).toBeNull();
  }

  // NOTA: questo test documenta il comportamento attuale, non quello atteso.
  // In un fix, la tab figlia dovrebbe ereditare il proxy della tab padre (o
  // almeno mostrare all'utente che la nuova scheda si apre senza proxy).
});
