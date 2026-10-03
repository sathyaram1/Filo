// Verifica #866 giro 1 — riaprire Filo con le schede di prima non è aprire pagine: il filo non deve
// registrare una visita nuova per ogni scheda ripristinata a ogni avvio.
import { test, expect, chiudiApp, argomentiScala } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const eventi = (ud) => { const f = join(ud, 'filo', 'eventi.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((r) => JSON.parse(r)) : []; };

async function avvia(userData) {
  const app = await electron.launch({ args: [...argomentiScala, '.'], cwd: APP_ROOT, env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' } });
  const shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
  return { app, shell };
}

test('due schede ripristinate al riavvio non diventano due pagine visitate in più', async () => {
  test.setTimeout(120_000);
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<!doctype html><title>Pagina ${req.url}</title><p>x</p>`); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const urls = [`${base}/uno`, `${base}/due`];
  const userData = cartellaTemporanea('filo-866-verifica-ripristino-');
  let { app, shell } = await avvia(userData);
  const visite = () => eventi(userData).filter((e) => e.tipo === 'navigazione' && urls.includes(e.url)).length;
  try {
    for (const u of urls) await shell.evaluate((x) => window.filoShell.tabs.open(x), u);
    await expect.poll(visite, { timeout: 20_000 }).toBe(2);
    await new Promise((r) => setTimeout(r, 2500));   // la sessione si salva
    await chiudiApp(app, { tetto: 15_000 });
    ({ app, shell } = await avvia(userData));
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .flatMap((w) => (w._filoTabs?.tabs || []).map((t) => t.view.webContents.getURL()))), { timeout: 20_000 })
      .toEqual(expect.arrayContaining(urls));
    await new Promise((r) => setTimeout(r, 4000));
    await app.evaluate(() => globalThis.SN_IL_FILO.quandoFermo());
    expect(visite(), 'il riavvio ha scritto una visita per ogni scheda ripristinata').toBe(2);
  } finally {
    await chiudiApp(app);
    server.close();
    rmSync(userData, { recursive: true, force: true });
  }
});
