// #1905 giro 5: esplorazione 2.
import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';
import { paginaDellaScheda } from '../../helpers/schede.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const SHOTS = join(process.cwd(), 'tests', '.shots');
const execAction = (app, action, opts) => app.evaluate((_e, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });
const schede = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs
  .map((t) => { let u = ''; try { u = t.view.webContents.getURL(); } catch (_) {} return { id: t.id, url: t.url, vero: u }; }));
const schedaFile = async (app, fine) => (await schede(app)).find((t) => /^file:/.test(t.vero || t.url) && (t.vero || t.url).endsWith(fine))?.id || null;
const log = (k, v) => console.log(`### ${k}: ${JSON.stringify(v)}`);

function prepara() {
  const dir = join(cartellaTemporanea('g5b-'), 'Documenti', 'report');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'capitolo.html'), '<!doctype html><title>Capitolo</title><p>uno</p>');
  writeFileSync(join(dir, 'indice.html'), `<!doctype html><title>Indice</title><body style="font:16px sans-serif">
    <p><a id="cap" href="capitolo.html">capitolo</a></p>
    <p><a id="web" href="https://example.com/">sito</a></p></body>`);
  return dir;
}

test('esplora 2', async ({ app, avvisi }) => {
  test.setTimeout(180_000);
  mkdirSync(SHOTS, { recursive: true });
  const dir = prepara();
  const page = await home(app);
  const indice = join(dir, 'indice.html');

  void page;
  if (process.env.G5_CONF) await modelloFinto(app, [
    { toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: pathToFileURL(indice).href }) }] },
    { text: 'Ecco.' },
  ]);
  await chiedi(page, 'aprimi l\'indice del report');
  await new Promise((r) => setTimeout(r, 3000));
  await page.screenshot({ path: join(SHOTS, 'g5-conferma.png') });
  log('testo conferma', (await page.locator('body').innerText()).slice(-800));
  await ripristina(app);

  const r = await execAction(app, { type: 'NAVIGA', url: indice }, { parole: `aprimi ${indice}` });
  let id = null;
  await expect.poll(async () => (id = await schedaFile(app, 'indice.html')), { timeout: 10_000 }).toBeTruthy();
  await app.evaluate(({ BrowserWindow }, i) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.activate(i), id);
  let p = null;
  await expect.poll(async () => Boolean(p = await paginaDellaScheda(app, id, (x) => x.url().startsWith('file:'))), { timeout: 10_000 }).toBe(true);
  void r;

  const v = await avvisi().catch(() => null);
  // tasto destro sul collegamento al sito
  await p.locator('#web').click({ button: 'right', noWaitAfter: true });
  await expect(menuDi(p).locator('.sn-menu')).toBeVisible({ timeout: 8000 });
  log('menu sito', await menuDi(p).locator('.sn-menu').innerText());
  await p.screenshot({ path: join(SHOTS, 'g5-menu-sito.png') });
  await p.keyboard.press('Escape');
  await p.locator('#cap').click({ button: 'right', noWaitAfter: true });
  await expect(menuDi(p).locator('.sn-menu')).toBeVisible({ timeout: 8000 });
  log('menu fratello', await menuDi(p).locator('.sn-menu').innerText());
  const voce = menuDi(p).locator('.sn-menu').getByText(/nuova scheda/i).first();
  if (await voce.count()) {
    await voce.click();
    await new Promise((r) => setTimeout(r, 2500));
    log('dopo apri in nuova scheda', { schede: await schede(app), avvisi: v ? await v.locator('.shell-notif.show').allInnerTexts() : null });
  } else await p.keyboard.press('Escape');

  // duplica
  const dup = await app.evaluate(async ({ BrowserWindow }, i) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const f = ['duplicateTab', 'duplica', 'duplicate'].find((n) => typeof tm[n] === 'function');
    if (!f) return 'nessun metodo';
    try { await tm[f](i); } catch (e) { return String(e); }
    return f;
  }, id);
  await new Promise((r) => setTimeout(r, 2000));
  log('duplica', { dup, schede: (await schede(app)).filter((t) => /indice/.test(t.vero || t.url)).length });
});
