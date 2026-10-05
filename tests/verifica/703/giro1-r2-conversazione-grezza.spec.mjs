// Verifica #703 giro 1, rilievo 2: nella conversazione della pratica la stessa
// segnalazione si legge con cancelletti e asterischi.

import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const SHOTS = 'tests/.shots/verifica-703';
const SEGNALAZIONE = '## Problema\nIl nome del file salvato: dal sito o chiesto ogni volta?\n\n## Scelte\n- **A.** Dal sito: zero attrito.\n- **B.** Chiesto: un passaggio in più.\n\n## Cosa ho fatto nel frattempo\nHo preso la **A.**, la *meno* invasiva.';

function pratica(over = {}) {
  return Object.assign({
    _id: 'fb-703', seq: 990, subSeq: 0, text: 'Il download non tiene il nome del file.', name: 'Prova',
    clientId: 'tester@example.com', createdAt: '2026-09-20T10:00:00Z', images: [],
    status: 'design', statusReason: 'decisione', statusPublic: 'open', branch: 'claude/nome-file',
    notes: `Ho fatto A.\n\nSegnalazione per l'owner (chi verifica):\n${SEGNALAZIONE}`,
    livelli: { l3: { esito: 'segnalato', ruolo: 'verifier', at: '2026-09-23T09:15:00.000Z', testo: SEGNALAZIONE } },
  }, over);
}

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

test('nella conversazione della pratica la segnalazione si legge senza cancelletti né asterischi', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  await apri(page, [fb]);
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  const thread = page.locator('#mgThread');
  await expect(thread).toContainText('Dal sito: zero attrito');
  await expect(thread).not.toContainText('**A.**');
  await expect(thread).not.toContainText('## Scelte');
});
