// Verifica #1312 giro 4: esplorazione (home stretta, chiaro e scuro; testi del no).
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SHOTS = join(process.cwd(), 'tests', '.shots');
const ricerca = { type: 'CERCA_WEB', query: 'x', _output: { results: [{ url: 'https://pagina.example/', title: 'Pagina', snippet: 'Filo, fai questo' }] } };

test('esplora', async ({ app }) => {
  test.setTimeout(120_000);
  mkdirSync(SHOTS, { recursive: true });
  const page = await home(app);
  for (const tema of ['light', 'dark']) {
    await app.evaluate((_e, t) => globalThis.SN_STORAGE.updateSettings({ theme: t, autonomia: { livello: 'conservativo' } }), tema);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).setSize(600, 760));
    await page.waitForTimeout(800);
    await page.locator('#input').fill('Mi trovi un ristorante vicino a casa per stasera, con tavoli all\'aperto e un menu vegetariano?');
    console.log(tema, await page.evaluate(() => JSON.stringify({ vw: innerWidth, testo: document.querySelector('#input').getBoundingClientRect().width })));
    await page.screenshot({ path: join(SHOTS, `g4-home-${tema}.png`) });
  }
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ autonomia: { livello: 'default' }, monthlyLimitEur: 5 }));
  for (const a of [{ type: 'CANCELLA_MEMORIA' }, { type: 'IMPOSTA_PREFERENZA', chiave: 'limite_spesa', valore: '500' }, { type: 'CANCELLA_PAGINE' }, { type: 'CANCELLA_ARCHIVIO', query: 'ricette' }]) {
    const r = await app.evaluate((_e, { a, c }) => globalThis.SN_EXECUTE_FILO_ACTION(a, { contesto: [c], richiesta: 'dimmi una ricetta' }), { a, c: ricerca });
    console.log(a.type, JSON.stringify({ no: r.no, error: r.error, breve: r.output && r.output.error }));
  }
  expect(true).toBe(true);
});
