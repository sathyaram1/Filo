// Esplorazione visiva (giro 2): Lavori locali in Gestione, chiaro e scuro. Solo screenshot in tests/.shots/.
import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const ADESSO = Date.now();
function fb(id, seq, status, extra) {
  return {
    _id: id, text: `Testo ${id}`, name: `Pratica ${id}: una frase lunga quanto un titolo vero di una pratica locale`,
    seq, subSeq: 0, clientId: 'local:claude', senderProof: 'admin',
    createdAt: '2026-09-30T10:00:00Z', images: [], status, ...(extra || {}),
  };
}
const DATI = [
  fb('L1', 901, 'todo', { localOnly: { by: 'local:claude', at: ADESSO - 3600e3 } }),
  fb('L2', 902, 'working', { localOnly: { by: 'owner@example.com', at: ADESSO - 7200e3 }, workingSince: new Date(ADESSO - 600e3).toISOString() }),
  fb('Q1', 903, 'todo'),
  fb('U1', 904, 'todo', { clientId: 'tester@example.com', senderProof: undefined }),
  fb('X1', 905, 'todo', { senderProof: undefined }),
  fb('I1', 906, 'design', { localOnly: { by: 'local:claude', at: ADESSO }, statusReason: 'clarify' }),
  fb('R1', 907, 'unlabeled', { clientId: 'tester@example.com', senderProof: undefined, statusReason: 'locale' }),
  fb('S1', 908, 'design', {
    clientId: 'tester@example.com', senderProof: undefined, statusReason: 'locale', blockReason: 'locale',
    pipeline: { action: 'candidate_change', l2Class: 'aligned', verdicts: [{ class: 'aligned' }, { class: 'aligned' }, { class: 'aligned' }, { class: 'aligned' }] },
    notes: 'Richiede lavoro locale. Serve pubblicare le regole del server.',
  }),
];

async function apri(openTab) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.SN_FEEDBACK && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((items) => window.__mgTest.setData(items), DATI);
  return page;
}

test('aspetto dei Lavori locali, chiaro e scuro', async ({ openTab }) => {
  test.setTimeout(120_000);
  const page = await apri(openTab);
  for (const tema of ['light', 'dark']) {
    await page.evaluate(async (t) => {
      await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: t } });
    }, tema);
    await page.waitForTimeout(400);
    await page.locator('.mg-tab[data-tab="local"]').click();
    await page.screenshot({ path: `tests/.shots/ll-lista-${tema}.png` });
    await page.locator('.mg-item[data-id="L1"]').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `tests/.shots/ll-dettaglio-L1-${tema}.png` });
    await page.locator('.mg-item[data-id="L2"]').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `tests/.shots/ll-dettaglio-L2-${tema}.png` });
    await page.locator('.mg-tab[data-tab="queue"]').click();
    await page.locator('.mg-item[data-id="Q1"]').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `tests/.shots/ll-dettaglio-Q1-${tema}.png` });
    await page.locator('.mg-item[data-id="Q1"]').click({ button: 'right' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `tests/.shots/ll-menu-Q1-${tema}.png` });
    await page.keyboard.press('Escape');
    await page.locator('.mg-tab[data-tab="inbox"]').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `tests/.shots/ll-ricevuti-${tema}.png` });
    const r1 = page.locator('.mg-item[data-id="R1"]');
    if (await r1.count()) { await r1.click(); await page.waitForTimeout(300); await page.screenshot({ path: `tests/.shots/ll-ricevuti-R1-${tema}.png` }); }
    const s1 = page.locator('.mg-item[data-id="S1"]');
    if (await s1.count()) { await s1.click(); await page.waitForTimeout(300); await page.screenshot({ path: `tests/.shots/ll-ricevuti-S1-${tema}.png` }); }
  }
  expect(true).toBe(true);
});
