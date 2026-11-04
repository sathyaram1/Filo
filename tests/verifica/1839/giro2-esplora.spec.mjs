// Esplorazione del giro 2 di #1839.

import { test, expect } from '../../fixtures/electron.mjs';
import { apriScheda } from '../../helpers/gestione.mjs';

const URL = 'filo://manage/manage.html';
const MIN = 60 * 1000;

function fb(id, seq, extra = {}) {
  return {
    _id: id, _updateTime: 't1', text: `Testo ${id}.`, name: `Titolo ${id}`,
    seq, subSeq: 0, clientId: 'tester@example.com', createdAt: `2026-09-${String(10 + (seq % 18)).padStart(2, '0')}T10:00:00Z`,
    images: [], statusPublic: 'open', ...extra,
  };
}
function richiesta(id, feedbackId, num, extra = {}) {
  return {
    id, branch: `claude/${feedbackId}`, sha: 'a'.repeat(40), feedbackId, num: String(num),
    who: 'secaudit · notturna', origin: 'routine',
    blocks: [{ gate: 'guard_the_guards', label: 'Tocca aree protette', items: ['firestore.rules'] }],
    createdAtMs: Date.now() - 5 * MIN, expiresAtMs: Date.now() + 24 * 60 * MIN, ...extra,
  };
}
async function apri(openTab, docs, liste, { approva = null } = {}) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(({ docs, liste, approva }) => {
    window.__liste = liste;
    window.__chiamate = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ...window.__liste };
      if (t === 'merge_approval_approve') {
        window.__chiamate.push(msg);
        if (approva === 'mai') return new Promise(() => {});
        return approva || { ok: true, result: 'merged', sha: 'b'.repeat(40) };
      }
      if (t === 'update_feedback_status' || t === 'feedback_update_status') { window.__chiamate.push(msg); return { ok: true }; }
      return orig(msg);
    };
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData(docs);
  }, { docs, liste, approva });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  return page;
}
const scheda = (page, id) => page.locator(`.mg-item[data-id="${id}"]`);

test('riallineamento non andato: rosso, in cima, pannello e riga coerenti', async ({ openTab }) => {
  const docs = [
    fb('altra', 900, { status: 'design', statusReason: 'clarify', createdAt: '2026-09-30T10:00:00Z' }),
    fb('fallito', 901, { status: 'design', statusReason: 'l5', createdAt: '2026-09-01T10:00:00Z' }),
  ];
  const page = await apri(openTab, docs, {
    failed: [richiesta('f'.repeat(24), 'fallito', 901, { used: true, outcome: 'conflict' })],
  });
  await apriScheda(page, 'inbox');
  const it = scheda(page, 'fallito');
  await expect(it).toHaveClass(/mg-item--fusione/);
  console.log('badge', await it.locator('.mg-fusione-badge').textContent(), '| title', await it.getAttribute('title'));
  const ordine = await page.locator('#mgList .mg-item').evaluateAll((els) => els.map((e) => e.dataset.id));
  console.log('ordine', ordine);
  await page.evaluate(() => window.__mgTest.openDetail('fallito'));
  console.log('riga', await page.locator('#mgActionsRow').innerText());
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').click();
  console.log('pannello', await page.locator('#mgSideBody').innerText());
  await page.screenshot({ path: 'tests/.shots/g2-fallito.png' });
});

test('in volo, cambio pratica e ritorno: la fusione resta in volo', async ({ openTab }) => {
  const docs = [fb('volo', 702, { status: 'revision_security' }), fb('altra', 703, { status: 'working' })];
  const page = await apri(openTab, docs, { pending: [richiesta('a'.repeat(24), 'volo', 702)] }, { approva: 'mai' });
  await page.evaluate(() => window.__mgTest.openDetail('volo'));
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').click();
  const go = page.locator('#mgSideBody .sn-mac-btn-go');
  await go.click();
  await go.click();
  await expect(page.locator('#mgSideBody .sn-mac-card')).toHaveClass(/is-merging/);
  await page.evaluate(() => window.__mgTest.openDetail('altra'));
  await page.evaluate(() => window.__mgTest.openDetail('volo'));
  const q = page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]');
  console.log('quadrato classi', await q.getAttribute('class'));
  await q.click();
  const card = page.locator('#mgSideBody .sn-mac-card');
  console.log('card classi', await card.getAttribute('class'), '| status', await page.locator('#mgSideBody .sn-mac-status').isVisible());
  console.log('pannello', await page.locator('#mgSideBody').innerText());
  console.log('lista', await scheda(page, 'volo').innerText());
  // Una seconda pressione non deve partire.
  console.log('go disabled', await page.locator('#mgSideBody .sn-mac-btn-go').isDisabled());
});

test('aspetto: tema scuro, da riallineare e in volo', async ({ openTab }) => {
  const docs = [
    fb('riallinea', 1124, { status: 'revision_capability' }),
    fb('volo', 702, { status: 'revision_security' }),
  ];
  const page = await apri(openTab, docs, {
    pending: [richiesta('a'.repeat(24), 'volo', 702)],
    failed: [richiesta('f'.repeat(24), 'riallinea', 1124, { used: true, outcome: 'conflict' })],
  }, { approva: 'mai' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await apriScheda(page, 'queue');
  await page.screenshot({ path: 'tests/.shots/g2-scuro-coda.png' });
  await page.evaluate(() => window.__mgTest.openDetail('volo'));
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').click();
  const go = page.locator('#mgSideBody .sn-mac-btn-go');
  await go.click();
  await go.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/g2-scuro-volo.png' });
  await page.evaluate(() => window.__mgTest.openDetail('riallinea'));
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').click();
  await page.screenshot({ path: 'tests/.shots/g2-scuro-riallinea.png' });
});
