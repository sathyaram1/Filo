// Verifica #725.2 giro 1: l'avviso sul link che porta il nome vero senza
// comandare, nelle forme della segnalazione e oltre; e i falsi allarmi sui
// domini che le stesse aziende usano davvero.

import { test, expect } from '../../fixtures/electron.mjs';

const pagina = (href) => `<!doctype html><html><body style="margin:0;padding:40px;font:16px sans-serif">
  <p><a id="l" href="${href}">Accedi al tuo conto</a></p></body></html>`;

async function avvisoDi(openTab, testServer, href, { tema } = {}) {
  const page = await testServer.openReady(openTab, pagina(href));
  if (tema) await page.evaluate((t) => { document.documentElement.dataset.snTheme = t; }, tema);
  await page.locator('#l').click({ button: 'right' });
  await expect(page.locator('.sn-menu .sn-menu-inline[data-subject="link"]')).toBeVisible();
  await page.waitForTimeout(600);
  const avviso = page.locator('.sn-menu .sn-menu-link-warn');
  const testo = (await avviso.count()) ? ((await avviso.first().textContent()) || '').trim() : '';
  return { page, testo };
}

for (const [cosa, href, dove] of [
  ['maiuscole davanti a un altro dominio', 'https://PAYPAL.COM.accesso-sicuro.net/login', 'accesso-sicuro.net'],
  ['nome prima della chiocciola', 'https://paypal.com@accesso-sicuro.net/login', 'accesso-sicuro.net'],
  ['cirillico davanti a un altro dominio', 'https://www.раypal.com.accesso-sicuro.net/', 'accesso-sicuro.net'],
  ['dominio del Regno Unito in coda', 'https://login.paypal.com.evil.co.uk/', 'evil.co.uk'],
]) {
  test(`segnalata: ${cosa}`, async ({ openTab, testServer }) => {
    const { testo } = await avvisoDi(openTab, testServer, href);
    expect(testo).toContain('paypal.com');
    expect(testo).toContain(dove);
    expect(testo).toMatch(/imitazione/);
  });
}

// Indirizzi che le aziende usano davvero: nessun avviso.
for (const [cosa, href] of [
  ['la comunità ufficiale di PayPal', 'https://www.paypal-community.com/t5/Italia/ct-p/it'],
  ['le immagini di Amazon', 'https://m.media-amazon.com/images/I/81abc.jpg'],
  ['lo spazio SharePoint di Microsoft', 'https://microsoft.sharepoint.com/sites/news'],
  ['le immagini di Instagram sui server di Facebook', 'https://instagram.fmxp6-1.fna.fbcdn.net/v/t51.2885-15/x.jpg'],
]) {
  test(`nessun falso allarme: ${cosa}`, async ({ openTab, testServer }) => {
    const { testo } = await avvisoDi(openTab, testServer, href);
    expect(testo).toBe('');
  });
}

test('dominio lunghissimo in tema scuro: l\'avviso resta dentro il menu', async ({ openTab, testServer }) => {
  const lungo = 'https://paypal.com.' + 'verifica-accesso-'.repeat(12) + 'sicuro.net/login';
  const { page, testo } = await avvisoDi(openTab, testServer, lungo, { tema: 'dark' });
  expect(testo).toContain('paypal.com');
  const menu = await page.locator('.sn-menu').boundingBox();
  const avviso = await page.locator('.sn-menu .sn-menu-link-warn').boundingBox();
  expect(avviso.x + avviso.width).toBeLessThanOrEqual(menu.x + menu.width + 1);
  await page.screenshot({ path: 'tests/.shots/725.2-lungo-scuro.png' });
});
