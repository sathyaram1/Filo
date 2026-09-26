// Giro 1 di verifica del #665. La condizione di chi ha segnalato: un primo
// caricamento RIUSCITO, che riempie la bacheca di quattro schede. Da lì la
// bacheca deve rileggere davvero — mostrare quello che il server le dice
// adesso, non le schede del giro prima — e chiedere solo la vista pubblica.

import { test, expect } from '../../fixtures/electron.mjs';

const BOARD = 'filo://board/board.html';

function scheda(id, titolo, seq) {
  return {
    document: {
      name: `projects/p/databases/(default)/documents/feedback-public/${id}`,
      createTime: '2026-06-20T10:00:00Z',
      updateTime: '2026-06-22T10:00:00Z',
      fields: {
        name: { stringValue: titolo },
        seq: { integerValue: String(seq) },
        subSeq: { integerValue: '0' },
        status: { stringValue: 'done' },
        statusPublic: { stringValue: 'closed' },
        resolvedInVersion: { stringValue: '0.2.70' },
        createdAt: { stringValue: `2026-06-${10 + seq}T10:00:00Z` },
        resolvedAt: { stringValue: '2026-06-22T10:00:00Z' },
        clientIdHash: { stringValue: String(seq).repeat(32).slice(0, 32) },
        userNote: { stringValue: 'nota' },
      },
    },
  };
}

async function spia(page, righe) {
  await page.evaluate((rows) => {
    window.__chieste = [];
    window.fetch = async (url, opts) => {
      const body = (opts && opts.body) ? String(opts.body) : '';
      window.__chieste.push({ url: String(url), body });
      const pagina = body.includes('"startAt"') ? [{ readTime: '2026-06-22T10:00:00Z' }] : rows;
      return { ok: true, status: 200, json: async () => pagina, text: async () => JSON.stringify(pagina) };
    };
  }, righe);
}

test('dopo un primo caricamento riuscito con piu schede, la ricarica mostra solo quelle nuove', async ({ openTab }) => {
  const page = await openTab(BOARD);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__boardTest && window.SN_FEEDBACK);
  await page.locator('#bdLoading').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});

  // La condizione della macchina di chi ha segnalato: il primo giro riesce e
  // riempie la bacheca di QUATTRO schede (memoria breve + copia su disco piene).
  await spia(page, [scheda('a', 'Prima', 1), scheda('b', 'Seconda', 2), scheda('c', 'Terza', 3), scheda('d', 'Quarta', 4)]);
  await page.evaluate(() => {
    window.__boardTest.setReleasedVersion('0.2.71');
    return window.__boardTest.reload();
  });
  await expect(page.locator('.bd-card')).toHaveCount(4);

  // Ora il server ne ha UNA sola: quella si deve vedere, e nient'altro.
  await spia(page, [scheda('e', 'Migliorata la cattura schermo', 9)]);
  await page.evaluate(() => window.__boardTest.reload());
  await expect(page.locator('.bd-card')).toHaveCount(1);
  await expect(page.locator('.bd-card-title')).toHaveText('Migliorata la cattura schermo');

  const chieste = await page.evaluate(() => window.__chieste);
  expect(chieste.length).toBeGreaterThan(0);
  for (const c of chieste) {
    expect(c.body).not.toMatch(/"collectionId"\s*:\s*"feedback"/);
    expect(c.url).not.toMatch(/documents\/feedback(\?|\/|$)/);
  }
});
