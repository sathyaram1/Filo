// Verifica #701, giro 3: il segno rimesso dallo script mentre un’altra pratica sta fondendo.

import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const SHA = 'a1b2c3d4'.repeat(5);
const GIORNO = 24 * 60 * 60 * 1000;

function pratica(over = {}) {
  return Object.assign({
    _id: 'fb-tardiva-1',
    name: 'Le regole del database lasciano leggere i segreti',
    text: 'Segnalazione di sicurezza: tocca firestore.rules.',
    seq: 581, subSeq: 0,
    status: 'todo', statusPublic: 'open',
    clientId: 'tester@esempio',
    createdAt: '2026-09-13T08:00:00Z',
    images: [],
  }, over);
}

function richiesta(over = {}) {
  return Object.assign({
    id: 'ab12cd34ef56ab12cd34ef56',
    branch: 'worker/fb-tardiva-1-20260920T081526Z',
    sha: SHA,
    who: 'secaudit · notturna',
    origin: 'routine',
    num: '#581',
    feedbackId: 'fb-tardiva-1',
    blocks: [{ gate: 'guard_the_guards', label: 'Tocca aree protette', items: ['firestore.rules'], more: 0 }],
    createdAtMs: Date.now() - 2 * 60 * 1000,
    expiresAtMs: Date.now() + GIORNO,
    expired: false, used: false, discarded: false,
  }, over);
}

/** Il canale verso il main: proprietario; scritture e approvazioni registrate. */
async function stubMain(page, { pending = [], approveReply = null, approveReplies = null, updateReply = null, tieniInAttesa = false, approveDelayMs = 0 } = {}) {
  await page.evaluate((cfg) => {
    window.__updates = [];
    window.__approvals = [];
    window.__fuse = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'feedback_update') {
        window.__updates.push(msg);
        // Il rifiuto arriva con calma: il tempo di cambiare pratica.
        if (cfg.updateReply) { await new Promise((r) => setTimeout(r, 1500)); return cfg.updateReply; }
        // Come il main: chi e quando del segno scritto.
        if (msg.mergePreapproved) { window.__segnoAt = new Date().toISOString(); return { ok: true, by: 'owner@esempio', at: window.__segnoAt }; }
        return { ok: true };
      }
      if (t === 'merge_approvals_get') {
        // Una fusione che NON è avvenuta lascia la richiesta dov'era: è il caso
        // del server irraggiungibile, non quello della fusione riuscita.
        const usate = cfg.tieniInAttesa ? new Set() : new Set(window.__fuse);
        return { ok: true, pending: cfg.pending.filter((r) => !usate.has(r.id)), failed: [], recent: [], preapproved: [], ttlMs: cfg.ttl };
      }
      if (t === 'merge_approval_approve') {
        window.__approvals.push(msg);
        // Il server fonde in secondi: la finestra in cui la fusione è in viaggio.
        if (cfg.approveDelayMs) await new Promise((r) => setTimeout(r, cfg.approveDelayMs));
        const reply = (cfg.approveReplies && cfg.approveReplies.shift()) || cfg.approveReply || { ok: true, result: 'merged', sha: cfg.sha };
        if (reply.ok) window.__fuse.push(msg.id);
        return reply;
      }
      return orig(msg);
    };
  }, { pending, approveReply, approveReplies, updateReply, tieniInAttesa, approveDelayMs, sha: SHA, ttl: 7 * GIORNO });
}

async function apri(page, fbs, opts) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await stubMain(page, opts);
  await page.evaluate((list) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(list); }, fbs);
  await page.evaluate((tab) => window.__mgTest.setTab(tab), (opts && opts.tab) || 'queue');
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
}

const approvazioni = (page) => page.evaluate(() => window.__approvals.map((a) => a.id));


async function daFuori(page, doc) {
  await page.evaluate((d) => window.__mgTest.setLiveSources({
    listVersions: async () => [{ _id: d._id, _updateTime: d._updateTime }],
    getMany: async () => [d],
  }), doc);
  return page.evaluate(() => window.__mgTest.pollNow());
}

const NON_RAGGIUNTO = { ok: false, error: 'github_502 unreachable' };
const SEGNO = { by: 'owner (script)', at: '2026-09-20T09:00:00.000Z' };

const SEGNO2 = { by: 'owner (script)', at: '2026-09-20T10:00:00.000Z' };
const SEGNO3 = { by: 'owner (script)', at: '2026-09-20T10:00:01.000Z' };

async function daFuoriMolti(page, docs) {
  await page.evaluate((list) => window.__mgTest.setLiveSources({
    listVersions: async () => list.map((d) => ({ _id: d._id, _updateTime: d._updateTime })),
    getMany: async () => list,
  }), docs);
  return page.evaluate(() => window.__mgTest.pollNow());
}

test('segno rimesso dallo script su B mentre la fusione di A è in viaggio: B si ritenta quando A torna', async ({ openTab }) => {
  test.setTimeout(90000);
  const page = await openTab(MANAGE);
  const a = pratica({ _id: 'fb-a', seq: 801, _updateTime: 'a1', mergePreapproved: SEGNO });
  const b = pratica({ _id: 'fb-b', seq: 802, _updateTime: 'b1', mergePreapproved: SEGNO });
  const ra = richiesta({ id: 'aaaaaaaaaaaaaaaaaaaaaaaa', feedbackId: 'fb-a', num: '#801', branch: 'worker/fb-a' });
  const rb = richiesta({ id: 'bbbbbbbbbbbbbbbbbbbbbbbb', feedbackId: 'fb-b', num: '#802', branch: 'worker/fb-b' });
  await apri(page, [a, b], {
    pending: [ra, rb], tieniInAttesa: true, approveDelayMs: 2500,
    approveReplies: [NON_RAGGIUNTO, NON_RAGGIUNTO, NON_RAGGIUNTO, { ok: true, result: 'merged', sha: SHA }],
  });
  await expect.poll(() => approvazioni(page), { timeout: 15000 }).toEqual([ra.id, rb.id]);
  await page.waitForTimeout(3500);
  // Lo script rimette il segno su A: A riparte e resta in viaggio per qualche secondo.
  await daFuoriMolti(page, [Object.assign({}, a, { _updateTime: 'a2', mergePreapproved: SEGNO2 }), b]);
  await expect.poll(() => approvazioni(page), { timeout: 8000 }).toEqual([ra.id, rb.id, ra.id]);
  // Intanto lo script rimette il segno su B.
  await daFuoriMolti(page, [Object.assign({}, a, { _updateTime: 'a2', mergePreapproved: SEGNO2 }), Object.assign({}, b, { _updateTime: 'b2', mergePreapproved: SEGNO3 })]);
  // Il gesto su B deve portare a un secondo tentativo su B, e il suo esito si legge.
  await expect.poll(() => approvazioni(page), { timeout: 15000 }).toEqual([ra.id, rb.id, ra.id, rb.id]);
  await expect(page.locator('#mgManageMsg')).toContainText('su main', { timeout: 8000 });
});
