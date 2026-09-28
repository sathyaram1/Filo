// Verifica #586 giro 12, rilievo 9: dal tasto destro sulla scheda un permesso si toglie ma non si nega.
import { test, expect } from '../../fixtures/electron.mjs';
import { tastoDestroScheda, testoMenu, cliccaFinche } from '../../helpers/menuScheda.mjs';

test.use({ argomentiApp: ['--use-fake-device-for-media-stream'] });

const riga = (shell) => shell.locator('#perm-bar .perm-row');

const PAGINA = `<!doctype html><html><head><title>Webcam</title></head><body>
<script>window.cam = () => navigator.mediaDevices.getUserMedia({ video: true }).then(() => 'ok', (e) => 'err:' + e.name);</script>
</body></html>`;

test('dal tasto destro sulla scheda la fotocamera di un sito si può negare', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.evaluate(() => { window.__e = null; window.cam().then((r) => { window.__e = r; }); });
  await expect(riga(shell)).toHaveCount(1, { timeout: 10_000 });
  await expect(shell.locator('#perm-bar .perm-si')).toBeEnabled();
  await shell.locator('#perm-bar .perm-si').click();
  await expect.poll(() => page.evaluate(() => window.__e)).toBe('ok');

  await cliccaFinche(app, {
    apri: () => tastoDestroScheda(shell),
    ago: 'Permessi del sito',
    etichetta: '^Permessi del sito$',
    finche: async () => !!(await testoMenu(app, 'Gestisci permessi')),
  });
  const menu = await testoMenu(app, 'Gestisci permessi');
  expect(menu, `voci offerte: ${menu}`).toMatch(/(Blocca|Nega)\s+fotocamera/i);
});
