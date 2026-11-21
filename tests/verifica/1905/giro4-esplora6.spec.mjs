// Esplorazione del giro 4 di #1905: un file che manca, raggiunto da un collegamento della pagina o ricaricando.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { home } from '../../helpers/chatFinta.mjs';
import { paginaDellaScheda } from '../../helpers/schede.mjs';

const SHOTS = join(process.cwd(), 'tests', '.shots');
const scatta = async (app, id, nome) => {
  const png = await app.evaluate(async ({ BrowserWindow }, i) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.find((x) => x.id === i);
    return (await t.view.webContents.capturePage()).toPNG().toString('base64');
  }, id);
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(join(SHOTS, nome), Buffer.from(png, 'base64'));
};
const stato = (app, id) => app.evaluate(({ BrowserWindow }, i) => {
  const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.find((x) => x.id === i);
  return `${t.view.webContents.getURL()} | ${t.view.webContents.getTitle()}`;
}, id);

test('collegamento a un file che manca, e ricarica dopo averlo tolto', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = join(cartellaTemporanea('g4z-'), 'report');
  mkdirSync(dir, { recursive: true });
  const f = join(dir, 'indice.html');
  writeFileSync(f, '<!doctype html><title>Indice z</title><body><a id="a" href="manca.html">capitolo che manca</a></body>');
  await home(app);
  const r = await app.evaluate((_e, f) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url: f }, { parole: `aprimi ${f}` }), f);
  expect(r.executed).toBe(true);
  let id = null;
  await expect.poll(async () => (id = await app.evaluate(({ BrowserWindow }) => { const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs; const s = t.tabs.find((x) => String(x.url).startsWith('file:')); return s ? s.id : null; })), { timeout: 10_000 }).toBeTruthy();
  await app.evaluate(({ BrowserWindow }, i) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.activate(i), id);
  const pagina = await paginaDellaScheda(app, id, (p) => p.url().startsWith('file:'));
  await pagina.waitForTimeout(1000);
  await pagina.click('#a');
  await pagina.waitForTimeout(2000);
  console.log('LINK MANCA', await stato(app, id));
  await scatta(app, id, 'g4-link-manca.png');
  await app.evaluate(({ BrowserWindow }, i) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.navigaCronologia(-1, i), id);
  await new Promise((ok) => setTimeout(ok, 1500));
  rmSync(f);
  await app.evaluate(({ BrowserWindow }, i) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.reload(i), id);
  await new Promise((ok) => setTimeout(ok, 2000));
  console.log('RICARICA TOLTO', await stato(app, id));
  await scatta(app, id, 'g4-ricarica-tolto.png');
});
