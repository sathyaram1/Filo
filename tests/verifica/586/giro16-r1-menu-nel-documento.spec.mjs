// Verifica #586 giro 16, rilievo 1: il menu di Filo vive nel documento del sito. La pagina legge quello che il menu
// mostra (la cronologia degli appunti) e riscrive quello che dice: «Incolla» travestito incolla al sito con un clic vero.
import { test, expect } from '../../fixtures/electron.mjs';

test.use({ argomentiApp: ['--use-fake-device-for-media-stream'] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apriOstile(openTab, testServer, html) {
  const page = await openTab(testServer.html(html).replace('127.0.0.1', 'localhost'));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  return page;
}

// Un Incolla vero su un'altra pagina: quello che c'era negli appunti finisce nella cronologia di Filo.
async function incollaVero(app, openTab, testServer, testo) {
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), testo);
  const banca = await testServer.openReady(openTab, '<!doctype html><title>Banca</title><input id="c">');
  await banca.locator('#c').click({ button: 'right' });
  await banca.locator('.sn-menu .sn-menu-paste-main').first().click();
  await expect(banca.locator('#c')).toHaveValue(testo, { timeout: 5_000 });
}

test('la cronologia di Incolla aperta passandoci sopra non si legge dalla pagina', async ({ app, openTab, testServer }) => {
  test.fail(true, 'porta aperta per scelta dell’owner (D14): il menu del tasto destro vive nel documento del sito, si chiude solo portandolo fuori, lavoro a parte');
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

test('un «Incolla» travestito dalla pagina non porta gli appunti al sito con un clic vero', async ({ app, openTab, testServer }) => {
  test.fail(true, 'porta aperta per scelta dell’owner (D14): il menu del tasto destro vive nel documento del sito, si chiude solo portandolo fuori, lavoro a parte');
  test.setTimeout(60_000);
  await app.evaluate(({ clipboard }) => clipboard.writeText('password-586'));
  const page = await apriOstile(openTab, testServer, `<!doctype html><title>Ostile</title><input id="campo" style="width:300px"><script>
    new MutationObserver(() => {
      const b = document.querySelector('.sn-menu .sn-menu-paste-main');
      if (!b || b.dataset.travestito) return;
      b.dataset.travestito = '1';
      for (const n of b.querySelectorAll('*')) if (n.children.length === 0 && n.textContent.trim()) n.textContent = 'Traduci la pagina';
      document.getElementById('campo').focus();
    }).observe(document.documentElement, { childList: true, subtree: true });
  </script>`);
  await page.locator('#campo').click({ button: 'right' });
  const voce = page.locator('.sn-menu-paste-main');
  await expect(voce).toContainText('Traduci la pagina', { timeout: 5_000 });
  await sleep(400);
  await voce.click();
  await sleep(1500);
  expect(await page.locator('#campo').inputValue(), 'un clic su «Traduci la pagina» ha incollato gli appunti nel campo del sito').not.toContain('password-586');
});
