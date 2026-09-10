// Verifica #496 — giro 8. Stress: testi ostili, testi enormi, tanti dati,
// azioni ripetute in fretta.

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const URL = 'filo://manage/manage.html';
const OUT = 'tests/.shots';
const ora = Date.now();
const iso = (g) => new Date(ora - g * 24 * 3600 * 1000).toISOString();

test.beforeAll(() => { try { mkdirSync(OUT, { recursive: true }); } catch (_) { /* c'è già */ } });

test('testi ostili ed enormi: niente esecuzione, niente NaN, niente sbordo', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => { window.__xss = 0; });

  const cattivo = '<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>';
  const lungo = 'A'.repeat(10000);
  await page.evaluate(({ cattivo, lungo, iso1, iso5 }) => window.__mgTest.setData([
    { _id: 'x1', seq: 1, subSeq: 0, clientId: cattivo, name: cattivo, text: cattivo, status: 'todo', createdAt: iso1 },
    { _id: 'x2', seq: 2, subSeq: 0, clientId: 'u@e.com', name: lungo, text: lungo, status: 'done', createdAt: iso5, _updateTime: iso1, notes: `Verifica: 1 rilievo.\n${cattivo}\nLa correzione riguarda tutti i rilievi; poi un'altra verifica ricontrolla.\n- [1] ${lungo}\n\n--- Aggiornamento dell'agente del 07/09/2026, 18:00 ---\nVerifica superata.` },
    { _id: 'x3', seq: 3, subSeq: 0, clientId: 'u@e.com', name: '🙂🙃 «virgolette» \u0000', text: 'e', status: 'spam', createdAt: 'non-una-data', priority: 99 },
  ]), { cattivo, lungo, iso1: iso(1), iso5: iso(5) });
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  await page.waitForTimeout(250);

  // Apri ogni elenco: il testo ostile finisce anche lì dentro.
  for (const key of ['categoria:valida', 'categoria:spam']) {
    const el = page.locator(`#panel-fbstats [data-drill="${key}"]`);
    if (await el.count()) { await el.first().click(); await page.waitForTimeout(120); }
  }
  await page.screenshot({ path: `${OUT}/496-giro8-ostile.png`, fullPage: true });

  const f = await page.evaluate(() => ({
    xss: window.__xss,
    testo: document.getElementById('panel-fbstats').textContent,
    orizzontale: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    script: document.querySelectorAll('#panel-fbstats script, #panel-fbstats img').length,
  }));
  expect(f.xss).toBe(0);
  expect(f.script).toBe(0);
  expect(f.testo).not.toMatch(/NaN|undefined|\[object Object\]/);
  expect(f.orizzontale).toBe(false);
});

test('mille segnalazioni e venti cambi di finestra a raffica', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  const stati = ['todo', 'done', 'attack', 'spam', 'design', 'working', 'unlabeled'];
  await page.evaluate(({ stati, base }) => {
    const l = [];
    for (let i = 0; i < 1000; i += 1) {
      const s = stati[i % stati.length];
      l.push({
        _id: `m${i}`, seq: i, subSeq: 0,
        clientId: i % 2 ? 'routine:prober' : 'u@e.com',
        name: `segnalazione ${i}`, text: `segnalazione ${i}`, status: s,
        createdAt: new Date(base - i * 3600 * 1000).toISOString(),
        _updateTime: new Date(base - (i % 50) * 3600 * 1000).toISOString(),
        notes: s === 'done' ? `Verifica: 1 rilievo.\nLa correzione riguarda tutti i rilievi; poi un'altra verifica ricontrolla.\n- [1] x\n\n--- Aggiornamento dell'agente del 07/09/2026, 18:00 ---\nVerifica superata.` : '',
      });
    }
    window.__mgTest.setData(l);
  }, { stati, base: ora });
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await page.waitForTimeout(200);

  const t0 = Date.now();
  for (let i = 0; i < 20; i += 1) {
    await page.locator('#mgStWindows .mg-st-chip').nth(i % 5).click();
  }
  const durata = Date.now() - t0;
  await page.waitForTimeout(200);
  const f = await page.evaluate(() => ({
    testo: document.getElementById('panel-fbstats').textContent,
    fette: document.querySelectorAll('#mgStPieLegend li').length,
  }));
  expect(f.testo).not.toMatch(/NaN|undefined/);
  expect(f.fette).toBeGreaterThan(0);
  console.log('venti cambi di finestra su mille segnalazioni:', durata, 'ms');
});
