// Verifica #592.6 — giro 7, rilievo 1. Con la domanda di Filo a schermo, il sito apre da sé (senza gesto) una
// finestra «di accesso» posata sul popup vero, col testo finto: il testo vero sparisce sotto, l'OK vero resta.

import { test, expect } from '../../fixtures/electron.mjs';
import { confermaSopraPagina, nelMondoDiFilo } from '../../helpers/confirm.mjs';

test.setTimeout(90_000);

const FINTO = `<!doctype html><html><head><title>Filo</title></head><body style="margin:0;background:#f8f6f0;font:14px sans-serif;color:#1a1918;padding:16px 20px">
<div style="font-weight:600;margin-bottom:8px">Filo chiede conferma</div>
<div>Filo vuole impostare: Tema → Scuro.</div></body></html>`;

const interseca = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('r1 con la domanda a schermo, una finestra aperta dal sito non si posa sopra il popup', async ({ app, openTab, testServer }) => {
  const finto = testServer.html(FINTO);
  const page = await testServer.openReady(openTab, '<h1>Ricette</h1>');
  const host = new URL(page.url()).hostname;
  await nelMondoDiFilo(app, host, `(() => { globalThis.__ok = null;
    SN_CONFIRM_UI.confirm({ title: 'Filo chiede conferma', text: 'Invio agli sviluppatori il testo: «la mia password è 1234»' }).then((v) => { globalThis.__ok = v; }); return 1; })()`);
  const vista = await confermaSopraPagina(app);
  await new Promise((r) => setTimeout(r, 600));
  const ok = await vista.evaluate(() => window.SN_CONFIRM_UI._test.point('ok'));
  const geo = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    return { cb: w.getContentBounds(), vb: w._filoTabs.conferme.vista.getBounds() };
  });
  // Lo schermo del popup vero, in coordinate dello schermo: il sito le ricava da screenX e dalla sua finestra.
  const popup = { x: geo.cb.x + geo.vb.x + ok.x - 440, y: geo.cb.y + geo.vb.y + ok.y - 130, width: 460, height: 150 };
  // Nessun gesto: page.evaluate gira senza attivazione dell'utente.
  await page.evaluate(({ u, r }) => {
    window.open(`${u}?client_id=a&redirect_uri=b`, 'f', `popup,left=${r.x},top=${r.y},width=${r.width},height=100`);
  }, { u: finto, r: popup });
  await new Promise((r) => setTimeout(r, 2500));
  const finestre = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .filter((w) => !w._filoTabs && w.isVisible() && /^https?:/.test(w.webContents.getURL()))
    .map((w) => w.getBounds()));
  const domandaAperta = await nelMondoDiFilo(app, host, 'globalThis.__ok === null');
  const coperta = domandaAperta && finestre.some((b) => interseca(b, popup));
  expect(coperta, `finestre del sito sopra il popup ancora aperto: ${JSON.stringify(finestre)} su ${JSON.stringify(popup)}`).toBe(false);
});
