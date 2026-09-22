// Il segno «fondi senza chiedermelo» messo DOPO il blocco: la richiesta che il
// server ha già aperto si fonde da Gestione, senza il click su «Approva e fondi».
// Il main è finto (canale sostituito): qui si prova cosa manda la pagina.

import { test, expect } from './fixtures/electron.mjs';

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
async function stubMain(page, { pending = [], approveReply = null, updateReply = null } = {}) {
  await page.evaluate((cfg) => {
    window.__updates = [];
    window.__approvals = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'feedback_update') {
        window.__updates.push(msg);
        // Il rifiuto arriva con calma: il tempo di cambiare pratica.
        if (cfg.updateReply) { await new Promise((r) => setTimeout(r, 1500)); return cfg.updateReply; }
        return msg.mergePreapproved ? { ok: true, by: 'owner@esempio' } : { ok: true };
      }
      if (t === 'merge_approvals_get') {
        const usate = new Set(window.__approvals.map((a) => a.id));
        return { ok: true, pending: cfg.pending.filter((r) => !usate.has(r.id)), failed: [], recent: [], preapproved: [], ttlMs: cfg.ttl };
      }
      if (t === 'merge_approval_approve') {
        window.__approvals.push(msg);
        return cfg.approveReply || { ok: true, result: 'merged', sha: cfg.sha };
      }
      return orig(msg);
    };
  }, { pending, approveReply, updateReply, sha: SHA, ttl: 7 * GIORNO });
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

test('il segno messo con la richiesta già ferma la fonde subito, e lo dice', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  await apri(page, [fb], { pending: [richiesta()] });
  expect(await approvazioni(page)).toEqual([]);

  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await page.locator('#mgPreapproveBtn').click();

  await expect(page.locator('#mgManageMsg')).toContainText('Da ora si fonde senza chiedere.');
  await expect(page.locator('#mgManageMsg')).toContainText('Fusione ferma su questa pratica: Fatto: il lavoro è su main (a1b2c3d4)');
  expect(await approvazioni(page)).toEqual(['ab12cd34ef56ab12cd34ef56']);
  const updates = await page.evaluate(() => window.__updates);
  expect(updates).toEqual([{ type: 'feedback_update', id: fb._id, mergePreapproved: true }]);
  await expect(page.locator('#mgPreapproveBtn')).toHaveText('Chiedimi prima di fondere');
});

test('una richiesta ferma su una pratica già segnata parte da sola all’apertura, una volta sola', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ mergePreapproved: { by: 'owner@esempio', at: '2026-09-20T07:00:00.000Z' } });
  await apri(page, [fb], { pending: [richiesta()] });

  await expect.poll(() => approvazioni(page)).toEqual(['ab12cd34ef56ab12cd34ef56']);
  await expect(page.locator('#mgManageMsg')).toContainText('Fusione ferma su #581, pratica segnata «fondi senza chiedermelo»: Fatto: il lavoro è su main');

  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  expect(await approvazioni(page)).toEqual(['ab12cd34ef56ab12cd34ef56']);
});

test('il segno non copre il lavoro locale, i blocchi nuovi dopo un riallineamento, una pratica senza segno o chiusa', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const segnata = pratica({ mergePreapproved: { by: 'owner@esempio', at: '2026-09-20T07:00:00.000Z' } });
  const senzaSegno = pratica({ _id: 'fb-senza', seq: 582 });
  const chiusa = pratica({ _id: 'fb-chiusa', seq: 583, status: 'done', statusPublic: 'closed', mergePreapproved: { by: 'owner@esempio', at: '2026-09-01T00:00:00Z' } });
  const pending = [
    richiesta({ id: 'locale00000000000000000a', origin: 'locale', who: 'owner@esempio', branch: 'claude/mio-ramo' }),
    richiesta({ id: 'nuovi000000000000000000b', supersedes: 'c'.repeat(24) }),
    richiesta({ id: 'senza000000000000000000c', feedbackId: 'fb-senza', num: '#582', supersedes: 'd'.repeat(24) }),
    richiesta({ id: 'chiusa00000000000000000d', feedbackId: 'fb-chiusa', num: '#583' }),
  ];
  await apri(page, [segnata, senzaSegno, chiusa], { pending });
  await page.waitForTimeout(600);
  expect(await approvazioni(page)).toEqual([]);

  // Il segno messo adesso, con davanti la richiesta dei soli blocchi nuovi: la copre.
  await page.evaluate((id) => window.__mgTest.openDetail(id), senzaSegno._id);
  await page.locator('#mgPreapproveBtn').click();
  await expect(page.locator('#mgManageMsg')).toContainText('Fusione ferma su questa pratica: Fatto');
  expect(await approvazioni(page)).toEqual(['senza000000000000000000c']);
});

test('un segno respinto si vede anche se intanto hai aperto un’altra pratica', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const prima = pratica();
  const altra = pratica({ _id: 'fb-altra', seq: 582 });
  await apri(page, [prima, altra], { updateReply: { ok: false, error: 'firestore update fallito (403): PERMISSION_DENIED' } });
  await page.evaluate((id) => window.__mgTest.openDetail(id), prima._id);
  // Il click e subito l'altra pratica: la risposta arriva a scheda cambiata.
  await page.locator('#mgPreapproveBtn').click();
  await page.evaluate((id) => window.__mgTest.openDetail(id), altra._id);

  await expect(page.locator('#mgManageMsg')).toContainText('Segno non messo (#581): firestore update fallito (403)');
  await expect(page.locator('#mgManageMsg')).toHaveClass(/mg-err/);
  await expect(page.locator('.mg-item .mg-preapproved')).toHaveCount(0);
});

test('se il server non fonde, la pagina lo dice e non ritenta da sola', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  await apri(page, [fb], { pending: [richiesta()], approveReply: { ok: false, error: 'github_no_token' } });
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await page.locator('#mgPreapproveBtn').click();

  await expect(page.locator('#mgManageMsg')).toContainText('Il server non ha la credenziale con cui scrive: nessuna fusione è avvenuta.');
  await expect(page.locator('#mgManageMsg')).toHaveClass(/mg-err/);
  await expect(page.locator('#mgPreapproveBtn')).toHaveText('Chiedimi prima di fondere');
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.waitForTimeout(400);
  expect(await approvazioni(page)).toEqual(['ab12cd34ef56ab12cd34ef56']);
});
