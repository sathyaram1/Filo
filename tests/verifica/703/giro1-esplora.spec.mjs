// Verifica #703 giro 1: il grassetto della segnalazione nel rombo, e le altre
// strade da cui l'owner legge lo stesso testo.

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

test('nel rombo le scelte **A.** e **B.** si leggono in grassetto, senza asterischi', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  await apri(page, [fb]);
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await page.locator('#mgForme .mg-forma[data-livello="l3"]').click();
  const body = page.locator('#mgSideBody');
  await expect(body).toContainText('Dal sito: zero attrito');
  await expect(body).not.toContainText('**');
  await expect(body.locator('strong', { hasText: 'A.' }).first()).toBeVisible();
  for (const tema of ['dark', 'light']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
    await page.locator('#mgSide').screenshot({ path: `${SHOTS}/rombo-${tema}.png` });
  }
});

test('stress dei pezzi in linea', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [pratica()]);
  const casi = ['**A.** e **B.**', '**non chiuso', '** spazi **', '`a **b** c`', '***A.***', '__A.__', '*corsivo*', '**😀 emoji**', '<b>x</b> **y**', 'a**b**c', '**a*b**', '****'];
  const out = await page.evaluate((cs) => cs.map((c) => [c, window.SN_MANAGE_REVIEW.pezziInline(c)]), casi);
  console.log(JSON.stringify(out, null, 1));
  const lungo = '**x** '.repeat(5000) + '**' + 'a '.repeat(20000);
  const t0 = Date.now();
  await page.evaluate((s) => window.SN_MANAGE_REVIEW.pezziInline(s).length, lungo);
  console.log('ms lungo', Date.now() - t0);
});

test('nella conversazione della pratica la stessa segnalazione', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  await apri(page, [fb]);
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  const thread = page.locator('#mgThread');
  await page.waitForTimeout(500);
  console.log('THREAD', await thread.innerText().catch(() => 'n/a'), await thread.isVisible());
  await page.screenshot({ path: `${SHOTS}/dettaglio.png` });
});
