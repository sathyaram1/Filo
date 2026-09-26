// #686, primo giro — LO ZOOM È DELL'UTENTE, NON DEL SITO.
//
// Per far vedere il livello nel tasto destro, il menu (che vive nella pagina e
// non ha il motore dello zoom) parla col resto di Filo con due segnali dentro la
// pagina stessa: uno chiede «a quanto sta?», l'altro dice «riportala al 100%».
// La pagina di un sito abita lo stesso posto, quindi può emettere gli stessi
// segnali.
//
// Qui si prova quello che conta per l'utente: dopo che ha ingrandito la pagina,
// il sito NON gli rimette lo zoom dov'era. Senza il freno, un sito che non vuole
// essere ingrandito lo riporta al 100% tutte le volte e la pagina resta
// impossibile da zoomare.

import { test, expect } from '../../fixtures/electron.mjs';

// Un sito che, appena vede un tocco, rimette lo zoom alla dimensione reale.
const SITO_OSTILE = `<!doctype html><html><head><meta charset="utf-8"><title>ostile</title></head>
<body><h1>niente zoom qui</h1>
<script>
  window.__rimetti = function () {
    document.dispatchEvent(new Event('filo:zoom-azzera'));
  };
</script>
</body></html>`;

const execAction = (app, action) =>
  app.evaluate(({ BrowserWindow }, { action }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    return globalThis.SN_EXECUTE_FILO_ACTION(action, { sender: { win, wc: win.webContents } });
  }, { action });

async function percentOf(app, page) {
  const url = await page.evaluate(() => location.href);
  const f = await app.evaluate(({ webContents }, u) => {
    for (const wc of webContents.getAllWebContents()) {
      let here = '';
      try { here = wc.getURL(); } catch (_) {}
      if (here === u) return wc.getZoomFactor();
    }
    return null;
  }, url);
  return f == null ? null : Math.round(f * 100);
}

test('un sito non può disfare lo zoom che l\'utente ha chiesto', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO_OSTILE);

  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 200 });
  await expect.poll(async () => percentOf(app, page)).toBe(200);

  // Il sito prova a rimettere la pagina alla dimensione reale.
  await page.evaluate(() => window.__rimetti());
  await page.waitForTimeout(500);

  // Lo zoom dell'utente è ancora il suo.
  expect(await percentOf(app, page), 'il sito ha riportato la pagina al 100% da solo').toBe(200);
});

// Seconda porta della stessa causa: il segnale «questa pagina si zooma da sé»
// (nato per l'editor di Filo, che scala il foglio invece della finestra) è
// scritto nella pagina, quindi un sito qualunque può mettercelo.
const SITO_CHE_SI_FINGE_EDITOR = `<!doctype html><html><head><meta charset="utf-8"><title>finto editor</title></head>
<body><h1>niente zoom qui</h1>
<script>
  document.documentElement.dataset.filoOwnZoom = '1';
</script>
</body></html>`;

test('un sito non può sottrarsi allo zoom fingendo di zoomarsi da sé — e Filo non deve dire «fatto»', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO_CHE_SI_FINGE_EDITOR);

  const r = await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 200 });
  await page.waitForTimeout(500);

  // Quello che l'utente ha chiesto è successo.
  expect(await percentOf(app, page), 'il sito si è sottratto allo zoom').toBe(200);
  // E se non fosse successo, Filo non deve riferire un «fatto» che non c'è.
  expect(r.output && r.output.zoom, 'Filo riferisce «fatto» a una pagina che non si è mossa').not.toBe('propria');
});
