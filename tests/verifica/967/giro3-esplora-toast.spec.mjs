// Verifica #967 giro 3: esplorazione visiva dell'avviso in basso dopo «Continua».
import { test, expect, aspettaFinestra } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test.describe('toast', () => {
  test.use({ hostInPiu: ['team.com'] });
  for (const tema of ['light', 'dark']) {
    test(`toast dopo Continua, tema ${tema}`, async ({ app, shell }) => {
      const server = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<title>T</title><h1>Pagina</h1>'); });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      try {
        await app.evaluate((_e, t) => globalThis.__filoHandlers.applySettingsUpdate({ theme: t }), tema);
        await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://team.com:${server.address().port}/x`);
        const avviso = await aspettaFinestra(app, (w) => w.url().startsWith('filo://shell/avviso-sito.html'), 'avviso');
        await avviso.screenshot({ path: join(APP_ROOT, 'tests', '.shots', `v967g3-avviso-${tema}.png`) });
        const continua = avviso.getByRole('button', { name: 'Continua' });
        await expect(continua).toBeEnabled({ timeout: 12_000 });
        await continua.click();
        await shell.waitForTimeout(900);
        await shell.screenshot({ path: join(APP_ROOT, 'tests', '.shots', `v967g3-toast-${tema}.png`) });
        const testo = await shell.evaluate(() => [...document.querySelectorAll('[class*="toast"]')].map((e) => e.innerText).join(' | '));
        console.log('TOAST', tema, testo);
      } finally { try { server.closeAllConnections?.(); } catch (_) {} server.close(); }
    });
  }
});
