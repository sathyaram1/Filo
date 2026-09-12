// Verifica #589 — giro 3.
//
// Il giro 1 e il giro 2 hanno chiuso la strada verso i siti per le
// impostazioni (la spinta è ridotta come le letture) e per le domande che un
// sito fa al cuore di Filo (memoria, pagine salvate, stato, uscita
// dall'account). Le loro prove stanno accanto a questa e restano verdi.
//
// Qui si guarda la stessa strada da due porte che quel riparo non copre.
//
//  1. Il riparo riconosce «un sito» dall'indirizzo che comincia per http o
//     https. Tutto il resto lo tratta come una superficie di Filo — e una
//     pagina di un sito sa portarsi da sola su un indirizzo che non comincia
//     così (uno che si è fabbricato lei, o la pagina vuota di una scheda che
//     apre lei). Lì dentro il codice di Filo gira come su ogni altra pagina, e
//     da lì il canale risponde di nuovo a tutto.
//
//  2. Il riparo elenca le DOMANDE ammesse, ma non guarda che cosa una domanda
//     ammessa può toccare. Fra le ammesse c'è il magazzino dei dati (serve ai
//     pezzi di Filo dentro le pagine per il dizionario personale, la bozza del
//     feedback e la disposizione delle icone): chiedendo gli altri scomparti
//     per nome, un sito si porta via — e riscrive — quello che il giro 2 aveva
//     appena chiuso. E la fotografia della scheda, anch'essa ammessa, inquadra
//     la scheda che l'utente sta guardando, non quella di chi la chiede.
//
// Come nei giri precedenti, le richieste partono con l'indirizzo della pagina,
// come le farebbe il codice che Filo carica lì dentro: il modello di minaccia è
// quello della segnalazione (difesa in profondità, non furto immediato).

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

// ── Porta 1a: la pagina che il sito si fabbrica da sé ──────────────────────
test('un sito che si porta su un indirizzo fabbricato da lui non torna dentro Filo', async ({ app, shell, openTab, testServer }) => {
  await datiPersonali(shell);
  const web = await testServer.openReady(openTab, '<h1>sito qualunque</h1>');

  // Il sito compone una pagina sua e ci si porta sopra: resta suo codice, su
  // un indirizzo che non comincia per http.
  await web.evaluate(() => {
    const html = '<!doctype html><meta charset="utf-8"><h1>pagina del sito</h1>'
      + '<script>window.__miaPagina = 1;</' + 'script>';
    location.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  });
  const suBlob = `(u) => String(u).startsWith('blob:')`;
  await expect.poll(
    () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .flatMap((w) => (w._filoTabs?.tabs || []).map((t) => String(t.url || '')))
      .some((u) => u.startsWith('blob:'))),
    { timeout: 10000 },
  ).toBe(true);

  const chiedi = chiediDaQuellaPagina(app, suBlob);

  const memoria = await chiedi({ type: 'filo_get_memory' });
  expect(memoria.nonTrovata, 'la pagina fabbricata dal sito non è stata trovata: la prova non guarda quello che deve').toBeFalsy();
  expect(
    JSON.stringify(memoria.risposta ?? null),
    'quello che Filo ha imparato sull\'utente è stato consegnato alla pagina che il sito si è fabbricato',
  ).not.toContain('MILANO-GIRO3-589');
  expect(memoria.risposta?.ok, 'da lì il canale ha risposto a una domanda che a un sito non compete').not.toBe(true);

  const salvate = await chiedi({ type: 'get_saved_pages' });
  expect(JSON.stringify(salvate.risposta ?? null)).not.toContain(PAGINA_SALVATA);

  const uscita = await chiedi({ type: 'auth_signout' });
  expect(uscita.risposta?.ok, 'da lì il sito ha potuto chiudere la sessione dell\'account').not.toBe(true);
});

// ── Porta 1b: la scheda vuota che il sito apre ─────────────────────────────
test('la scheda vuota aperta dal sito non è una superficie di Filo', async ({ app, shell, openTab, testServer }) => {
  await datiPersonali(shell);
  const web = await testServer.openReady(openTab, '<h1>sito qualunque</h1>');

  await web.evaluate(() => {
    const w = window.open('about:blank', '_blank');
    try { w.document.write('<h1>pagina del sito</h1>'); } catch (_) {}
  });
  const suVuota = `(u) => String(u) === 'about:blank'`;
  await expect.poll(
    () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .flatMap((w) => [
        ...(w._filoTabs?.tabs || []).map((t) => { try { return t.view.webContents.getURL(); } catch (_) { return ''; } }),
        (() => { try { return w.webContents.getURL(); } catch (_) { return ''; } })(),
      ])
      .some((u) => String(u) === 'about:blank')),
    { timeout: 10000 },
  ).toBe(true);

  const chiedi = chiediDaQuellaPagina(app, suVuota);
  const memoria = await chiedi({ type: 'filo_get_memory' });
  expect(memoria.nonTrovata, 'la scheda vuota non è stata trovata: la prova non guarda quello che deve').toBeFalsy();
  expect(
    JSON.stringify(memoria.risposta ?? null),
    'quello che Filo ha imparato sull\'utente è stato consegnato alla scheda vuota aperta dal sito',
  ).not.toContain('MILANO-GIRO3-589');
  expect(memoria.risposta?.ok, 'dalla scheda vuota il canale ha risposto a una domanda che a un sito non compete').not.toBe(true);
});

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

// ── Porta 2c: la fotografia della scheda ───────────────────────────────────
test('una scheda di sfondo non fotografa la scheda che l\'utente sta guardando', async ({ app, openTab, testServer }) => {
  const sito = await testServer.openReady(openTab, '<style>html,body{background:#0000ff;margin:0}</style><h1>sito</h1>');
  const sitoUrl = sito.url();
  // L'utente passa a un'altra scheda: quella davanti agli occhi è questa.
  const altra = await testServer.openReady(openTab, '<style>html,body{background:#ff0000;margin:0}</style><h1>banca</h1>');
  await expect.poll(
    () => app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      const t = (w._filoTabs?.tabs || []).find((x) => x.id === w._filoTabs.activeId);
      return t ? String(t.url || '') : '';
    }),
    { timeout: 8000 },
  ).not.toBe(sitoUrl);

  const suSito = `(u) => String(u) === ${JSON.stringify(sitoUrl)}`;
  const scatto = await chiediDaQuellaPagina(app, suSito)({ type: 'capture_visible_tab' });
  expect(scatto.nonTrovata, 'la scheda del sito non è stata trovata: la prova non guarda quello che deve').toBeFalsy();

  const dataUrl = scatto.risposta?.dataUrl || '';
  if (!dataUrl) return; // niente foto: niente da far uscire.

  // Che cosa c'è nella foto: il pixel al centro, letto dal processo principale
  // (nessuna pagina di mezzo, così la lettura non dipende da quello che una
  // pagina può caricare).
  const colore = await app.evaluate(({ nativeImage }, u) => {
    const img = nativeImage.createFromDataURL(u);
    const { width, height } = img.getSize();
    if (!width || !height) return null;
    const bmp = img.toBitmap(); // BGRA
    const i = ((Math.floor(height / 2) * width) + Math.floor(width / 2)) * 4;
    return { r: bmp[i + 2], g: bmp[i + 1], b: bmp[i] };
  }, dataUrl);
  if (!colore) return;

  expect(
    colore.r > 200 && colore.g < 60 && colore.b < 60,
    'la scheda di sfondo si è fatta dare la fotografia della pagina che l\'utente stava guardando',
  ).toBe(false);
});
