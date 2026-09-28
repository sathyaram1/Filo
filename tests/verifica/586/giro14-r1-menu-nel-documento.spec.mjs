// Verifica #586 giro 14, rilievo 1: il menu di Filo vive nel documento del sito. Dopo un tasto destro vero il sito sposta
// «Incolla», «Detta» o la freccia della cronologia fuori dal menu e li preme; e la cronologia aperta si legge dalla pagina.
import { test, expect } from '../../fixtures/electron.mjs';

test.use({ argomentiApp: ['--use-fake-device-for-media-stream'] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SPOSTA = `<!doctype html><html><head><title>Sposta</title></head><body>
<input id="campo" style="width:300px"><div id="via" style="position:fixed;left:-9999px"></div>
<script>
  window.__modo = '';
  new MutationObserver(() => {
    const m = document.querySelector('.sn-menu');
    if (!m || !window.__modo || window.__fatto) return;
    let b = null;
    if (window.__modo === 'incolla') b = m.querySelector('.sn-menu-paste-main');
    if (window.__modo === 'detta') b = [...m.querySelectorAll('.sn-menu-split-main')].find((x) => x.textContent.includes('Detta'));
    if (window.__modo === 'storia') b = m.querySelector('.sn-menu-paste-arrow');
    if (!b) return;
    window.__fatto = true;
    document.getElementById('campo').focus();
    document.getElementById('via').appendChild(b);
    b.click();
    setTimeout(() => {
      window.__storia = [...document.querySelectorAll('.sn-menu-history-item')].map((r) => r.dataset.snSearch + ' ' + r.textContent);
    }, 400);
  }).observe(document.documentElement, { childList: true, subtree: true });
</script></body></html>`;

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

test('dopo un tasto destro vero il sito non preme «Incolla» al posto dell’utente', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await app.evaluate(({ clipboard }) => clipboard.writeText('password-586'));
  const page = await apriOstile(openTab, testServer, SPOSTA);
  await page.evaluate(() => { window.__modo = 'incolla'; });
  await page.locator('#campo').click({ button: 'right' });
  await sleep(2000);
  expect(await page.locator('#campo').inputValue(), 'gli appunti sono finiti al sito per un tasto destro').not.toContain('password-586');
});

test('dopo un tasto destro vero il sito non fa partire «Detta»', async ({ openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apriOstile(openTab, testServer, SPOSTA);
  await page.evaluate(() => { window.__modo = 'detta'; });
  await page.locator('#campo').click({ button: 'right' });
  await sleep(2000);
  expect(await page.locator('.sn-dictate-pill').count(), 'Filo ha cominciato ad ascoltare per il sito').toBe(0);
});

test('dopo un tasto destro vero il sito non apre la cronologia di Incolla per leggerla', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await incollaVero(app, openTab, testServer, 'codice-banca-586');
  const page = await apriOstile(openTab, testServer, SPOSTA);
  await page.evaluate(() => { window.__modo = 'storia'; });
  await page.locator('#campo').click({ button: 'right' });
  await sleep(2000);
  const letti = await page.evaluate(() => window.__storia || []);
  expect(letti.join(' | '), 'il sito ha letto la cronologia degli appunti').not.toContain('codice-banca-586');
});

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
