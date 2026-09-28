// Verifica #586 giro 15, rilievo 4: un riquadro di un altro sito chiede le notifiche col nome del sito che lo ospita, e
// dopo il sì a quel sito le riceve senza domanda. La scelta deve restare del sito che la chiede.
import { test, expect } from '../../fixtures/electron.mjs';

const riga = (shell) => shell.locator('#perm-bar .perm-row');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function giornale(testServer, openTab) {
  const dentro = testServer.html(`<!doctype html><title>Pubblicita</title><script>
    window.addEventListener('message', async (e) => {
      if (e.data !== 'chiedi') return;
      const prima = Notification.permission;
      const r = await Notification.requestPermission();
      parent.postMessage({ prima, r }, '*');
    });
  </script>`).replace('127.0.0.1', 'localhost');
  return testServer.openReady(openTab, `<!doctype html><title>Giornale</title>
    <iframe id="f" src="${dentro}" width="300" height="100"></iframe>
    <script>
      window.__r = null;
      window.addEventListener('message', (e) => { if (e.data && e.data.r) window.__r = e.data; });
      window.chiediMia = () => Notification.requestPermission().then((r) => { window.__mia = r; });
      window.chiediRiquadro = () => document.getElementById('f').contentWindow.postMessage('chiedi', '*');
    </script>`);
}

test('la domanda di un riquadro di un altro sito non porta il nome del sito che lo ospita', async ({ shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await giornale(testServer, openTab);
  await sleep(1000);
  await page.evaluate(() => window.chiediRiquadro());
  await sleep(2000);
  const testo = (await riga(shell).count()) ? await riga(shell).first().innerText() : '';
  expect(testo, `compare: ${testo}`).not.toContain('127.0.0.1');
});

test('dato il sì al giornale, un riquadro di un altro sito non riceve le notifiche senza domanda', async ({ shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await giornale(testServer, openTab);
  await sleep(1000);
  await page.evaluate(() => { window.chiediMia(); });
  await expect(shell.locator('#perm-bar .perm-si')).toBeEnabled({ timeout: 10_000 });
  await shell.locator('#perm-bar .perm-si').click();
  await expect.poll(() => page.evaluate(() => window.__mia), { timeout: 5000 }).toBe('granted');
  await page.evaluate(() => window.chiediRiquadro());
  await sleep(2000);
  const r = await page.evaluate(() => window.__r);
  expect(r && r.r, `il riquadro ha ricevuto ${JSON.stringify(r)}`).not.toBe('granted');
});
