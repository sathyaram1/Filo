// Verifica #1905 giro 4, rilievo 2: aperto un file del computer in una scheda, Filo sa leggerla come ogni altra scheda
// («riassumimi la pagina che hai aperto»): oggi la lettura risponde «non è una pagina web».

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { home } from '../../helpers/chatFinta.mjs';

test('r2 Filo legge il testo della scheda del file che ha aperto', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = join(cartellaTemporanea('g4r2-'), 'report');
  mkdirSync(dir, { recursive: true });
  const f = join(dir, 'trimestre.html');
  // Il numero lo scrive lo script: si legge solo dalla pagina resa, non dal sorgente.
  writeFileSync(f, '<!doctype html><title>Trimestre</title><h1 id="h"></h1><script>document.getElementById("h").textContent = "Fatturato: " + (40 + 2) + " mila euro";</script>');
  await home(app);
  expect((await app.evaluate((_e, f) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url: f }, { parole: `aprimi ${f}` }), f)).executed).toBe(true);
  let n = 0;
  await expect.poll(async () => (n = await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const s = t.tabs.find((x) => String(x.url).startsWith('file:') && !x.loading);
    return s ? t.tabs.indexOf(s) + 1 : 0;
  })), { timeout: 10_000 }).toBeGreaterThan(0);
  await expect.poll(async () => {
    const r = await app.evaluate((_e, n) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'LEGGI_PAGINA', scheda: n }, { parole: 'riassumimi la pagina che hai aperto' }), n);
    return JSON.stringify(r.output || r);
  }, { timeout: 10_000, message: 'Filo legge la scheda del file' }).toContain('Fatturato: 42 mila euro');
});
