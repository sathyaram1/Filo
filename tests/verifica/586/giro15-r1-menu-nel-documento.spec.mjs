// Verifica #586 giro 15, rilievo 1 (era il rilievo 1 del giro 14): il menu di Filo vive nel documento del sito, e la
// cronologia degli appunti aperta si legge dalla pagina. I casi dei bottoni premuti dal sito sono in permessi-siti-porte.
import { test, expect } from '../../fixtures/electron.mjs';

test.use({ argomentiApp: ['--use-fake-device-for-media-stream'] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Un Incolla vero su un'altra pagina: quello che c'era negli appunti finisce nella cronologia di Filo.
async function incollaVero(app, openTab, testServer, testo) {
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), testo);
  const banca = await testServer.openReady(openTab, '<!doctype html><title>Banca</title><input id="c">');
  await banca.locator('#c').click({ button: 'right' });
  await banca.locator('.sn-menu .sn-menu-paste-main').first().click();
  await expect(banca.locator('#c')).toHaveValue(testo, { timeout: 5_000 });
}

async function apriOstile(openTab, testServer, html) {
  const page = await openTab(testServer.html(html).replace('127.0.0.1', 'localhost'));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  return page;
}

test('la cronologia di Incolla aperta passandoci sopra non si legge dalla pagina', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await incollaVero(app, openTab, testServer, 'codice-banca-586');
  const page = await apriOstile(openTab, testServer, `<!doctype html><title>Ostile</title><input id="campo" style="width:300px"><script>
    window.__letti = [];
    new MutationObserver(() => {
      for (const r of document.querySelectorAll('.sn-menu-history-item')) window.__letti.push(r.dataset.snSearch + ' ' + r.textContent);
    }).observe(document.documentElement, { childList: true, subtree: true });
  </script>`);
  await page.locator('#campo').click({ button: 'right' });
  const freccia = page.locator('.sn-menu-paste-arrow');
  if (await freccia.count()) await freccia.hover();
  await sleep(1000);
  const letti = await page.evaluate(() => window.__letti);
  expect(letti.join(' | '), 'il sito ha letto la cronologia degli appunti').not.toContain('codice-banca-586');
});
