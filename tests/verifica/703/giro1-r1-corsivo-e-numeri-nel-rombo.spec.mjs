// Verifica #703 giro 1, rilievo 1: nel rombo la formattazione in linea oltre al
// grassetto (corsivo, elenchi numerati) si legge come simboli.

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

test('nel rombo il corsivo si legge come corsivo e un elenco numerato tiene i suoi numeri', async ({ openTab }) => {
  const testo = '## Scelte\n1. Dal sito, la *meno* invasiva.\n2. Chiesto ogni volta.';
  const page = await openTab(MANAGE);
  const fb = pratica({ livelli: { l3: { esito: 'segnalato', ruolo: 'verifier', at: '2026-09-23T09:15:00.000Z', testo } } });
  await apri(page, [fb]);
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await page.locator('#mgForme .mg-forma[data-livello="l3"]').click();
  const body = page.locator('#mgSideBody');
  await expect(body).toContainText('invasiva');
  await expect(body).not.toContainText('*meno*');
  await expect(body.locator('em', { hasText: 'meno' })).toHaveCount(1);
  await expect(body.locator('ol li')).toHaveCount(2);
});
