// Verifica #589 — giro 5, rilievo 2 (nato nel giro 3: stesse prove, ancora rosse).
// Il magazzino dei dati, chiesto da un sito per nome di scomparto, consegna e si
// lascia riscrivere tutto quello che non sono le impostazioni.

import { test, expect } from '../../fixtures/electron.mjs';

const MEMORIA = 'Anna, vive a MILANO-GIRO3-589, lavora in ospedale';
const PAGINA_SALVATA = 'CONTO-CORRENTE-GIRO3-589';

// Prepara i dati personali che un utente ha davvero dentro Filo.
async function datiPersonali(shell) {
  await shell.evaluate(async (memoria) => {
    const m = (x) => window.filoShell.message(x);
    await m({ type: '_storage:set', obj: { filo_memory: { PROFILO: memoria } } });
    await m({
      type: 'save_page',
      page: { url: 'https://banca.example/conto', title: 'CONTO-CORRENTE-GIRO3-589', text: 'saldo' },
    });
  }, MEMORIA);
}

// Una richiesta fatta come la farebbe il codice che gira DENTRO una certa
// pagina: il mittente è costruito dal suo webContents esattamente come lo
// costruisce il canale interno di Filo.
function chiediDaQuellaPagina(app, riconosci) {
  return (messaggio) => app.evaluate(async ({ BrowserWindow }, { src, msg }) => {
    const H = globalThis.__filoHandlers;
    // eslint-disable-next-line no-new-func
    const scegli = new Function('u', `return (${src})(u);`);
    let wc = null; let win = null; let tab = null;
    for (const w of BrowserWindow.getAllWindows()) {
      for (const t of (w._filoTabs?.tabs || [])) {
        let u = ''; try { u = t.view.webContents.getURL(); } catch (_) { u = ''; }
        if (scegli(u)) { wc = t.view.webContents; win = w; tab = t; }
      }
      if (!wc) {
        let u = ''; try { u = w.webContents.getURL(); } catch (_) { u = ''; }
        if (scegli(u)) { wc = w.webContents; win = w; }
      }
    }
    if (!wc) return { nonTrovata: true };
    const sender = {
      tab: tab ? { id: tab.id, url: tab.url, title: tab.title } : null,
      url: wc.getURL(),
      isShell: win ? win.webContents === wc : false,
      win: win || null,
      isIncognito: !!win?._filoIncognito,
      wc,
      frame: wc.mainFrame || null,
    };
    try {
      return { origine: sender.tab?.url || sender.url || '', risposta: await H.handleMessage(msg, sender) };
    } catch (e) { return { origine: sender.tab?.url || sender.url || '', errore: String(e) }; }
  }, { src: riconosci, msg: messaggio });
}

// ── Porta 2a: il magazzino dei dati, chiesto per nome di scomparto ─────────
test('un sito non si porta via i dati personali chiedendoli al magazzino per nome', async ({ app, shell, openTab, testServer }) => {
  await datiPersonali(shell);
  const web = await testServer.openReady(openTab, '<h1>sito qualunque</h1>');
  const suSito = `(u) => /^http:\\/\\/127\\.0\\.0\\.1/.test(String(u))`;
  const chiedi = chiediDaQuellaPagina(app, suSito);

  const lettura = await chiedi({
    type: '_storage:get',
    keys: ['filo_memory', 'savedPages', 'aiHistory', 'downloads', 'archivedTabs', 'costs', 'filo_notes'],
  });
  expect(lettura.nonTrovata).toBeFalsy();
  const dump = JSON.stringify(lettura.risposta ?? null);
  expect(
    dump,
    'quello che Filo ha imparato sull\'utente è uscito verso il sito passando dal magazzino dei dati',
  ).not.toContain('MILANO-GIRO3-589');
  expect(
    dump,
    'le pagine che l\'utente ha messo da parte sono uscite verso il sito passando dal magazzino dei dati',
  ).not.toContain(PAGINA_SALVATA);
});

// ── Porta 2b: e lo stesso magazzino si lascia anche riscrivere ─────────────
test('un sito non riscrive la memoria di Filo né cancella le pagine salvate', async ({ app, shell, openTab, testServer }) => {
  await datiPersonali(shell);
  const web = await testServer.openReady(openTab, '<h1>sito qualunque</h1>');
  const suSito = `(u) => /^http:\\/\\/127\\.0\\.0\\.1/.test(String(u))`;
  const chiedi = chiediDaQuellaPagina(app, suSito);

  await chiedi({
    type: '_storage:set',
    obj: { filo_memory: { PROFILO: 'DETTATO-DAL-SITO-GIRO3-589' } },
  });
  await chiedi({ type: '_storage:remove', keys: ['savedPages'] });

  const dopo = await shell.evaluate(async () => {
    const m = (x) => window.filoShell.message(x);
    const mem = await m({ type: '_storage:get', keys: ['filo_memory'] });
    const sal = await m({ type: 'get_saved_pages' });
    const pagine = sal?.pages || sal?.items || sal?.savedPages || [];
    return { memoria: JSON.stringify(mem?.value?.filo_memory ?? null), quante: Array.isArray(pagine) ? pagine.length : -1 };
  });

  expect(
    dopo.memoria,
    'un sito ha riscritto quello che Filo ha imparato sull\'utente (e da lì parla a ogni conversazione futura)',
  ).not.toContain('DETTATO-DAL-SITO-GIRO3-589');
  expect(dopo.memoria, 'la memoria dell\'utente è stata sovrascritta da un sito').toContain('MILANO-GIRO3-589');
  expect(
    dopo.quante,
    'un sito ha cancellato tutte le pagine che l\'utente aveva messo da parte',
  ).toBeGreaterThan(0);
});
