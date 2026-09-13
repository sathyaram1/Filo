// IL SEGNO «FONDI SENZA CHIEDERMELO» SULLA PRATICA.
//
// COSA DEVE ESSERE VERO
//   L'owner approva le fusioni bloccate dai controlli perché si fida di chi ha
//   segnalato, e spesso lo sa già al triage: il click aggiunge solo attesa.
//   Da qui in poi può dirlo SULLA PRATICA, dal dettaglio in Gestione:
//     1. il tasto mette il segno e il gesto arriva al main (sì/no: il CHI lo
//        aggiunge il main dalla sessione), la pagina dice chi l'ha messo, e la
//        riga in lista porta un segno piccolo;
//     2. lo stesso tasto lo toglie (se si può mettere si può togliere);
//     3. su una pratica chiusa il tasto non c'è: il segno lì non conta;
//     4. Gestione → Automazioni elenca le fusioni avvenute senza chiedere, con
//        ramo, commit, chi aveva messo il segno e TUTTO ciò che era stato
//        segnalato — nessuna voce tagliata.
//
// COME
//   Come merge-approvals.spec.mjs: si stubba il canale verso il main e si
//   ripercorre il codice VERO di scrittura e disegno della pagina.

import { test, expect } from './fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const SHA = 'a1b2c3d4'.repeat(5);

function pratica(over = {}) {
  return Object.assign({
    _id: 'fb-preapprova-1',
    name: 'Le regole del database lasciano leggere i segreti',
    text: 'Segnalazione di sicurezza: tocca firestore.rules.',
    seq: 581, subSeq: 0,
    status: 'todo', statusPublic: 'open',
    clientId: 'tester@esempio',
    createdAt: '2026-09-13T08:00:00Z',
    images: [],
  }, over);
}

/** Il canale verso il main: proprietario, e le scritture registrate. */
async function stubMain(page, { preapproved = [] } = {}) {
  await page.evaluate((cfg) => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'feedback_update') {
        window.__updates.push(msg);
        return msg.mergePreapproved ? { ok: true, by: 'owner@esempio' } : { ok: true };
      }
      if (t === 'merge_approvals_get') {
        return { ok: true, pending: [], failed: [], recent: [], preapproved: cfg.preapproved, ttlMs: 7 * 24 * 60 * 60 * 1000 };
      }
      return orig(msg);
    };
  }, { preapproved });
}

async function apri(page, fbs, opts) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await stubMain(page, opts);
  await page.evaluate((list) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(list); }, fbs);
  // La pratica di prova sta «In coda» (todo): la lista si guarda lì.
  await page.evaluate((tab) => window.__mgTest.setTab(tab), (opts && opts.tab) || 'queue');
}

test('dal dettaglio: il segno si mette, la pagina dice chi, la lista lo mostra; e si toglie', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  await apri(page, [fb]);
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);

  const btn = page.locator('#mgPreapproveBtn');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveText('Fondi senza chiedermelo');
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  // L'hover spiega in una riga cosa comporta.
  await expect(btn).toHaveAttribute('title', /senza aspettare il tuo click/);
  await expect(page.locator('#mgPreapprovedInfo')).toBeHidden();
  await expect(page.locator('.mg-item .mg-preapproved')).toHaveCount(0);

  // 1. metterlo
  await btn.click();
  await expect(btn).toHaveText('Chiedimi prima di fondere');
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#mgPreapprovedInfo')).toBeVisible();
  await expect(page.locator('#mgPreapprovedInfo')).toContainText('owner@esempio');
  await expect(page.locator('#mgManageMsg')).toContainText('senza chiedere');
  // In lista: il segno piccolo.
  await expect(page.locator('.mg-item .mg-preapproved')).toHaveCount(1);
  await expect(page.locator('.mg-item .mg-preapproved')).toHaveAttribute('title', /owner@esempio/);
  // Il gesto è arrivato al main: sì/no, niente identità raccontata dalla pagina.
  let updates = await page.evaluate(() => window.__updates);
  expect(updates).toEqual([{ type: 'feedback_update', id: fb._id, mergePreapproved: true }]);

  // 2. toglierlo
  await btn.click();
  await expect(btn).toHaveText('Fondi senza chiedermelo');
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#mgPreapprovedInfo')).toBeHidden();
  await expect(page.locator('.mg-item .mg-preapproved')).toHaveCount(0);
  updates = await page.evaluate(() => window.__updates);
  expect(updates[1]).toEqual({ type: 'feedback_update', id: fb._id, mergePreapproved: false });
});

test('una pratica che arriva già col segno lo mostra, in lista e nel dettaglio', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ mergePreapproved: { by: 'owner@esempio', at: '2026-09-13T07:30:00.000Z' } });
  await apri(page, [fb]);
  await expect(page.locator('.mg-item .mg-preapproved')).toHaveCount(1);
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await expect(page.locator('#mgPreapproveBtn')).toHaveText('Chiedimi prima di fondere');
  await expect(page.locator('#mgPreapprovedInfo')).toContainText('owner@esempio');
  await expect(page.locator('#mgPreapprovedInfo')).toContainText('13/09/2026');
});

test('su una pratica chiusa il tasto non c’è, e un segno rimasto non si mostra', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ _id: 'fb-chiusa', status: 'done', statusPublic: 'closed', mergePreapproved: { by: 'owner@esempio', at: '2026-09-01T00:00:00Z' } });
  await apri(page, [fb], { tab: 'resolved' });
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await expect(page.locator('#mgStarBtn')).toBeVisible();
  await expect(page.locator('#mgPreapproveBtn')).toBeHidden();
  await expect(page.locator('#mgPreapprovedInfo')).toBeHidden();
  await expect(page.locator('.mg-item .mg-preapproved')).toHaveCount(0);
});

test('Automazioni elenca le fuse senza chiedere, con tutto quello che era stato segnalato', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const file = Array.from({ length: 30 }, (_, i) => `scripts/lib/guardia-${i}.mjs`);
  const fusa = {
    id: 'ab12cd34ef56ab12cd34ef56',
    branch: 'worker/581-regole',
    sha: SHA,
    mergeSha: 'feedfacefeedface'.repeat(2) + 'feedface',
    who: 'secaudit · notturna',
    origin: 'routine',
    num: '#581',
    feedbackId: 'fb-preapprova-1',
    blocks: [
      { gate: 'guard_the_guards', label: 'Tocca aree protette (guardie, regole del database, chiavi, automatismi)', items: file, more: 0 },
      { gate: 'secret_detected', label: 'Nelle modifiche c’è qualcosa che sembra un segreto', items: ['tests/agent/.env: FILO_TOKEN=…'], more: 0 },
    ],
    createdAtMs: Date.now() - 3 * 60 * 60 * 1000,
    decidedAtMs: Date.now() - 3 * 60 * 60 * 1000,
    used: true, outcome: 'merged',
    preapproved: true, preapprovedBy: 'owner@esempio', preapprovedAt: '2026-09-13T07:30:00.000Z',
  };
  await apri(page, [pratica()], { preapproved: [fusa] });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.locator('.mg-tab[data-tab="automation"]').click();

  const box = page.locator('#mgMergeApprovalsPreapproved');
  await expect(box).toBeVisible({ timeout: 8_000 });
  await expect(box).toContainText('Fuse senza chiedere');
  await expect(box).toContainText('worker/581-regole');
  await expect(box).toContainText('feedface');
  await expect(box).toContainText('pre-approvata da owner@esempio');
  await expect(box).toContainText('automazione · feedback #581');
  await expect(box).toContainText('Tocca aree protette');
  await expect(box).toContainText('sembra un segreto');
  // L'elenco intero: trenta file, tutti, uno per riga.
  await expect(box.locator('.sn-mac-block-items')).toHaveCount(31);
  await expect(box).toContainText('scripts/lib/guardia-29.mjs');
  await expect(box).not.toContainText('e altri');
  // Il feedback è a un click.
  await page.locator('#mgMergeApprovalsPreapproved .sn-mac-origin-link').click();
  await expect(page.locator('#mgDetail')).toBeVisible();
  await expect(page.locator('#mgDetail')).toContainText('#581');
  await expect(page.locator('#mgPreapproveBtn')).toBeVisible();
});

test('senza fusioni pre-approvate l’elenco non compare', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [pratica()], { preapproved: [] });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.locator('.mg-tab[data-tab="automation"]').click();
  await expect(page.locator('#mgMergeApprovalsPreapproved')).toBeHidden();
});
