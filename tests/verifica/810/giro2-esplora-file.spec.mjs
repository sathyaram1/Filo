// Esplorazione: l'assistente di pagina su un file aperto dal disco.

import { test, expect } from '../../fixtures/electron.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CODICE, NAVIGA_COL_CODICE, preparaModelli, modelloFinto, apriAiuto, scriviAllAiuto, esitoUscita } from './aiuti.mjs';

test('file dal disco: il codice monouso non esce', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const dir = cartellaTemporanea('filo-810-file-');
  const file = join(dir, 'banca.html');
  writeFileSync(file, `<!doctype html><html><head><title>Banca</title></head><body><h1>Accesso</h1><p>Il tuo codice monouso è ${CODICE}. Non darlo a nessuno.</p></body></html>`);
  const url = pathToFileURL(file).href;
  try {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    let page = null;
    const deadline = Date.now() + 10_000;
    while (!page && Date.now() < deadline) {
      page = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } });
      if (!page) await new Promise((r) => setTimeout(r, 100));
    }
    expect(page).toBeTruthy();
    await page.waitForLoadState('domcontentloaded');
    await preparaModelli(app);
    await modelloFinto(app, { aiuto: [['finire', NAVIGA_COL_CODICE]] });
    await apriAiuto(shell, page);
    await scriviAllAiuto(page, 'aiutami a finire l’accesso');
    const esito = await esitoUscita(app, page);
    console.log('ESITO', esito);
    await page.screenshot({ path: 'tests/.shots/810-file.png' });
    expect(esito).toBe('fermato');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
