// Verifica #586, giro 1 — cosa vede DAVVERO chi naviga.
//
// `capturePage()` fotografa solo l'HTML della shell e salta le WebContentsView
// native: una pastiglia coperta dalla view lì dentro si vede lo stesso. Per
// sapere cosa arriva agli occhi serve la fotografia dello SCHERMO, che
// include la composizione vera.
//
// Questa prova è utile solo dove esiste uno schermo catturabile (in cloud lo
// fornisce xvfb); altrove si salta da sola.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;background:#0b57d0">
<h1 style="color:#fff;font:700 40px sans-serif;margin:0;padding:8px">AREA DELLA PAGINA</h1>
<script>
  window.__chiediFotocamera = () => {
    window.__cam = navigator.mediaDevices.getUserMedia({ video: true })
      .then(() => 'ok', (e) => (e && e.name) ? e.name : 'errore');
  };
</script>
</body></html>`;

test('fotografia dello schermo con la pastiglia aperta', async ({ shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  if (!process.env.DISPLAY) test.skip(true, 'nessuno schermo da fotografare');

  const page = await testServer.openReady(openTab, HTML);
  await page.evaluate(() => window.__chiediFotocamera());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 10_000 });
  await page.waitForTimeout(700);

  mkdirSync('tests/.shots', { recursive: true });
  const out = 'tests/.shots/586-giro1-schermo.png';
  try {
    execFileSync('scrot', ['-o', out], { stdio: 'ignore' });
  } catch (_) {
    test.skip(true, 'niente scrot in questo ambiente');
  }
  expect(existsSync(out)).toBe(true);
});
