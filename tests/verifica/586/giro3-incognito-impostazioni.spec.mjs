// Verifica #586, giro 3 — in incognito, le scelte si vedono e si tolgono anche
// dalle IMPOSTAZIONI, non solo dal tasto destro sulla scheda.
//
// È il rilievo con cui si era chiuso il giro 2: il tasto destro le mostrava, le
// Impostazioni no, e chi andava a cercarle lì trovava un elenco che sembrava
// completo e non lo era. Il feedback chiede tutte e due le strade.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0"><p>pagina</p>
<script>
  window.__cam = () => navigator.mediaDevices.getUserMedia({ video: true }).then(
    () => 'ok', (e) => 'rifiutato:' + ((e && e.name) || 'errore'));
</script></body></html>`;

async function aspetta(fn, ms = 15_000) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

test('in incognito la scelta compare nelle Impostazioni, e da lì si toglie', async ({ app, shell, testServer }) => {
  test.setTimeout(180_000);
  const url = testServer.html(HTML);
  const host = new URL(url).host;

  await shell.evaluate(() => window.filoShell.openIncognito());
  const shellIncognito = await aspetta(async () => app.windows().find((w) => {
    try { return w.url().includes('shell.html?incognito=1'); } catch (_) { return false; }
  }) || null);
  expect(shellIncognito, 'shell della finestra in incognito non trovata').toBeTruthy();
  await shellIncognito.waitForLoadState('domcontentloaded').catch(() => {});

  await shellIncognito.evaluate((u) => window.filoShell.tabs.open(u), url);
  const page = await aspetta(async () => app.windows().find((w) => {
    try { return w.url() === url; } catch (_) { return false; }
  }) || null);
  expect(page, 'pagina nella finestra in incognito non trovata').toBeTruthy();
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 15_000 })
    .catch(() => {});

  const chip = shellIncognito.locator('.perm-chip');
  const esito = page.evaluate(() => window.__cam());
  await expect(chip).toHaveCount(1, { timeout: 20_000 });
  await chip.locator('.perm-chip-allow').click();
  expect(await esito, 'chi consente in incognito deve ottenere la fotocamera').toBe('ok');

  // Le Impostazioni, aperte NELLA finestra in incognito.
  await shellIncognito.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  const sicurezza = await aspetta(async () => app.windows().find((w) => {
    try { return w.url().includes('security.html'); } catch (_) { return false; }
  }) || null);
  expect(sicurezza, 'pagina Sicurezza non trovata nella finestra in incognito').toBeTruthy();
  await sicurezza.waitForLoadState('domcontentloaded').catch(() => {});
  await sicurezza.waitForTimeout(1500);

  const righe = await sicurezza.locator('#perms-list li').allTextContents();
  console.log('[586 g3] Impostazioni in incognito:', JSON.stringify(righe));
  expect(
    righe.join(' '),
    'in incognito la scelta appena fatta non compare nelle Impostazioni: '
    + 'chi la cerca lì trova un elenco che sembra completo e non lo è',
  ).toContain(host);

  // E si deve poter togliere da lì.
  const riga = sicurezza.locator('#perms-list li').filter({ hasText: host }).first();
  await riga.locator('button[aria-label]').first().click();
  await sicurezza.waitForTimeout(1200);
  const dopo = await sicurezza.locator('#perms-list li').allTextContents();
  expect(
    dopo.join(' '),
    'tolta dalle Impostazioni, la scelta non deve restare in elenco',
  ).not.toContain(host);
});
