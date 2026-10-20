// Verifica #1312 giro 4: esplorazione (home stretta col livello, chiaro e scuro; fraseNo; popup ricerca).
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SHOTS = join(process.cwd(), 'tests', '.shots');

test('esplora', async ({ app }) => {
  test.setTimeout(120_000);
  mkdirSync(SHOTS, { recursive: true });
  const page = await home(app);
  for (const livello of ['conservativo', 'automatico']) {
    for (const tema of ['light', 'dark']) {
      await app.evaluate((_e, { t, l }) => globalThis.SN_STORAGE.updateSettings({ theme: t, autonomia: { livello: l } }), { t: tema, l: livello });
      for (const w of [700, 720, 1000]) {
        await app.evaluate(({ BrowserWindow }, w) => { const b = BrowserWindow.getAllWindows()[0]; b.setSize(w, 700); }, w);
        await page.waitForTimeout(700);
        await page.locator('#input').fill('Mi trovi un ristorante vicino a casa per stasera, con tavoli all\'aperto e un menu vegetariano?');
        await page.waitForTimeout(300);
        const misure = await page.evaluate(() => {
          const i = document.querySelector('#input');
          const r = i.getBoundingClientRect();
          return { input: Math.round(r.width), vw: window.innerWidth };
        });
        console.log(livello, tema, w, JSON.stringify(misure));
        await page.screenshot({ path: join(SHOTS, `g4-home-${livello}-${tema}-${w}.png`) });
      }
    }
  }
  const frasi = await app.evaluate(() => {
    const A = globalThis.SN_AUTONOMIA; const L = globalThis.SN_ACTION_LEVELS;
    const out = [];
    for (const a of [{ type: 'CANCELLA_MEMORIA' }, { type: 'IMPOSTA_PREFERENZA', chiave: 'limite_spesa', valore: '500' }, { type: 'CANCELLA_PAGINE' }, { type: 'CANCELLA_ARCHIVIO', query: 'x' }]) {
      const ing = L.ingressi(a, { richiesta: 'ciao', impostazioni: { monthlyLimitEur: 5 } });
      const d = A.decideDettaglio({ livello: 'default', stato: 'contaminato', costo: ing.costo, campo: ing.campo, chiesta: ing.chiesta, difesa: ing.difesa, origine: 'chat', dentroPerimetro: true, guardiano: false });
      try { out.push(JSON.stringify(A.fraseNo(ing, d))); } catch (e) { out.push(String(e)); }
    }
    return out;
  });
  console.log(frasi.join('\n'));
  expect(true).toBe(true);
});
