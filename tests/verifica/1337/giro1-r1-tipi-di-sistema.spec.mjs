// #1337, giro 1: un documento di un tipo ammesso che il sistema operativo tipizza con un nome diverso da quello della
// lista (.log e .yaml su Linux, .csv su Windows con Excel) il selettore lo offre e il controllo lo rifiuta.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '../../fixtures/electron.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  let win = null;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'newtab non trovata').toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  return win;
}

test('r1 riquadro: un .log, un .yaml dal disco e un .csv tipizzato da Excel si allegano', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();

  const dir = cartellaTemporanea('filo-1337-');
  const log = join(dir, 'diario.log');
  const yaml = join(dir, 'config.yaml');
  writeFileSync(log, 'errore 42\n');
  writeFileSync(yaml, 'a: 1\n');

  const input = page.locator('.sn-fb-file');
  const accept = String(await input.getAttribute('accept')).split(',');
  for (const e of ['.log', '.yaml', '.csv']) expect(accept, `il selettore offre ${e}`).toContain(e);

  // Il tipo lo decide Chromium dal sistema, come per l'utente che sceglie il file nel selettore.
  await input.setInputFiles([log, yaml]);
  await input.setInputFiles({ name: 'misure.csv', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('a,b\n1,2\n') });

  await expect(page.locator('.sn-fb-file-chip .sn-fb-file-name')).toHaveText(['diario.log', 'config.yaml', 'misure.csv'], { timeout: 5_000 });
  await expect(page.locator('.sn-fb-status')).not.toContainText('non supportato');
});
