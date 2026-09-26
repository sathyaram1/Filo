// Verifica giro 2: le due porte del giro 1 riprovate (titolo schiacciato dal segno, richiesta in attesa che
// non porta nei Ricevuti) e il segno nato da un clic «Approva» usato come lo userebbe l'owner.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const RICHIESTA = 'abcdefabcdefabcdefabcdef';
const SHA = 'a1b2c3d4'.repeat(5);

function fb(id, extra = {}) {
  return {
    _id: id, _updateTime: 't1',
    text: `Testo del feedback ${id}.`,
    name: `Il menu della copertina si chiude da solo ${id}`,
    seq: 515, subSeq: 0,
    clientId: 'tester@example.com', createdAt: '2026-09-20T10:00:00Z', images: [],
    status: 'revision_security', statusPublic: 'open',
    ...extra,
  };
}

function richiesta(over = {}) {
  return {
    id: RICHIESTA, branch: 'claude/menu-copertina', sha: SHA, who: 'secaudit', num: '#515',
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
      if (t === 'merge_approval_approve' || t === 'feedback_update') {
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
const larghezzaTitolo = (page, id) => scheda(page, id).locator('.mg-item-title').first()
  .evaluate((el) => el.getBoundingClientRect().width);

test('porta del giro 1: il segno «blocchi già approvati» non schiaccia il titolo, In coda e Ricevuti', async ({ openTab }) => {
  const segno = { by: `owner@example.com · approvazione ${RICHIESTA}`, at: '2026-09-25T08:30:00.000Z' };
  const page = await apri(openTab, [
    fb('coda', { seq: 601, status: 'working', mergePreapproved: segno }),
    fb('fb515', { status: 'design', statusReason: 'l5', mergePreapproved: segno }),
  ], { pending: [richiesta()] });
  await tab(page, 'queue').click();
  await expect(scheda(page, 'coda').locator('.mg-preapproved')).toHaveText('blocchi già approvati');
  const wCoda = await larghezzaTitolo(page, 'coda');
  await page.screenshot({ path: 'tests/.shots/verifica-ricevuti-vivi-g2-coda.png' });
  await tab(page, 'inbox').click();
  await expect(scheda(page, 'fb515')).toBeVisible();
  const wRic = await larghezzaTitolo(page, 'fb515');
  await page.screenshot({ path: 'tests/.shots/verifica-ricevuti-vivi-g2-ricevuti.png' });
  // Un titolo di cui si leggono almeno una decina di lettere.
  expect(wCoda).toBeGreaterThan(70);
  expect(wRic).toBeGreaterThan(70);
});

test('porta del giro 1: richiesta di fusione in attesa con lo stato rimasto indietro, la pratica sta nei Ricevuti', async ({ openTab }) => {
  const page = await apri(openTab, [fb('fb515')], { pending: [richiesta()] });
  await expect(tab(page, 'inbox')).toContainText('(1)');
  await expect(tab(page, 'queue')).toContainText('(0)');
  await tab(page, 'inbox').click();
  await expect(scheda(page, 'fb515')).toBeVisible();
});

test('la richiesta arriva mentre la pagina è aperta (avviso del main): la pratica passa ai Ricevuti da sola', async ({ openTab, app }) => {
  const page = await apri(openTab, [fb('fb515')]);
  await tab(page, 'queue').click();
  await expect(scheda(page, 'fb515')).toBeVisible();
  await page.evaluate((r) => { window.__stato.pending = [r]; }, richiesta());
  await app.evaluate((_e, r) => globalThis.SN_BROADCAST_FILO({
    type: 'merge_approvals_changed', ok: true, pending: [r], failed: [], recent: [],
  }), richiesta());
  await expect(scheda(page, 'fb515')).toHaveCount(0, { timeout: 10000 });
  await expect(tab(page, 'inbox')).toContainText('(1)');
  await expect(tab(page, 'inbox')).toHaveClass(/mg-tab--arrivi/);
});

test('clic «Approva» nel quadrato, poi il server mette il segno: arriva da solo e la pratica torna fuori dai Ricevuti', async ({ openTab }) => {
  const page = await apri(openTab, [fb('fb515', { status: 'design', statusReason: 'l5' })], { pending: [richiesta()] });
  await tab(page, 'inbox').click();
  await scheda(page, 'fb515').click();
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').click();
  const go = page.locator('#mgSideBody .sn-mac-btn-go');
  await go.click();
  await go.click();
  await expect.poll(() => page.evaluate(() => window.__chiamate.filter((c) => c.type === 'merge_approval_approve').length)).toBe(1);
  // Il server: fusione in conflitto → riallineamento, richiesta usata, segno sulla pratica, pratica di nuovo al lavoro.
  await page.evaluate((r) => {
    window.__stato.pending = [];
    window.__stato.docs.fb515 = Object.assign({}, window.__stato.docs.fb515, {
      _updateTime: 't2', status: 'working', statusReason: '',
      mergePreapproved: { by: `owner@example.com · approvazione ${r}`, at: new Date().toISOString() },
    });
  }, RICHIESTA);
  await expect(scheda(page, 'fb515').locator('.mg-preapproved')).toHaveText('blocchi già approvati', { timeout: 15000 });
  await expect(page.locator('#mgPreapprovedInfo')).toContainText('blocchi che hai già approvato');
  await expect(page.locator('#mgPreapprovedInfo')).not.toContainText(RICHIESTA);
  await expect(page.locator('#mgPreapproveBtn')).toHaveAttribute('aria-pressed', 'false');
  await expect(tab(page, 'inbox')).toContainText('(0)');
  await page.screenshot({ path: 'tests/.shots/verifica-ricevuti-vivi-g2-dopo-approva.png' });
});

test('un segno col markup nel nome non diventa markup', async ({ openTab }) => {
  const page = await apri(openTab, [fb('x', { status: 'working',
    mergePreapproved: { by: `<img src=x onerror="window.__xss=1"> · approvazione ${RICHIESTA}`, at: 'non una data' } })]);
  await tab(page, 'queue').click();
  await scheda(page, 'x').click();
  await expect(page.locator('#mgPreapprovedInfo')).toBeVisible();
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(await page.locator('.mg-item img[src="x"]').count()).toBe(0);
});
