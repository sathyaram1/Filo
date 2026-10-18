// Verifica #987, giro 1, rilievo 1: un testo molto lungo su una scheda in basso nella finestra si apre intero, ma
// con la rotella sopra il riquadro la fine resta sotto il bordo della finestra e non si legge.
import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://board/board.html';
const PUBBLICATA = '2026-09-01T10:00:00.000Z';
const scheda = (id, seq, extra) => Object.assign({
  _id: id, name: `Fix ${seq}`, seq, subSeq: 0, status: 'done', statusPublic: 'closed',
  resolvedInVersion: '0.2.70', createdAt: `2026-08-${String(10 + seq).padStart(2, '0')}T10:00:00.000Z`,
  publishedAt: PUBBLICATA,
}, extra);

const ENORME = Array.from({ length: 60 }, (_, i) => `Riga ${i + 1}: il timer non suona e il volume resta muto anche dopo il riavvio.`).join('\n') + '\nULTIMA-RIGA';
const SCHEDE = [
  scheda('t-enorme', 1, { name: 'Enorme in fondo', publicText: ENORME }),
  ...Array.from({ length: 10 }, (_, i) => scheda(`t-n${i}`, 2 + i, { name: `Riempitivo ${i}`, publicText: 'Breve.' })),
];

async function reteFinta(page, docs) {
  await page.addInitScript((base) => {
    const fsDoc = (c, campi) => {
      const fields = {};
      for (const [k, v] of Object.entries(c)) {
        if (k.startsWith('_') || (campi && !campi.includes(k))) continue;
        fields[k] = typeof v === 'number' ? { integerValue: String(v) } : { stringValue: String(v) };
      }
      return { name: `projects/p/databases/(default)/documents/feedback-public/${c._id}`, fields,
        createTime: '2026-09-01T10:00:00Z', updateTime: '2026-09-01T10:00:00Z' };
    };
    const vera = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = String((input && input.url) || input || '');
      if (!url.includes('firestore.googleapis.com')) return vera(input, init);
      let q = null;
      try { q = JSON.parse((init && init.body) || '{}').structuredQuery; } catch (_) {}
      if (!q || q.from?.[0]?.collectionId !== 'feedback-public') return new Response('{}', { status: 403 });
      const campi = q.select && Array.isArray(q.select.fields) ? q.select.fields.map((f) => f.fieldPath) : null;
      let righe = base;
      if (q.where) righe = base.filter((c) => String(c.publishedAt) > String(q.where.fieldFilter?.value?.stringValue || ''));
      else if (q.startAt) righe = [];
      righe = righe.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return new Response(JSON.stringify(righe.map((c) => ({ document: fsDoc(c, campi) }))), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
  }, docs);
}
async function pronta(page) {
  await page.waitForFunction(() => window.__boardTest && window.SN_FEEDBACK && window.SN_MANAGE_REVIEW, null, { timeout: 15_000 });
  await page.locator('#bdLoading').waitFor({ state: 'hidden', timeout: 20_000 });
}

test('r1 un testo lungo aperto in fondo alla finestra si legge fino all’ultima riga con la rotella', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await pronta(page);
  await reteFinta(page, SCHEDE);
  await page.reload();
  await pronta(page);
  await page.evaluate(() => window.__boardTest.setReleasedVersion('0.2.71'));
  await expect(page.locator('.bd-card')).toHaveCount(SCHEDE.length);

  const c = page.locator('.bd-card', { has: page.locator('.bd-card-title', { hasText: 'Enorme in fondo' }) });
  const corto = c.locator('.bd-card-text');
  // La scheda in basso, come la vede chi scorre la bacheca fino all'ultima.
  await corto.evaluate((el) => {
    const r = el.getBoundingClientRect();
    window.scrollBy(0, r.bottom - window.innerHeight + 20);
  });
  await corto.hover();
  const intero = c.locator('.bd-card-intero');
  await expect(intero).toBeVisible();
  await expect.poll(() => intero.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');

  const b = await corto.boundingBox();
  await page.mouse.move(b.x + 40, b.y + b.height / 2);
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, 300);
  await page.waitForTimeout(400);
  await expect(intero).toBeVisible();
  const fine = await intero.evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    const rs = r.getClientRects();
    return { ultima: rs[rs.length - 1].bottom, finestra: window.innerHeight };
  });
  await page.screenshot({ path: 'tests/.shots/v987-r1-fondo.png' });
  expect(fine.ultima, JSON.stringify(fine)).toBeLessThanOrEqual(fine.finestra);
});
