// Permessi delle pagine web (#591.1): microfono, fotocamera e appunti li decide l'utente nella cornice della finestra,
// non la pagina. Regole: src/main/services/permessiPagine.js. Dispositivi finti: nessuna periferica vera coinvolta.

import { test, expect, _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { argomentiScala } from './helpers/scala.mjs';
import { chiudiApp } from './fixtures/electron.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const esiti = [];
const PAGINE = {
  '/media': `<!doctype html><meta charset="utf-8"><title>Riunione</title><p>stanza</p>
<script>
  navigator.mediaDevices.getUserMedia({ audio: true, video: true }).then(
    (s) => fetch('/esito?m=' + encodeURIComponent('concesso:' + s.getTracks().map((t) => t.kind).sort().join(','))),
    (e) => fetch('/esito?m=' + encodeURIComponent('negato:' + e.name)),
  );
</script>`,
  '/appunti': `<!doctype html><meta charset="utf-8"><title>Appunti</title><input autofocus>
<script>
  const prova = () => navigator.clipboard.readText().then(
    (x) => fetch('/esito?m=' + encodeURIComponent('letto:' + x)),
    (e) => fetch('/esito?m=' + encodeURIComponent('negato:' + e.name)),
  );
  window.__prova = prova;
  setTimeout(prova, 300);
</script>`,
};

let server;
let origine;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/esito') { esiti.push(u.searchParams.get('m')); res.end('ok'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGINE[u.pathname] || '<p>vuota</p>');
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  origine = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => {
  try { server.closeAllConnections?.(); } catch (_) {}
  await new Promise((ok) => server.close(ok));
});

let app;
let shell;
let userData;
test.beforeEach(async () => {
  esiti.length = 0;
  userData = cartellaTemporanea('filo-test-permessi-');
  app = await electron.launch({
    args: [...argomentiScala, '--use-fake-device-for-media-stream', '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
});
test.afterEach(async () => {
  await chiudiApp(app);
  try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
});

const apri = (percorso) => shell.evaluate((u) => window.filoShell.tabs.open(u), origine + percorso);
const barra = () => shell.locator('#permesso-bar');

test('microfono e fotocamera: la cornice chiede col nome del sito, Consenti li dà alla pagina e per quel sito non si richiede', async () => {
  test.setTimeout(60_000);
  await apri('/media');
  await expect(barra()).toBeVisible({ timeout: 10_000 });
  await expect(barra()).toContainText(new URL(origine).host);
  await expect(barra()).toContainText('microfono e fotocamera');
  expect(esiti, 'la pagina aspetta la risposta').toEqual([]);
  await barra().getByRole('button', { name: 'Consenti', exact: true }).click();
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['concesso:audio,video']);
  await expect(barra()).toBeHidden();

  await apri('/media');
  await expect.poll(() => esiti.length, { timeout: 10_000 }).toBe(2);
  expect(esiti[1]).toBe('concesso:audio,video');
  await expect(barra()).toBeHidden();
});

test('Non consentire: la pagina riceve un no, e per quel sito la domanda non torna', async () => {
  test.setTimeout(60_000);
  await apri('/media');
  await expect(barra()).toBeVisible({ timeout: 10_000 });
  await barra().getByRole('button', { name: 'Non consentire', exact: true }).click();
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['negato:NotAllowedError']);

  await apri('/media');
  await expect.poll(() => esiti.length, { timeout: 10_000 }).toBe(2);
  expect(esiti[1]).toBe('negato:NotAllowedError');
  await expect(barra()).toBeHidden();
});

test('appunti: la pagina non legge quello che hai copiato senza un sì; con Incolla di Filo sì, senza domande', async () => {
  test.setTimeout(60_000);
  await app.evaluate(({ clipboard }) => clipboard.writeText('parola-segreta'));
  await apri('/appunti');
  await expect(barra()).toBeVisible({ timeout: 10_000 });
  await expect(barra()).toContainText('vuole leggere quello che hai copiato');
  expect(esiti).toEqual([]);
  await barra().getByRole('button', { name: 'Non consentire', exact: true }).click();
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['negato:NotAllowedError']);

  // Incolla di Filo: il content script chiede il lasciapassare per la sua scheda, poi legge.
  const pagina = app.windows().find((w) => w.url().startsWith(origine));
  const ok = await app.evaluate(async ({ BrowserWindow }, base) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const t = w._filoTabs && w._filoTabs.tabs.find((x) => x.view.webContents.getURL().startsWith(base));
      if (!t) continue;
      const wc = t.view.webContents;
      wc.focus();
      return globalThis.SN_HANDLE_MESSAGE({ type: 'permesso_filo', tipo: 'appunti' }, { tab: { id: t.id, url: wc.getURL() }, url: wc.getURL(), wc, win: w });
    }
    return null;
  }, origine);
  expect(ok && ok.ok).toBe(true);
  await pagina.evaluate(() => window.__prova());
  await expect.poll(() => esiti.length, { timeout: 10_000 }).toBe(2);
  expect(esiti[1]).toBe('letto:parola-segreta');
  await expect(barra()).toBeHidden();
});
