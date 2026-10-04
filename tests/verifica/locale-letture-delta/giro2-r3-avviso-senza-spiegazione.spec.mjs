// Prova del giro 2, rilievo 3 (verifica locale, letture-delta): l'avviso del giro sull'intestazione della lista
// resta spiegato (il suggerimento al passaggio del mouse) anche quando lo stesso giro porta righe nuove.

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const URL = 'filo://manage/manage.html';
const riga = (id, seq, extra = {}) => ({ _id: id, _updateTime: 't1', name: `Titolo ${seq}`, text: 'x', seq, subSeq: 0, status: 'design', createdAt: '2026-09-01T10:00:00Z', ...extra });

test('avviso del giro con righe nuove: il segno resta spiegato', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((d) => { window.__mgTest.setData(d); window.__mgTest.setTab('inbox'); }, [riga('a1', 1)]);
  const head = page.locator('#mgListHead');
  await page.evaluate((r) => window.__mgTest.liveMessage({ kind: 'changed', rows: [r], avvisi: ['cambiati: troppe pagine, riallineamento completo al giro dopo'] }), riga('a2', 2, { _updateTime: 't2', createdAt: '2026-09-02T10:00:00Z' }));
  await expect(page.locator('.mg-item[data-id="a2"]')).toHaveCount(1);
  await expect(head).toHaveClass(/mg-list-head--avviso/);
  mkdirSync('tests/.shots', { recursive: true });
  await page.screenshot({ path: 'tests/.shots/verifica-676-avviso-chiaro.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: 'tests/.shots/verifica-676-avviso-scuro.png' });
  const title = await head.getAttribute('title');
  expect(title || '', 'il segno dell\'avviso c\'è ma passandoci sopra non dice niente').toContain('Aggiornamento');
});
