// Giro 5, rilievo 1: nell'editor di testo ricco di Discord (Slate) la correzione automatica accesa non corregge niente:
// né i nomi né gli errori fissi.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDelMenu } from '../../helpers/menuContestuale.mjs';

const QUI = path.dirname(fileURLToPath(import.meta.url));
const PAGINA = `<!doctype html><meta charset="utf-8"><body style="padding:20px;font:22px sans-serif" lang="it"><div id="m"></div>
<script>${fs.readFileSync(path.join(QUI, 'slate.js'), 'utf8')}</script><script>avviaSL(document.getElementById('m'));</script></body>`;

async function apri(app, openTab, testServer) {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      featureFlags: { spellcheck: true, spellcheckContext: false },
      correttore: { modelloErrori: false, automatica: true },
    });
  });
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
  return page;
}
const testo = (page) => page.evaluate(() => window.slText().replace(/ /g, ' '));

test('r1 in Slate «marco» e «perchè» si correggono allo spazio, e l\'annulla subito dopo riporta «perchè»', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.locator('#sl').click();
  await page.keyboard.type('Ciao marco come va, non so perchè ', { delay: 30 });
  await expect.poll(() => testo(page)).toBe('Ciao Marco come va, non so perché ');
  await page.keyboard.press('Control+z');
  await expect.poll(() => testo(page)).toBe('Ciao Marco come va, non so perchè ');
});
