// Verifica #866 giro 4, rilievo 1: una pagina ancora in caricamento quando si chiude Filo deve restare una pagina visitata.
import { test, expect, chiudiApp, argomentiScala } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const eventi = (u) => {
  const f = join(u, 'filo', 'eventi.jsonl');
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((r) => JSON.parse(r)) : [];
};

test('una pagina aperta e ancora in caricamento quando si chiude Filo resta fra le pagine visitate', async () => {
  test.setTimeout(120_000);
  // Un'immagine che non arriva mai: la pagina si vede, ma il caricamento non finisce (un tracker lento, un video).
  const server = http.createServer((req, res) => {
    if (req.url === '/appeso.png') return;
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><title>Pagina lenta</title><p>testo</p><img src="/appeso.png">');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const userData = cartellaTemporanea('filo-866-g4-chiusura-');
  const app = await electron.launch({
    args: [...argomentiScala, '.'], cwd: APP_ROOT, env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await app.evaluate(() => globalThis.SN_IL_FILO.carica());
    await shell.evaluate((x) => window.filoShell.tabs.open(x), `${base}/lenta`);
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .flatMap((w) => (w._filoTabs?.tabs || []).map((t) => t.view.webContents.getTitle()))), { timeout: 15_000 })
      .toContain('Pagina lenta');
    await new Promise((r) => setTimeout(r, 2500));
    await chiudiApp(app, { tetto: 15_000 });
    expect(eventi(userData).filter((e) => e.tipo === 'navigazione').map((e) => e.url)).toContain(`${base}/lenta`);
  } finally {
    await chiudiApp(app).catch(() => {});
    server.closeAllConnections?.();
    server.close();
    rmSync(userData, { recursive: true, force: true });
  }
});
