// Verifica #1959 giro 5, r1: un lavoro fermo in attesa del manutentore (guasto o domanda di processo) si riconosce in
// Gestione: la riga lo dice, invece di sembrare un lavoro in coda che nessuno prende senza motivo.
import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const giudici = (c) => ({ action: 'human_review', verdicts: [{ judge: 'a', class: c }, { judge: 'b', class: c }, { judge: 'c', class: c }] });
const FERMO = {
  clientId: 'tester@example.com', createdAt: '2026-10-01T08:00:00Z', images: [], subSeq: 0, text: 'x',
  _id: 'fb-fermo-man', seq: 1101, name: 'Bordo delle schede', status: 'todo', priority: 2, pipeline: giudici('aligned'),
  fermoManutentore: { tipo: 'guasto', testo: 'guasto: npm: npm ci è uscito con 1', atMs: Date.now(), gruppo: 'guasto: npm', ruolo: 'new-work' },
};

test('r1 la riga di un lavoro fermo per il manutentore lo dice', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      return orig(msg);
    };
  });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), [FERMO]);
  const testi = [];
  for (const tab of ['queue', 'waiting']) {
    await page.evaluate((t) => window.__mgTest.setTab(t), tab);
    const riga = page.locator('.mg-item', { hasText: 'Bordo delle schede' });
    if (await riga.count()) {
      testi.push(await riga.first().evaluate((el) => [el.textContent, ...[...el.querySelectorAll('[title],[aria-label]')]
        .map((x) => `${x.getAttribute('title') || ''} ${x.getAttribute('aria-label') || ''}`)].join(' ')));
    }
  }
  expect(testi.length, 'il lavoro compare in una delle liste').toBeGreaterThan(0);
  expect(testi.join(' '), 'la riga dice che il lavoro aspetta il manutentore').toMatch(/manutentore/i);
});
