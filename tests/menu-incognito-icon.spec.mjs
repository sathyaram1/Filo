// Feedback 31C6 (newtab): "aggiungi la modalità in incognito … deve poter
// essere attivata da impostazioni/sicurezza o con un'icona nel tasto destro
// (una delle icone nel menu secondario)".
//
// L'infrastruttura incognito (finestra effimera, sessione in RAM, voce nel menu
// Impostazioni) era già presente, ma l'ICONA — il secondo ingresso
// esplicitamente richiesto — non compariva mai: l'azione era nel registry ma
// assente dal layout di default delle icone, quindi nessun utente la vedeva.
// Da #871/#1246 le icone stanno nella barra laterale: questi test asseriscono
// che l'icona è lì di serie e che, cliccandola, si apre davvero una finestra
// incognito.

import { test, expect } from './fixtures/electron.mjs';
import { iconaDellaBarra, statoBarra } from './helpers/barra.mjs';

const HTML = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <h1>Filo test page</h1>
  <p>Una pagina qualsiasi.</p>
</body></html>`;

test("l'icona incognito è nella barra laterale, in vista", async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, HTML);
  const btn = await iconaDellaBarra(app, 'incognito');
  await expect(btn).toHaveAttribute('data-zona', 'bar');
  expect((await statoBarra(app)).altroAperto).toBe(false);
});

test("cliccando l'icona incognito si apre una finestra incognito", async ({ openTab, testServer, app }) => {
  await testServer.openReady(openTab, HTML);
  await (await iconaDellaBarra(app, 'incognito')).click();

  // La finestra incognito carica filo://shell/shell.html?incognito=1.
  await expect.poll(() => app.windows().some((w) => { try { return w.url().includes('incognito=1'); } catch (_) { return false; } }),
    { timeout: 5_000, message: 'finestra incognito non aperta dopo click sull\'icona' }).toBe(true);
});
