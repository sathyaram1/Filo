// Verifica #1722 giro 2, rilievo 1: il fumetto, nato all'avvio, ora si carica da filo://shell, e le prove che cercano la
// finestra principale come «la prima pagina filo://shell/» prendono lui (net-error-page e contatori-anonimi, scheda caduta:
// rosse sempre). Qui il passo comune: la prima pagina filo://shell/ sta nella finestra che ha le schede.
import { test, expect } from '../../fixtures/electron.mjs';

test('r1 la prima pagina filo://shell/ che una prova trova sta nella finestra delle schede, non nel fumetto', async ({ app, openTab, testServer }) => {
  await openTab(testServer.html('<!doctype html><title>viva</title><p>contenuto</p>'));
  const esito = await app.evaluate(({ webContents, BrowserWindow }) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith('filo://shell/'));
    const win = wc && BrowserWindow.fromWebContents(wc);
    return { url: wc ? wc.getURL() : null, conSchede: !!(win && win._filoTabs) };
  });
  expect(esito, `presa: ${esito.url}`).toMatchObject({ conSchede: true });
});
