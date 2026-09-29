// Verifica giro 4 (ramo riallineato su main): una scelta pendente che arriva e se ne va a pagina aperta, una
// richiesta di fusione ritirata altrove che rimanda In coda la pratica rimasta indietro.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const SHA = 'a1b2c3d4'.repeat(5);

function fb(id, extra = {}) {
  return {
    _id: id, _updateTime: 't1',
    text: `Testo del feedback ${id}.`,
    name: `Il menu della copertina si chiude da solo ${id}`,
    seq: 515, subSeq: 0,
    clientId: 'tester@example.com', createdAt: '2026-09-20T10:00:00Z', images: [],
    status: 'working', statusPublic: 'open',
    ...extra,
  };
}

function richiesta(over = {}) {
  return {
    id: 'abcdefabcdefabcdefabcdef', branch: 'claude/menu-copertina', sha: SHA, who: 'secaudit', num: '#515',
    feedbackId: 'fb515', origin: 'routine',
    blocks: [{ gate: 'guard_the_guards', label: 'Tocca aree protette', items: ['firestore.rules'], more: 0 }],
    createdAtMs: Date.now() - 60000, expiresAtMs: Date.now() + 86400000,
    expired: false, used: false, discarded: false,
    ...over,
  };
}

async function apri(openTab, docs, { pending = [] } = {}) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(({ docs, pending }) => {
    window.__stato = { docs: Object.fromEntries(docs.map((d) => [d._id, d])), pending };
    window.__chiamate = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') {
        return { ok: true, pending: window.__stato.pending, failed: [], recent: [], preapproved: [], ttlMs: 7 * 86400000 };
      }
      if (t === 'merge_approval_approve' || t === 'feedback_update' || t === 'merge_approval_discard') {
        window.__chiamate.push(msg);
        if (t === 'feedback_update') return { ok: true, by: 'owner@example.com' };
        return { ok: true, result: 'merged', sha: 'deadbeefcafe' };
      }
      if (t === 'feedback_decrypt_fields') return { ok: true, list: msg.list };
      return orig(msg);
    };
    window.__mgTest.setAdmin(true);
    window.__mgTest.setLiveSources({
      listVersions: async () => Object.values(window.__stato.docs).map((d) => ({ _id: d._id, _updateTime: d._updateTime })),
      getMany: async (ids) => ids.map((id) => window.__stato.docs[id]).filter(Boolean),
      getDettagli: async (ids) => ids.map((id) => window.__stato.docs[id]).filter(Boolean),
    });
    window.__mgTest.setData(docs, { dalVivo: true });
    window.__mgTest.setLiveTiming({ pollMs: 400, clockMs: 150, rientroMs: 150 });
  }, { docs, pending });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  return page;
}

const scheda = (page, id) => page.locator(`.mg-item[data-id="${id}"]`);
const tab = (page, t) => page.locator(`.mg-tab[data-tab="${t}"]`);
const cambia = (page, id, campi) => page.evaluate(({ id, campi }) => {
  const d = window.__stato.docs[id];
  window.__stato.docs[id] = Object.assign({}, d, campi, { _updateTime: `${d._updateTime}x` });
}, { id, campi });

test('una scelta che aspetta l\'owner arriva nei Ricevuti da sola, e ne esce da sola quando lui risponde altrove', async ({ openTab }) => {
  const page = await apri(openTab, [fb('fb515'), fb('altra', { seq: 600, status: 'revision_capability' })]);
  await tab(page, 'queue').click();
  await expect(tab(page, 'queue')).toContainText('(2)');
  await expect(tab(page, 'inbox')).toContainText('(0)');

  await cambia(page, 'fb515', { status: 'design', statusReason: 'decisione' });
  await expect(scheda(page, 'fb515')).toHaveCount(0, { timeout: 10000 });
  await expect(tab(page, 'inbox')).toContainText('(1)');
  await expect(tab(page, 'queue')).toContainText('(1)');
  await expect(tab(page, 'inbox')).toHaveClass(/mg-tab--arrivi/);
  await tab(page, 'inbox').click();
  await expect(scheda(page, 'fb515')).toBeVisible();

  // L'owner risponde da un'altra finestra: la pratica torna al lavoro.
  await cambia(page, 'fb515', { status: 'todo', statusReason: '' });
  await expect(scheda(page, 'fb515')).toHaveCount(0, { timeout: 10000 });
  await expect(tab(page, 'inbox')).toContainText('(0)');
  await expect(tab(page, 'queue')).toContainText('(2)');
});

test('la richiesta di fusione ritirata altrove: la pratica rimasta indietro torna In coda da sola', async ({ openTab, app }) => {
  const page = await apri(openTab, [fb('fb515', { status: 'revision_security' })], { pending: [richiesta()] });
  await tab(page, 'inbox').click();
  await expect(scheda(page, 'fb515')).toBeVisible();
  await expect(tab(page, 'inbox')).toContainText('(1)');

  await page.evaluate(() => { window.__stato.pending = []; });
  await app.evaluate(() => globalThis.SN_BROADCAST_FILO({
    type: 'merge_approvals_changed', ok: true, pending: [], failed: [], recent: [],
  }));
  await expect(scheda(page, 'fb515')).toHaveCount(0, { timeout: 10000 });
  await expect(tab(page, 'inbox')).toContainText('(0)');
  await expect(tab(page, 'queue')).toContainText('(1)');
  await tab(page, 'queue').click();
  await expect(scheda(page, 'fb515')).toBeVisible();
});
