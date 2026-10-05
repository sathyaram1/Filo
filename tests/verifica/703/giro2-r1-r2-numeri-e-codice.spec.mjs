// Verifica #703 giro 2. r1: un elenco numerato con le voci staccate da righe vuote ricomincia da 1 a ogni voce.
// r2: un blocco di codice in un turno di Filo fa scorrere di lato tutta la conversazione della pratica.

import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const FEEDBACK_URL = 'filo://feedback/feedback.html';
const SCELTE = '## Scelte\n1. **Dal sito**: zero attrito.\n\n2. **Chiesto**: un passaggio in più.\n\n3. **Misto**: chiesto solo la prima volta.';
const CODICE = 'Ho fatto A.\n```\nconst nome = "' + 'x'.repeat(200) + '";\n```';

async function apri(page, fbs) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo && window.SN_MANAGE_REVIEW);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      if (t === 'feedback_update') return { ok: true };
      return orig(msg);
    };
  });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((f) => window.__mgTest.setData(f), fbs);
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
}

function pratica(notes, over = {}) {
  return Object.assign({
    _id: 'fb-703-g2', seq: 993, subSeq: 0, text: 'Il download non tiene il nome del file.', name: 'Prova',
    clientId: 'tester@example.com', createdAt: '2026-09-20T10:00:00Z', images: [],
    status: 'design', statusReason: 'decisione', statusPublic: 'open', branch: 'claude/nome-file', notes,
  }, over);
}

// Il numero che il lettore vede davanti a ogni voce.
const numeriVisti = (loc) => loc.evaluateAll((els) => els.map((li) => {
  const ol = li.parentElement;
  const voci = [...ol.children].filter((c) => c.tagName === 'LI');
  return (ol.start || 1) + voci.indexOf(li);
}));

test('nella pratica e nel rombo le scelte numerate staccate da righe vuote tengono 1, 2, 3', async ({ openTab }) => {
  const fb = pratica(`Ho fatto A.\n\nSegnalazione per l'owner (chi verifica):\n${SCELTE}`, {
    livelli: { l3: { esito: 'segnalato', ruolo: 'verifier', at: '2026-09-23T09:15:00.000Z', testo: SCELTE } },
  });
  const page = await openTab(MANAGE);
  await apri(page, [fb]);
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  const turno = page.locator('#mgThread .mg-bubble--model', { hasText: 'Segnalazione per l' });
  await expect(turno.locator('ol li')).toHaveCount(3);
  expect(await numeriVisti(turno.locator('ol li'))).toEqual([1, 2, 3]);
  await page.locator('#mgForme .mg-forma[data-livello="l3"]').click();
  const body = page.locator('#mgSideBody');
  await expect(body.locator('ol li')).toHaveCount(3);
  expect(await numeriVisti(body.locator('ol li'))).toEqual([1, 2, 3]);
});

test('un blocco di codice in un turno di Filo non fa scorrere di lato la conversazione della pratica', async ({ openTab }) => {
  const fb = pratica(CODICE);
  const page = await openTab(MANAGE);
  await apri(page, [fb]);
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await expect(page.locator('#mgThread pre')).toHaveCount(1);
  const [sw, cw] = await page.locator('#mgThread').evaluate((t) => [t.scrollWidth, t.clientWidth]);
  expect(sw).toBeLessThanOrEqual(cw);
});
