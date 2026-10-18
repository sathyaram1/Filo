// Verifica #590.2 giro 1: le porte della segnalazione chiuse. Un sito scritto nella lista dei
// bloccati resta anche se si cambia scheda, si naviga altrove o si chiude Filo subito dopo.
import { test, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const impostazioni = async (shell) => (await shell.evaluate(() => window.filoShell.message({ type: 'get_settings' }))).settings;
const snap = (shell) => shell.evaluate(() => window.filoShell.tabs.snapshot());

async function apriSicurezza(openTab) {
  const page = await openTab('filo://security/security.html');
  await page.waitForSelector('#sec-siteblock-blacklist');
  await page.waitForTimeout(400);
  return page;
}
async function scrivi(page, testo) {
  await page.locator('#sec-siteblock-blacklist').click();
  await page.keyboard.type(testo, { delay: 15 });
}

test('scritto e Ctrl+Tab subito: il link verso quel sito viene fermato', async ({ shell, openTab, testServer, avvisi }) => {
  const page = await apriSicurezza(openTab);
  const s = await snap(shell);
  const altra = s.tabs.find((t) => t.id !== s.activeId).id;
  await scrivi(page, 'blocked.test');
  // Il Ctrl arriva alla pagina, il Tab lo tiene il main: il cambio di scheda lo chiede il test.
  await page.keyboard.down('Control');
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), altra);
  await page.keyboard.up('Control');

  const meta = testServer.html('<!doctype html><h1 id="t">SITO</h1>').replace('127.0.0.1', 'blocked.test');
  const partenza = await testServer.openReady(openTab, `<!doctype html><a id="go" href="${meta}">vai</a>`);
  await partenza.evaluate(() => document.getElementById('go').click());
  await expect(shell.locator('.shell-notif', { hasText: 'Sito bloccato' })).toHaveCount(1, { timeout: 6000 });
  await expect((await avvisi()).locator('.shell-notif', { hasText: 'Sito bloccato' })).toBeVisible({ timeout: 6000 });
});

test('scritto e navigato subito altrove nella stessa scheda: la riga è salvata', async ({ shell, openTab }) => {
  const page = await apriSicurezza(openTab);
  const id = (await snap(shell)).activeId;
  await scrivi(page, 'blocked.test');
  await shell.evaluate((i) => window.filoShell.tabs.navigate(i, 'filo://history/history.html'), id);
  await expect.poll(async () => (await impostazioni(shell)).security.siteBlock.blacklist, { timeout: 4000 }).toEqual(['blocked.test']);
});

test('scritto e chiusa subito la finestra con Alt+F4: al riavvio la riga c’è', async () => {
  test.setTimeout(90_000);
  const dir = cartellaTemporanea('filo-590-');
  const lancia = () => electron.launch({ args: [...argomentiScala, '.'], cwd: ROOT, env: { ...process.env, FILO_USER_DATA: dir, NODE_ENV: 'test' } });
  try {
    let app = await lancia();
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
    let page = null;
    for (let i = 0; i < 100 && !page; i++) {
      page = app.windows().find((w) => /security/.test(w.url()));
      if (!page) await new Promise((r) => setTimeout(r, 100));
    }
    await page.waitForSelector('#sec-siteblock-blacklist');
    await page.waitForTimeout(400);
    await scrivi(page, 'blocked.test');
    await page.keyboard.down('Alt');
    await page.waitForTimeout(60);
    await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) w.close(); });
    await chiudiApp(app);

    app = await lancia();
    const sh2 = await app.firstWindow();
    await sh2.waitForLoadState('domcontentloaded');
    expect((await impostazioni(sh2)).security.siteBlock.blacklist).toEqual(['blocked.test']);
    await chiudiApp(app);
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});
