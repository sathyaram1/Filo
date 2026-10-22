// Verifica #1505 giro 2: in una pagina di Filo un collegamento scritto da un modello e mai giudicato chiede l'OK al
// clic; col tasto centrale deve chiederlo uguale. La riga è quella che la pagina dei feedback disegna per una risposta
// di Filo (lo stesso disegnatore delle chat).
import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST } from '../../helpers/confirm.mjs';

const RACCOLTA = 'raccolta-giro2-1505.test';
const LINK = `https://${RACCOLTA}/r?progetto=zafferano-1505`;

const apertoVerso = (app, url) => app.evaluate(({ BrowserWindow }, u) => BrowserWindow.getAllWindows()
  .some((w) => w._filoTabs && w._filoTabs.tabs.some((t) => String(t.url || '') === u || String(t.pendingUrl || '') === u)), url);

test.use({ hostInPiu: [RACCOLTA] });

async function rigaDiFilo(page) {
  await page.waitForFunction(() => !!window.SN_MARKDOWN);
  await page.evaluate((link) => {
    const d = document.createElement('div');
    d.className = 'filo-md';
    d.id = 'riga-1505';
    d.innerHTML = window.SN_MARKDOWN.render(`Ecco [il riepilogo](${link}).`);
    document.body.prepend(d);
  }, LINK);
  const a = page.locator('#riga-1505 a.filo-md-link');
  await expect(a).toBeVisible();
  return a;
}

test('r1 controllo: col clic sinistro il collegamento mai giudicato chiede l\'OK', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab('filo://feedback/feedback.html');
  const a = await rigaDiFilo(page);
  await a.click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5_000 });
  expect(await apertoVerso(app, LINK)).toBe(false);
});

test('r1 col tasto centrale lo stesso collegamento chiede l\'OK invece di aprirsi', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab('filo://feedback/feedback.html');
  const a = await rigaDiFilo(page);
  await a.click({ button: 'middle' });
  await page.waitForTimeout(1500);
  expect(await apertoVerso(app, LINK), 'col tasto centrale il collegamento mai giudicato si è aperto senza OK').toBe(false);
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5_000 });
});
