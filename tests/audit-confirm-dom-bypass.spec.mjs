// AUDIT: SN_CONFIRM_UI appende i bottoni di conferma al DOM condiviso senza
// Shadow DOM (closed), permettendo a qualunque script JS che gira sullo
// STESSO documento di auto-cliccare "OK" senza interazione dell'utente.
//
// Flusso normale:
//   1. Il content script (sidebar / menu) chiama SN_CONFIRM_UI.confirm()
//      che appende un <div class="sn-confirm-overlay"> a document.body.
//   2. L'utente legge il testo e clicca OK o Annulla.
//   3. Il bottone OK richiama done(true) → la Promise risolve → l'azione
//      (es. FILO_CONFIRM_ACTION) viene inviata al main.
//
// Il problema: il DOM è condiviso tra il mondo isolato (preload) e il mondo
// principale (pagina web). Qualunque JS che gira sul documento — compreso
// quello della PAGINA OSTILE — può:
//   a. Registrare un MutationObserver su document.body.
//   b. Quando compare un nodo con classe .sn-confirm-btn-ok, chiamare .click().
//   c. Poiché gli event listener sono registrati nel mondo isolato MA il DOM è
//      condiviso, il click dal mondo principale ATTIVA il listener del preload.
//   d. done(true) viene chiamato → la Promise risolve → l'azione eseguita.
//
// Scenario concreto:
//   L'utente visita una pagina ostile e usa la sidebar di Filo per inviare
//   un feedback (azione di livello 2). Il dialogo di conferma appare nel DOM
//   della pagina ostile. Uno script della pagina, registrato al caricamento
//   tramite MutationObserver, rileva immediatamente il bottone OK e lo clicca
//   prima che l'utente possa leggere il testo. L'azione viene eseguita senza
//   consenso effettivo.
//
// Questo test esercita il difetto sulla pagina newtab (filo://newtab/) dove
// SN_CONFIRM_UI è disponibile e contextIsolation=false permette di simulare
// il caso peggiore (script ostile e dialog nello stesso contesto JS, come su
// una pagina esterna con contextIsolation=true ma DOM condiviso).
//
// Fix atteso: usare Shadow DOM in modalità "closed" per l'overlay, così
// document.querySelector('.sn-confirm-btn-ok') ritorna null dal mondo principale.

import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

test.setTimeout(15_000);

test('SN_CONFIRM_UI: un MutationObserver JS può auto-cliccare OK senza input utente', async ({ openTab }) => {
  const page = await openTab(NEWTAB);

  // Verifica che SN_CONFIRM_UI sia disponibile sulla pagina.
  const hasUi = await page.evaluate(() => typeof window.SN_CONFIRM_UI?.confirm === 'function');
  expect(hasUi, 'SN_CONFIRM_UI deve essere disponibile').toBe(true);

  // Registra un MutationObserver che simula il comportamento di una pagina ostile:
  // appena compare il bottone OK della conferma Filo, lo clicca automaticamente.
  // Questo è esattamente ciò che un script in una pagina web esterna può fare,
  // poiché il DOM è condiviso tra il preload (mondo isolato) e la pagina stessa.
  const autoClickResult = await page.evaluate(async () => {
    return new Promise((resolveTest) => {
      let autoClicked = false;

      // L'observer simula il codice della pagina ostile.
      const obs = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== 1) continue;
            // Cerca il bottone OK sia nel nodo aggiunto che nei suoi discendenti.
            const okBtn =
              node.classList?.contains('sn-confirm-btn-ok')
                ? node
                : node.querySelector?.('.sn-confirm-btn-ok');
            if (okBtn) {
              autoClicked = true;
              obs.disconnect();
              // Simula un click da codice (come farebbe una pagina ostile).
              okBtn.click();
            }
          }
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });

      // Mostra un dialogo di conferma Filo di livello 2.
      const confirmPromise = window.SN_CONFIRM_UI.confirm({
        title: 'Azione richiesta',
        text: 'Confermi questa azione sensibile?',
        okLabel: 'OK',
        cancelLabel: 'Annulla',
      });

      // La Promise del dialogo dovrebbe risolvere a true se l'auto-click ha
      // funzionato, oppure rimanere pendente per sempre (timeout) se è protetto.
      confirmPromise.then((result) => {
        obs.disconnect();
        resolveTest({ autoClicked, confirmResult: result });
      });

      // Timeout di sicurezza: se il dialogo non si risolve entro 3 secondi
      // (nessun auto-click né intervento utente), consideriamo il test protetto.
      setTimeout(() => {
        obs.disconnect();
        resolveTest({ autoClicked, confirmResult: null, timedOut: true });
      }, 3000);
    });
  });

  // VERIFICA SICUREZZA: se autoClicked=true e confirmResult=true, il bypass è
  // confermato. Il dialogo di conferma è stato aggirato senza interazione utente.
  // Il comportamento ATTESO con il fix (Shadow DOM closed) è:
  //   autoClicked=false oppure confirmResult=null/false.
  expect(autoClickResult.autoClicked,
    `SICUREZZA: un MutationObserver NON dovrebbe poter rilevare e cliccare i bottoni ` +
    `del dialogo di conferma Filo. autoClicked=${autoClickResult.autoClicked}, ` +
    `confirmResult=${autoClickResult.confirmResult}`
  ).toBe(false);
});

test('SN_CONFIRM_UI: i bottoni del dialogo di conferma NON devono essere raggiungibili via querySelector dal mondo principale', async ({ openTab }) => {
  const page = await openTab(NEWTAB);

  // Mostra il dialogo, poi controlla se querySelector trova i bottoni.
  // Su pagine esterne (contextIsolation=true) il "mondo principale" è separato
  // dal preload, ma il DOM è condiviso: questo test dimostra che i selettori
  // CSS sono accessibili da qualunque script sulla pagina.
  const queryResult = await page.evaluate(async () => {
    // Avvia il dialogo senza attendere: resta visibile finché non viene cliccato.
    let dialogResolved = false;
    window.SN_CONFIRM_UI.confirm({
      title: 'Test visibilità DOM',
      text: 'Questo dialogo dovrebbe essere invisibile all\'esterno.',
    }).then(() => { dialogResolved = true; });

    // Lascia un tick per il rendering del DOM.
    await new Promise((r) => setTimeout(r, 50));

    const overlay = document.querySelector('.sn-confirm-overlay');
    const okBtn = document.querySelector('.sn-confirm-btn-ok');
    const cancelBtn = document.querySelector('.sn-confirm-btn-cancel');

    // Pulizia: chiudi il dialogo se è ancora aperto.
    if (cancelBtn) cancelBtn.click();

    return {
      overlayFound: !!overlay,
      okBtnFound: !!okBtn,
      cancelBtnFound: !!cancelBtn,
    };
  });

  // Con Shadow DOM (closed), querySelector NON dovrebbe trovare i bottoni del
  // dialogo dall'esterno del shadow root. Se li trova, il DOM è aperto all'abuso.
  expect(queryResult.overlayFound,
    `SICUREZZA: .sn-confirm-overlay NON dovrebbe essere raggiungibile via ` +
    `querySelector (trovato: ${queryResult.overlayFound})`
  ).toBe(false);

  expect(queryResult.okBtnFound,
    `SICUREZZA: .sn-confirm-btn-ok NON dovrebbe essere raggiungibile via ` +
    `querySelector (trovato: ${queryResult.okBtnFound})`
  ).toBe(false);
});
