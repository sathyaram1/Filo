// VERIFICA LOCALE, giro 1 — il segno «Fondi senza chiedermelo» in Gestione.
//
// Scritta da fuori, senza guardare il lavoro. Cosa deve essere vero per
// l'owner, davanti alla dashboard:
//   1. una pratica APERTA col segno lo mostra in lista e nel dettaglio, e il
//      dettaglio dice CHI l'ha messo;
//   2. dal dettaglio il segno si mette e si toglie (se si può aggiungere si
//      può togliere), e al main arriva solo sì/no — il "chi" non lo racconta
//      la pagina;
//   3. su una pratica CHIUSA il segno non si vede e non si può mettere;
//   4. chi non è l'owner non vede il tasto, e il main gli dice di no anche se
//      prova a chiamare il comando a mano;
//   5. Gestione → Automazioni, «Fuse senza chiedere»: data, pratica, ramo, sha,
//      chi aveva messo il segno e l'elenco INTERO di ciò che era stato
//      segnalato (cinquanta file: tutti, nessun «… e altri N»), con testo
//      ostile mostrato come testo; a elenco vuoto la sezione non c'è.
//
// Il canale verso il main è sostituito (stesso schema di merge-approvals.spec):
// il codice VERO di lettura e disegno gira; il gate proprietario si prova sul
// main vero, senza sostituzioni.

import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const SHA = 'c0ffee11'.repeat(5);
const MERGE_SHA = 'deadbeef'.repeat(5);

function pratica(over = {}) {
  return Object.assign({
    _id: 'fb-pre-001',
    text: 'Le regole del database vanno strette sui percorsi condivisi.',
    name: 'Regole strette sui percorsi',
    seq: 501,
    subSeq: 0,
    clientId: 'tester@example.com',
    createdAt: '2026-09-10T10:00:00Z',
    images: [],
    status: 'working',
    statusPublic: 'open',
    mergePreapproved: { by: 'owner@esempio', at: '2026-09-13T08:00:00.000Z' },
  }, over);
}

/** Una traccia «fusa senza chiedere», come la manda il server. */
function fusa(over = {}) {
  return Object.assign({
    id: 'ab12cd34ef56ab12cd34ef56',
    branch: 'worker/regole-strette',
    sha: SHA,
    mergeSha: MERGE_SHA,
    who: 'secaudit · notturna',
    origin: 'routine',
    num: '#501',
    feedbackId: 'fb-pre-001',
    blocks: [
      { gate: 'guard_the_guards', label: 'Tocca aree protette (guardie, regole del database, chiavi, automatismi)', items: ['firestore.rules'], more: 0 },
    ],
    createdAtMs: Date.now() - 3 * 60 * 60 * 1000,
    expiresAtMs: Date.now() + 4 * 24 * 60 * 60 * 1000,
    expired: false,
    used: true,
    discarded: false,
    outcome: 'merged',
    decidedAtMs: Date.now() - 3 * 60 * 60 * 1000,
    preapproved: true,
    preapprovedBy: 'owner@esempio',
    preapprovedAt: '2026-09-13T08:00:00.000Z',
  }, over);
}

async function apri(page, { admin = true, fbs = [], preapproved = [] } = {}) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo && window.SN_MANAGE_REVIEW);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((cfg) => {
    window.__preCalls = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: cfg.admin, isAdmin: cfg.admin, profile: null };
      if (t === 'merge_approvals_get') {
        if (!cfg.admin) return { ok: false, error: 'Operazione riservata agli amministratori.' };
        return { ok: true, pending: [], failed: [], recent: [], preapproved: cfg.preapproved, ttlMs: 7 * 24 * 60 * 60 * 1000 };
      }
      if (t === 'feedback_update') {
        window.__preCalls.push(msg);
        return msg.mergePreapproved === true ? { ok: true, by: 'owner@esempio' } : { ok: true };
      }
      return orig(msg);
    };
  }, { admin, preapproved });
  await page.evaluate((a) => window.__mgTest.setAdmin(a), admin);
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), fbs);
}

/** La scheda in cui la pratica vive, con la regola vera della pagina. */
async function vaiAllaScheda(page, fb) {
  await page.evaluate((f) => window.__mgTest.setTab(window.SN_MANAGE_REVIEW.manageTabFor(f, {})), fb);
}

// ── 1. Il segno si vede: lista e dettaglio, con chi l'ha messo ──────────────

test('pratica aperta col segno: in lista «senza chiedere», nel dettaglio il tasto acceso e chi l’ha messo', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  await apri(page, { fbs: [fb] });
  await vaiAllaScheda(page, fb);

  const item = page.locator('.mg-item');
  await expect(item).toHaveCount(1);
  const badge = item.locator('.mg-preapproved');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText('senza chiedere');
  await expect(badge).toHaveAttribute('title', /owner@esempio/);

  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  const btn = page.locator('#mgPreapproveBtn');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect(btn).toHaveText('Chiedimi prima di fondere');
  const info = page.locator('#mgPreapprovedInfo');
  await expect(info).toBeVisible();
  await expect(info).toContainText('owner@esempio');
  await expect(info).toContainText('senza chiedere');
});

// ── 2. Si mette e si toglie dal dettaglio; al main va solo sì/no ────────────

test('dal dettaglio il segno si mette e si toglie, e in lista compare e sparisce', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ mergePreapproved: undefined });
  await apri(page, { fbs: [fb] });
  await vaiAllaScheda(page, fb);
  await expect(page.locator('.mg-item')).toHaveCount(1);
  await expect(page.locator('.mg-item .mg-preapproved')).toHaveCount(0);

  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  const btn = page.locator('#mgPreapproveBtn');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  await expect(btn).toHaveText('Fondi senza chiedermelo');
  await expect(page.locator('#mgPreapprovedInfo')).toBeHidden();

  // Metti.
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect(btn).toHaveText('Chiedimi prima di fondere');
  await expect(page.locator('#mgPreapprovedInfo')).toBeVisible();
  await expect(page.locator('#mgPreapprovedInfo')).toContainText('owner@esempio');
  await expect(page.locator('.mg-item .mg-preapproved')).toHaveCount(1);
  await expect(page.locator('#mgManageMsg')).toContainText('senza chiedere');

  // Togli.
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  await expect(btn).toHaveText('Fondi senza chiedermelo');
  await expect(page.locator('#mgPreapprovedInfo')).toBeHidden();
  await expect(page.locator('.mg-item .mg-preapproved')).toHaveCount(0);

  // Al main sono arrivati due comandi: sì, poi no — sul feedback giusto, senza
  // toccare lo stato, e senza che la pagina racconti chi è.
  const calls = await page.evaluate(() => window.__preCalls);
  expect(calls).toHaveLength(2);
  expect(calls[0]).toMatchObject({ type: 'feedback_update', id: fb._id, mergePreapproved: true });
  expect(calls[1]).toMatchObject({ type: 'feedback_update', id: fb._id, mergePreapproved: false });
  for (const c of calls) {
    expect(c.status).toBeUndefined();
    expect(typeof c.mergePreapproved).toBe('boolean');
  }
});

test('due click in fretta non mandano due volte lo stesso comando', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ mergePreapproved: undefined });
  await apri(page, { fbs: [fb] });
  await vaiAllaScheda(page, fb);
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  const btn = page.locator('#mgPreapproveBtn');
  await expect(btn).toBeVisible();
  // Il secondo click arriva mentre il primo è in volo: deve cadere nel vuoto
  // (tasto spento), non tradursi in un «togli» che annulla il «metti».
  await page.evaluate(() => {
    const b = document.getElementById('mgPreapproveBtn');
    b.click(); b.click();
  });
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  const calls = await page.evaluate(() => window.__preCalls);
  expect(calls.map((c) => c.mergePreapproved)).toEqual([true]);
});

// ── 3. Pratica chiusa: il segno non si vede e non si mette ──────────────────

test('pratica chiusa col segno: niente in lista, niente tasto nel dettaglio', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ status: 'done', statusPublic: 'closed', resolvedInVersion: '0.0.1' });
  await apri(page, { fbs: [fb] });
  await vaiAllaScheda(page, fb);
  await expect(page.locator('.mg-item')).toHaveCount(1);
  await expect(page.locator('.mg-item .mg-preapproved')).toHaveCount(0);
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await expect(page.locator('#mgManage')).toBeVisible();
  await expect(page.locator('#mgPreapproveBtn')).toBeHidden();
  await expect(page.locator('#mgPreapprovedInfo')).toBeHidden();
});

// ── 4. Non è l'owner: niente tasto, e il main dice di no ────────────────────

test('chi non è l’owner non vede il tasto', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  await apri(page, { admin: false, fbs: [fb] });
  await vaiAllaScheda(page, fb);
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await expect(page.locator('#mgPreapproveBtn')).toBeHidden();
});

test('il main vero rifiuta il comando a chi non è amministratore', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForFunction(() => window.filo);
  const r = await page.evaluate(() => window.filo.message({ type: 'feedback_update', id: 'fb-pre-001', mergePreapproved: true }));
  expect(r && r.ok).toBe(false);
  expect(String(r.error || '')).toMatch(/amministrator/i);
});

// ── 5. Automazioni → «Fuse senza chiedere» ──────────────────────────────────

test('Automazioni: la fusione avvenuta senza chiedere si legge per intero, e porta alla pratica', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  const files = Array.from({ length: 50 }, (_, i) => `scripts/lib/guardia-${String(i).padStart(2, '0')}.mjs`);
  const traccia = fusa({
    blocks: [
      { gate: 'guard_the_guards', label: 'Tocca aree protette (guardie, regole del database, chiavi, automatismi)', items: ['firestore.rules', ...files], more: 0 },
      { gate: 'secret_like', label: 'Assomiglia a un segreto', items: ['src/x.js:12 <img src=x onerror=alert(1)>'], more: 0 },
    ],
  });
  await apri(page, { fbs: [fb], preapproved: [traccia] });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.locator('.mg-tab[data-tab="automation"]').click();

  const sez = page.locator('#mgMergeApprovalsPreapproved');
  await expect(sez).toBeVisible({ timeout: 8_000 });
  await expect(sez).toContainText('Fuse senza chiedere');
  await expect(sez).toContainText('worker/regole-strette');
  await expect(sez).toContainText(MERGE_SHA.slice(0, 8));
  await expect(sez).toContainText('owner@esempio');
  await expect(sez).toContainText('#501');
  await expect(sez).toContainText(/fusa \d+ ore fa/);
  await expect(sez).toContainText('Tocca aree protette');
  await expect(sez).toContainText('Assomiglia a un segreto');
  // TUTTI i file, nessun «… e altri».
  const testo = await sez.innerText();
  for (const f of files) expect(testo).toContain(f);
  expect(testo).toContain('firestore.rules');
  expect(testo).not.toMatch(/e altri/);
  // Il testo ostile è testo: nessun elemento img creato.
  await expect(sez.locator('img')).toHaveCount(0);
  expect(testo).toContain('<img src=x onerror=alert(1)>');
  // Lo sha per intero si legge in hover.
  await expect(sez.locator('.sn-mac-sha')).toHaveAttribute('title', new RegExp(SHA));

  // Dalla traccia alla pratica: un click.
  await sez.locator('button', { hasText: '#501' }).click();
  await expect(page.locator('#mgPreapproveBtn')).toBeVisible();
  await expect(page.locator('#mgPreapprovedInfo')).toContainText('owner@esempio');
});

test('Automazioni: senza fusioni «senza chiedere» la sezione non c’è; nei Ricevuti non compare mai', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, { fbs: [pratica()], preapproved: [] });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.locator('.mg-tab[data-tab="automation"]').click();
  await expect(page.locator('#mgMergeApprovalsPreapproved')).toBeHidden();

  // Con una traccia: sta in Automazioni, non fra le cose da decidere.
  await page.evaluate((t) => { window.__preTraccia = t; }, fusa());
  await page.evaluate(() => {
    const orig = window.filo.message;
    window.filo.message = async (msg) => (msg && msg.type === 'merge_approvals_get')
      ? { ok: true, pending: [], failed: [], recent: [], preapproved: [window.__preTraccia], ttlMs: 1 }
      : orig(msg);
  });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await expect(page.locator('#mgMergeApprovalsPreapproved')).toBeVisible();
  await page.locator('.mg-tab[data-tab="inbox"]').click();
  await expect(page.locator('#mgMergeApprovals')).toBeHidden();
  await expect(page.locator('#mgMergeApprovalsPreapproved')).toBeHidden();
});

// ── 5bis. Il segno messo da fuori (script) arriva alla pagina aperta ────────

test('il segno messo dallo script mentre Gestione è aperta compare da solo, in lista e nel dettaglio', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ mergePreapproved: undefined, _updateTime: 't1' });
  await apri(page, { fbs: [fb] });
  await vaiAllaScheda(page, fb);
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await expect(page.locator('#mgPreapproveBtn')).toHaveText('Fondi senza chiedermelo');

  const conSegno = pratica({ _updateTime: 't2', mergePreapproved: { by: 'owner (script)', at: '2026-09-13T09:30:00.000Z' } });
  await page.evaluate((doc) => {
    window.__mgTest.setLiveSources({
      listVersions: async () => [{ _id: doc._id, _updateTime: 't2' }],
      getMany: async () => [doc],
    });
  }, conSegno);
  const r = await page.evaluate(() => window.__mgTest.pollNow());
  expect(r.changed).toBe(1);
  await expect(page.locator('.mg-item .mg-preapproved')).toHaveCount(1);
  await expect(page.locator('#mgPreapproveBtn')).toHaveText('Chiedimi prima di fondere');
  await expect(page.locator('#mgPreapprovedInfo')).toContainText('owner (script)');
});

// ── 6. Tema scuro: la traccia visiva (si guarda a mano) ─────────────────────

test('tema scuro e chiaro: catture del dettaglio e di Automazioni', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  await apri(page, { fbs: [fb], preapproved: [fusa()] });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await vaiAllaScheda(page, fb);
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await expect(page.locator('#mgPreapproveBtn')).toBeVisible();
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
    await expect(page.locator('#mgPreapproveBtn')).toBeVisible();
    await page.screenshot({ path: `tests/.shots/preapprovazione-dettaglio-${scheme}.png` });
    await page.locator('.mg-tab[data-tab="automation"]').click();
    await expect(page.locator('#mgMergeApprovalsPreapproved')).toBeVisible();
    await page.screenshot({ path: `tests/.shots/preapprovazione-automazioni-${scheme}.png`, fullPage: true });
    await page.evaluate((f) => window.__mgTest.setTab(window.SN_MANAGE_REVIEW.manageTabFor(f, {})), fb);
  }
});
