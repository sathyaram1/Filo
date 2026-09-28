// Verifica #591, giro 18 — la domanda dei permessi accetta un clic arrivato un attimo dopo che è comparsa, nel punto
// dove prima c'era la pagina: col doppio clic su un pulsante in alto a destra la pagina si prende microfono e fotocamera.
// Dispositivi finti; l'indirizzo di prova è trattato come https.

import { test, expect, _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';
import { chiudiApp } from '../../fixtures/electron.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HOST = 'esca-giro18.test';
const esiti = [];
const ESCA = `<!doctype html><meta charset="utf-8"><title>Verifica</title>
<style>body{margin:0;font:16px sans-serif} #esca{position:fixed;top:0;right:0;width:260px;height:48px;background:#2a7;color:#fff;border:0}</style>
<button id="esca">Fai doppio clic per continuare</button>
<script>
  document.getElementById('esca').addEventListener('mousedown', () => {
    navigator.mediaDevices.getUserMedia({ audio: true, video: true }).then(
      (s) => fetch('/esito?m=' + encodeURIComponent('concesso:' + s.getTracks().map((t) => t.kind).sort().join(','))),
      (e) => fetch('/esito?m=' + encodeURIComponent('negato:' + e.name)),
    );
  }, { once: true });
</script>`;

let server;
let porta;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/esito') { esiti.push(u.searchParams.get('m')); res.end('ok'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(ESCA);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  porta = server.address().port;
});
test.afterAll(async () => {
  try { server.closeAllConnections?.(); } catch (_) {}
  await new Promise((ok) => server.close(ok));
});

function limitiVista(app) {
  return app.evaluate(({ BrowserWindow }, host) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const t = w._filoTabs && w._filoTabs.tabs.find((x) => x.view && x.view.webContents.getURL().includes(host));
      if (t) return t.view.getBounds();
    }
    return null;
  }, HOST);
}

test('il secondo clic di un doppio clic sulla pagina non diventa «Consenti» nella domanda comparsa sotto il cursore', async () => {
  test.setTimeout(90_000);
  const userData = cartellaTemporanea('filo-verifica-591-');
  const app = await electron.launch({
    args: [...argomentiScala, `--host-resolver-rules=MAP ${HOST} 127.0.0.1`, '--use-fake-device-for-media-stream',
      `--unsafely-treat-insecure-origin-as-secure=http://${HOST}:${porta}`, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await new Promise((ok) => setTimeout(ok, 800));
    esiti.length = 0;
    await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${HOST}:${porta}/`);
    let pagina = null;
    await expect.poll(() => { pagina = app.context().pages().find((p) => p.url().includes(HOST)); return Boolean(pagina); }, { timeout: 15_000 }).toBe(true);
    await pagina.waitForLoadState('load');
    await new Promise((ok) => setTimeout(ok, 600));
    const vista = await limitiVista(app);
    const box = await pagina.locator('#esca').boundingBox();
    const px = box.x + box.width - 40;
    const py = box.y + box.height / 2;
    // Lo stesso punto dello schermo, nelle coordinate della cornice.
    const X = px + vista.x;
    const Y = py + vista.y;

    const t0 = Date.now();
    await pagina.mouse.click(px, py);
    await shell.locator('#permesso-bar').waitFor({ state: 'visible', timeout: 5000 });
    const comparsa = Date.now() - t0;
    const sotto = await shell.evaluate(([x, y]) => document.elementFromPoint(x, y)?.textContent || '', [X, Y]);
    // Il secondo clic di un doppio clic arriva un paio di decimi di secondo dopo il primo.
    await new Promise((ok) => setTimeout(ok, Math.max(0, 300 - (Date.now() - t0))));
    await shell.mouse.click(X, Y);
    const secondo = Date.now() - t0;
    console.log(`domanda comparsa dopo ${comparsa} ms, sotto il cursore «${sotto}», secondo clic a ${secondo} ms`);
    expect(secondo, 'il secondo clic è arrivato nei tempi di un doppio clic').toBeLessThan(500);

    await new Promise((ok) => setTimeout(ok, 2500));
    expect(esiti.filter((e) => e.startsWith('concesso')),
      'microfono e fotocamera concessi da un clic arrivato prima che l\'utente potesse leggere la domanda').toEqual([]);
  } finally {
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
