// Esplorazione giro 7: una finestra aperta dal sito si posa sopra il popup vero e ne copre il testo.
import { test, expect } from '../../fixtures/electron.mjs';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { confermaSopraPagina, nelMondoDiFilo } from '../../helpers/confirm.mjs';

test.setTimeout(90_000);

const FINTO = `<!doctype html><html><head><title>Filo</title></head><body style="margin:0;background:#f8f6f0;font:14px sans-serif;color:#1a1918;padding:16px 20px">
<div style="font-weight:600;margin-bottom:8px">Filo chiede conferma</div>
<div>Filo vuole impostare: Tema → Scuro.</div></body></html>`;

test('r1 una finestra del sito copre il testo del popup vero', async ({ app, openTab, testServer }) => {
  const finto = testServer.html(FINTO);
  const page = await testServer.openReady(openTab, '<h1>Ricette</h1>');
  const host = new URL(page.url()).hostname;
  await nelMondoDiFilo(app, host, `(() => { globalThis.__ok = null;
    SN_CONFIRM_UI.confirm({ title: 'Filo chiede conferma', text: 'Invio agli sviluppatori il testo: «la mia password è 1234»' }).then((v) => { globalThis.__ok = v; }); return 1; })()`);
  const vista = await confermaSopraPagina(app);
  await new Promise((r) => setTimeout(r, 600));
  const box = await vista.evaluate(() => {
    const p = window.SN_CONFIRM_UI._test.point('ok');
    return p;
  });
  const geo = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const cb = w.getContentBounds();
    const vb = w._filoTabs.conferme.vista.getBounds();
    return { cb, vb };
  });
  // Il sito, senza nessun gesto, apre una finestra «di accesso» posata sul testo del popup.
  const x = geo.cb.x + geo.vb.x + Math.round(geo.vb.width / 2) - 220;
  const y = geo.cb.y + geo.vb.y + box.y - 150;
  const aperta = await page.evaluate(({ u, x, y }) => !!window.open(`${u}?client_id=a&redirect_uri=b`, 'f', `popup,left=${x},top=${y},width=440,height=110`), { u: finto, x, y });
  await new Promise((r) => setTimeout(r, 2500));
  const finestre = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w._filoTabs && w.isVisible()).map((w) => ({ url: w.webContents.getURL(), b: w.getBounds(), focus: w.isFocused() })));
  console.log('aperta', aperta, 'geo', JSON.stringify(geo), 'ok', JSON.stringify(box), 'finestre', JSON.stringify(finestre));
  mkdirSync('tests/.shots', { recursive: true });
  try { execSync('import -window root tests/.shots/giro7-finestra.png'); } catch (e) { console.log('import', e.message); }
  expect(finestre.some((f) => f.url.startsWith(finto))).toBe(true);
});
