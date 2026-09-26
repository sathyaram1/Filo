// Gestione: una pratica con una richiesta di fusione che aspetta l'owner sta nei Ricevuti anche se il suo
// stato non è arrivato al cancello, e ci arriva da sola a pagina aperta; il segno nato da un clic «Approva»
// non schiaccia il titolo della scheda.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const RICHIESTA = 'abcdefabcdefabcdefabcdef';

function fb(id, extra = {}) {
  return {
    _id: id, _updateTime: 't1', text: `Testo ${id}.`, name: `Titolo ${id}`,
    seq: 515, subSeq: 0, clientId: 'tester@example.com', createdAt: '2026-09-20T10:00:00Z',
    images: [], status: 'revision_security', statusPublic: 'open', ...extra,
  };
}

function richiesta(feedbackId) {
  return {
    id: RICHIESTA, branch: `claude/${feedbackId}`, sha: 'a'.repeat(40), feedbackId, num: '515',
    who: 'secaudit · x', origin: 'routine', trips: [{ gate: 'rules', label: 'Regole', items: ['firestore.rules'] }],
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };
}

// Il canale verso il main risponde con le richieste che il test decide (window.__pending).
async function apri(openTab, docs, pending) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(({ docs, pending }) => {
    window.__pending = pending;
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: window.__pending, failed: [], recent: [], preapproved: [] };
      return orig(msg);
    };
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData(docs);
  }, { docs, pending });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  return page;
}

const scheda = (page, id) => page.locator(`.mg-item[data-id="${id}"]`);
const tab = (page, t) => page.locator(`.mg-tab[data-tab="${t}"]`);

test('una richiesta di fusione in attesa porta la pratica nei Ricevuti, anche se lo stato è ancora di lavoro', async ({ openTab }) => {
  const page = await apri(openTab, [fb('fb515')], [richiesta('fb515')]);
  await tab(page, 'inbox').click();
  await expect(scheda(page, 'fb515')).toBeVisible();
  await expect(tab(page, 'inbox')).toContainText('(1)');
  await expect(tab(page, 'queue')).toContainText('(0)');
});

test('la richiesta che arriva a pagina aperta sposta la pratica e la sezione lo segnala', async ({ openTab }) => {
  const page = await apri(openTab, [fb('fb515')], []);
  await tab(page, 'queue').click();
  await expect(scheda(page, 'fb515')).toBeVisible();

  await page.evaluate((r) => { window.__pending = [r]; }, richiesta('fb515'));
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await expect(scheda(page, 'fb515')).toHaveCount(0);
  await expect(tab(page, 'inbox')).toContainText('(1)');
  await expect(tab(page, 'inbox')).toHaveClass(/mg-tab--arrivi/);

  // Approvata e fusa: la richiesta sparisce e la pratica torna dove la mette lo stato.
  await page.evaluate(() => { window.__pending = []; });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await expect(scheda(page, 'fb515')).toBeVisible();
});

test('col segno di un clic «Approva» il titolo della scheda resta leggibile', async ({ openTab }) => {
  const segno = { by: `owner@example.com · approvazione ${RICHIESTA}`, at: '2026-09-25T08:30:00.000Z' };
  const page = await apri(openTab, [
    fb('lavoro', { status: 'working', name: 'La Gestione non aggiorna le sezioni da sola', mergePreapproved: segno }),
    fb('fermo', { seq: 516, status: 'design', statusReason: 'l5', name: 'Fusione ferma sulle regole', mergePreapproved: segno }),
  ], [{ ...richiesta('fermo'), num: '516' }]);
  await tab(page, 'queue').click();
  await expect(scheda(page, 'lavoro').locator('.mg-preapproved')).toBeVisible();
  const largo = (id) => scheda(page, id).locator('.mg-item-title').evaluate((el) => el.getBoundingClientRect().width);
  expect(await largo('lavoro')).toBeGreaterThan(80);
  await tab(page, 'inbox').click();
  await expect(scheda(page, 'fermo').locator('.mg-fusione-badge')).toBeVisible();
  expect(await largo('fermo')).toBeGreaterThan(80);
});
