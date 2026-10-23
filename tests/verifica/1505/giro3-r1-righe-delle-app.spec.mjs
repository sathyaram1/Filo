// #1505 giro 3, rilievo 1: un collegamento scritto dall'Aiuto (o dall'Editor) e mai giudicato, riaperto nella riga
// della home, deve chiedere l'OK al clic come ogni collegamento senza verdetto nelle pagine di Filo.

import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST, confirmText, clickConfirm } from '../../helpers/confirm.mjs';

const RACCOLTA = 'raccolta-1505g3.test';
const HOSTS = [RACCOLTA];
const LINK_RACCOLTA = `https://${RACCOLTA}/r?x=482913`;

async function serverCheConta() {
  const arrivate = [];
  const server = createServer((req, res) => {
    arrivate.push(req.url);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>prova</title>ok');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { arrivate, chiudi: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

async function newtab(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } });
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

const apertoVerso = (app, url) => app.evaluate(({ BrowserWindow }, u) => BrowserWindow.getAllWindows()
  .some((w) => w._filoTabs && w._filoTabs.tabs.some((t) => t.url === u)), url);

let rete;
test.beforeEach(async () => { rete = await serverCheConta(); });
test.afterEach(async () => { await rete.chiudi(); });
test.use({ hostInPiu: HOSTS });

test('r1 un collegamento dell\'Aiuto riaperto nella riga della home, mai giudicato, chiede l\'OK al clic', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await app.evaluate(async (_e, link) => {
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_CONVERSAZIONI_APP.annota({
      app: 'aiuto', rif: 'negozio-1505.test|1', soggetto: 'negozio-1505.test', dove: 'https://negozio-1505.test/',
      messaggi: [{ role: 'user', text: 'riassumi la pagina' }, { role: 'filo', text: `Ecco [il riepilogo](${link}).` }],
    });
  }, LINK_RACCOLTA);
  await page.reload();
  const riga = page.locator('.dash-riga-app').first();
  await expect(riga).toBeVisible({ timeout: 15_000 });
  await riga.locator('.dash-riga-app-testa').click();
  const a = riga.locator('a.filo-md-link', { hasText: 'il riepilogo' });
  await expect(a).toBeVisible({ timeout: 10_000 });
  await a.click();
  await expect(page.locator(CONFIRM_HOST), 'il collegamento mai giudicato si è aperto senza OK').toBeVisible({ timeout: 5_000 });
  await expect.poll(() => confirmText(page)).toContain('non ho potuto controllare');
  await clickConfirm(page, 'cancel');
  await page.waitForTimeout(500);
  expect(await apertoVerso(app, LINK_RACCOLTA)).toBe(false);
  expect(rete.arrivate).toEqual([]);
});
