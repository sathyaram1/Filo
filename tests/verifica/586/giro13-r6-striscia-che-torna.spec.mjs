// Verifica #586 giro 13, rilievo 6: la domanda non si toglie di mezzo, né con la × né con l'Esc.
import { test, expect } from '../../fixtures/electron.mjs';

test.use({ argomentiApp: ['--use-fake-device-for-media-stream'] });

const riga = (shell) => shell.locator('#perm-bar .perm-row');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGINA = `<!doctype html><html><head><title>Insiste</title></head><body>
<script>
  window.insisti = () => setInterval(() => { navigator.mediaDevices.getUserMedia({ video: true }).catch(() => {}); }, 100);
  window.unaVolta = () => navigator.mediaDevices.getUserMedia({ video: true }).catch(() => {});
</script></body></html>`;

test('chiusa tre volte con la ×, la domanda di un sito che insiste non torna subito', async ({ shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.evaluate(() => window.insisti());
  for (let i = 0; i < 3; i++) {
    await expect(riga(shell)).toHaveCount(1, { timeout: 10_000 });
    await shell.locator('#perm-bar .perm-chiudi').click();
    await sleep(300);
  }
  await sleep(1500);
  await expect(shell.locator('#perm-bar .perm-si'), 'la domanda è di nuovo lì').toHaveCount(0);
});

test('l’Esc chiude la domanda come la ×', async ({ shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.evaluate(() => { window.unaVolta(); });
  await expect(riga(shell)).toHaveCount(1, { timeout: 10_000 });
  await page.keyboard.press('Escape');
  await sleep(500);
  await expect(riga(shell), 'dopo l’Esc la domanda è ancora sopra la pagina').toHaveCount(0);
});
