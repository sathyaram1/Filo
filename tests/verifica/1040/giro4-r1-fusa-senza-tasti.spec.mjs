// Verifica #1040 giro 4: una pratica di nuovo ferma al cancello non resta senza tasti solo perché una sua richiesta
// passata è stata approvata e fusa.

import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const GIORNO = 24 * 60 * 60 * 1000;

async function apri(openTab, fb, recent) {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((cfg) => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: cfg.recent, preapproved: [], ttlMs: 7 * 86400000 };
      return orig(msg);
    };
  }, { recent });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), [fb]);
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').click();
  return page;
}

test('r1 lavoro server: parte dell’app approvata e fusa, poi il cancello del server la ferma: la scheda offre ancora di rimandarla o archiviarla', async ({ openTab }) => {
  const fb = {
    _id: 'fb-1040-g4-server', text: 'Il menu non si apre.', name: 'Menu', seq: 960, subSeq: 0,
    status: 'design', statusReason: 'l5', statusPublic: 'open', branch: 'worker/fb-1040-g4-server-20261010T120000Z',
    localOnly: { at: '2026-10-09T10:00:00Z', by: 'routine' },
    clientId: 'tester@example.com', createdAt: '2026-10-09T10:00:00Z', images: [],
  };
  const fusa = {
    id: 'a1a1a1a1a1a1a1a1a1a1a1a1', branch: fb.branch, sha: 'a'.repeat(40), feedbackId: fb._id, num: '960', who: 'routine',
    origin: 'routine', blocks: [], createdAtMs: Date.now() - 2 * GIORNO, expiresAtMs: Date.now() + 5 * GIORNO,
    expired: false, used: true, outcome: 'merged', discarded: false,
  };
  const page = await apri(openTab, fb, [fusa]);
  const corpo = page.locator('#mgSideBody');
  // La pratica è ferma di nuovo: «esce da qui appena arriva il suo stato nuovo» non è vero, non arriva niente.
  await expect(corpo).not.toContainText('Approvata e fusa');
  await expect(corpo.locator('#mgL5RimandaBtn')).toBeVisible();
  await expect(corpo.locator('#mgL5ArchiviaBtn')).toBeVisible();
});

test('r1 richiesta fusa di un giro passato e richiesta nuova scaduta: la scheda offre di chiedere di nuovo il via libera', async ({ openTab }) => {
  const fb = {
    _id: 'fb-1040-g4-vecchia', text: 'Il menu non si apre.', name: 'Menu', seq: 961, subSeq: 0,
    status: 'design', statusReason: 'l5', statusPublic: 'open', branch: 'worker/fb-1040-g4-vecchia-20261012T120000Z',
    clientId: 'tester@example.com', createdAt: '2026-10-01T10:00:00Z', images: [],
  };
  const vecchia = {
    id: 'b1b1b1b1b1b1b1b1b1b1b1b1', branch: 'worker/fb-1040-g4-vecchia-20261002T120000Z', sha: 'b'.repeat(40), feedbackId: fb._id,
    num: '961', who: 'routine', origin: 'routine', blocks: [], createdAtMs: Date.now() - 20 * GIORNO, expiresAtMs: Date.now() - 13 * GIORNO,
    expired: false, used: true, outcome: 'merged', discarded: false,
  };
  const scaduta = {
    id: 'c1c1c1c1c1c1c1c1c1c1c1c1', branch: fb.branch, sha: 'c'.repeat(40), feedbackId: fb._id, num: '961', who: 'routine',
    origin: 'routine', blocks: [{ gate: 'guard_the_guards', label: 'Tocca aree protette', items: ['scripts/x.mjs'], more: 0 }],
    createdAtMs: Date.now() - 9 * GIORNO, expiresAtMs: Date.now() - 2 * GIORNO, expired: true, used: false, discarded: false,
  };
  const page = await apri(openTab, fb, [scaduta, vecchia]);
  const corpo = page.locator('#mgSideBody');
  await expect(corpo).not.toContainText('Approvata e fusa');
  await expect(corpo.locator('#mgRiapriFusioneBtn')).toBeVisible();
  await expect(corpo.locator('#mgL5RimandaBtn')).toBeVisible();
});
