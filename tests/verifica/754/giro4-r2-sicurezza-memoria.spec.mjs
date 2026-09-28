// #754 giro 4, rilievo 2: togliere un sito dall'elenco in Sicurezza fa tornare il rifiuto automatico come il menu della scheda.
import { test, expect } from '../../fixtures/electron.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bannerSiti(shell, show) {
  const { activeId } = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  return shell.evaluate(({ id, s }) => window.filoShell.tabs.cookieBanners(id, s), { id: activeId, s: show });
}

// Risposta tenuta solo nella memoria della pagina, come fa Usercentrics («uc_settings»).
const UC = `<title>UC</title>
  <p>contenuto</p>
  <script>
    if (!localStorage.getItem('uc_settings')) {
      const b = document.createElement('div');
      b.className = 'cookie-banner';
      b.style.cssText = 'position:fixed;bottom:0;left:0;right:0;height:120px;background:#fff;z-index:9';
      b.innerHTML = '<p>Usiamo i cookie.</p><button id="acc" style="width:120px;height:40px">Accetta tutto</button>'
        + '<button id="rif" style="width:120px;height:40px">Rifiuta tutto</button>';
      b.querySelector('#acc').onclick = () => { localStorage.setItem('uc_settings', 'accettato'); b.remove(); };
      b.querySelector('#rif').onclick = () => { localStorage.setItem('uc_settings', 'rifiutato'); b.remove(); };
      document.body.appendChild(b);
    }
  </script>`;

test('Sicurezza, «Rifiuta in automatico»: Filo torna a rifiutare anche se il sito tiene la risposta nella memoria della pagina', async ({ openTab, testServer, shell }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, UC);
  await page.waitForFunction(() => localStorage.getItem('uc_settings') === 'rifiutato', null, { timeout: 10_000 });
  await sleep(2000);
  await bannerSiti(shell, true);
  await expect.poll(() => page.evaluate(() => !!document.querySelector('.cookie-banner #acc')).catch(() => false), { timeout: 10_000 }).toBe(true);
  await page.click('.cookie-banner #acc');
  await sleep(2000);
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('#cookie-banners-list li button', { timeout: 8_000 });
  await sec.locator('#cookie-banners-list li button').first().click();
  await expect(sec.locator('#sec-cookies-banners')).toBeHidden({ timeout: 6_000 });
  await sleep(1500);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8_000 });
  await expect.poll(() => page.evaluate(() => localStorage.getItem('uc_settings')), { timeout: 10_000 }).toBe('rifiutato');
});
