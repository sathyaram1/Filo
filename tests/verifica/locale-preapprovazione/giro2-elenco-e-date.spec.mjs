// VERIFICA LOCALE, giro 2 — «Fuse senza chiedere» in Gestione → Automazioni.
//
// Scritta da fuori, senza guardare il lavoro. Le porte del giro 1 si
// ri-provano, non si riscoprono:
//   1. dalla nona fusione in poi l'elenco NON perde le più vecchie: nove
//      tracce sono nove righe; se il server ne lascia fuori qualcuna la pagina
//      lo DICE, con il numero;
//   2. la data della fusione è per esteso, non solo «N giorni fa»;
// e si aprono le vicine:
//   3. il momento in cui era stato messo il segno (hover su «pre-approvata
//      da») si legge come una data, non come un timestamp grezzo;
//   4. testo ostile in chi ha pre-approvato, nel ramo e nel numero della
//      pratica resta testo;
//   5. il segno tolto dallo script mentre Gestione è aperta sparisce da solo
//      (il gemello del «messo dallo script» del giro 1);
//   6. chi non è l'owner non vede l'elenco, e il main vero gli dice di no.
//
// Il canale verso il main è sostituito (stesso schema del giro 1): il codice
// VERO di lettura e disegno gira; il gate proprietario si prova sul main vero.

import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const SHA = 'c0ffee11'.repeat(5);
const MERGE_SHA = 'deadbeef'.repeat(5);

function pratica(over = {}) {
  return Object.assign({
    _id: 'fb-pre-002',
    text: 'Le regole del database vanno strette sui percorsi condivisi.',
    name: 'Regole strette sui percorsi',
    seq: 502,
    subSeq: 0,
    clientId: 'tester@example.com',
    createdAt: '2026-09-10T10:00:00Z',
    images: [],
    status: 'working',
    statusPublic: 'open',
    mergePreapproved: { by: 'owner@esempio', at: '2026-09-13T08:00:00.000Z' },
  }, over);
}

function fusa(i, over = {}) {
  const at = Date.now() - i * 60 * 60 * 1000;
  return Object.assign({
    id: `worker-${i}-${SHA.slice(0, 8)}`,
    branch: `worker/lavoro-${i}`,
    sha: SHA,
    mergeSha: MERGE_SHA,
    who: 'secaudit · notturna',
    origin: 'routine',
    num: `#${500 + i}`,
    feedbackId: `fb-${i}`,
    blocks: [
      { gate: 'guard_the_guards', label: 'Tocca aree protette (guardie, regole del database, chiavi, automatismi)', items: ['firestore.rules'], more: 0 },
    ],
    createdAtMs: at,
    expiresAtMs: at + 7 * 24 * 60 * 60 * 1000,
    expired: false,
    used: true,
    discarded: false,
    outcome: 'merged',
    decidedAtMs: at,
    preapproved: true,
    preapprovedBy: 'owner@esempio',
    preapprovedAt: '2026-09-13T08:00:00.000Z',
  }, over);
}

async function apri(page, { admin = true, fbs = [], preapproved = [], preapprovedTotal } = {}) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo && window.SN_MANAGE_REVIEW);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((cfg) => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: cfg.admin, isAdmin: cfg.admin, profile: null };
      if (t === 'merge_approvals_get') {
        if (!cfg.admin) return { ok: false, error: 'Operazione riservata agli amministratori.' };
        const r = { ok: true, pending: [], failed: [], recent: [], preapproved: cfg.preapproved, ttlMs: 7 * 24 * 60 * 60 * 1000 };
        if (cfg.preapprovedTotal !== undefined) r.preapprovedTotal = cfg.preapprovedTotal;
        return r;
      }
      if (t === 'feedback_update') return { ok: true, by: 'owner@esempio' };
      return orig(msg);
    };
  }, { admin, preapproved, preapprovedTotal });
  await page.evaluate((a) => window.__mgTest.setAdmin(a), admin);
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), fbs);
}

async function automazioni(page) {
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.locator('.mg-tab[data-tab="automation"]').click();
  return page.locator('#mgMergeApprovalsPreapproved');
}

// ── 1. Nove e più: nessuna sparisce in silenzio (porta del giro 1) ──────────

test('nove fusioni pre-approvate: nove righe, tutte leggibili, nessun avviso di tagli', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const tracce = Array.from({ length: 9 }, (_, i) => fusa(i + 1));
  await apri(page, { fbs: [pratica()], preapproved: tracce, preapprovedTotal: 9 });
  const sez = await automazioni(page);
  await expect(sez).toBeVisible({ timeout: 8_000 });
  await expect(sez.locator('.sn-mac-preapproved-row')).toHaveCount(9);
  const testo = await sez.innerText();
  for (let i = 1; i <= 9; i++) {
    expect(testo).toContain(`worker/lavoro-${i}`);
    expect(testo).toContain(`#${500 + i}`);
  }
  expect(testo).not.toMatch(/non entra/);
});

test('trenta fusioni: trenta righe, con la data per esteso su ognuna', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const tracce = Array.from({ length: 30 }, (_, i) => fusa(i + 1));
  await apri(page, { fbs: [pratica()], preapproved: tracce, preapprovedTotal: 30 });
  const sez = await automazioni(page);
  await expect(sez).toBeVisible({ timeout: 8_000 });
  await expect(sez.locator('.sn-mac-preapproved-row')).toHaveCount(30);
  await expect(sez.locator('.sn-mac-recent-when')).toHaveCount(30);
  const quando = await sez.locator('.sn-mac-recent-when').allInnerTexts();
  for (const q of quando) expect(q).toMatch(/^fusa il \d\d\/\d\d\/\d{4} alle \d\d:\d\d \(.+ fa\)$/);
});

test('se il server ne lascia fuori, la pagina dice quante (e non finge che siano tutte)', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const tracce = Array.from({ length: 12 }, (_, i) => fusa(i + 1));
  await apri(page, { fbs: [pratica()], preapproved: tracce, preapprovedTotal: 62 });
  const sez = await automazioni(page);
  await expect(sez).toBeVisible({ timeout: 8_000 });
  await expect(sez.locator('.sn-mac-preapproved-row')).toHaveCount(12);
  await expect(sez.locator('.sn-mac-preapproved-more')).toHaveText(/altre 50/);

  // Una sola fuori: al singolare.
  await page.evaluate((t) => { window.__tracce = t; }, tracce);
  await page.evaluate(() => {
    const orig = window.filo.message;
    window.filo.message = async (msg) => (msg && msg.type === 'merge_approvals_get')
      ? { ok: true, pending: [], failed: [], recent: [], preapproved: window.__tracce, preapprovedTotal: 13, ttlMs: 1 }
      : orig(msg);
  });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await expect(sez.locator('.sn-mac-preapproved-more')).toHaveText(/un.altra/);
});

// ── 2. Il momento del segno: una data, non un timestamp grezzo ──────────────

test('in hover su «pre-approvata da» il momento del segno si legge come data', async ({ openTab }) => {
  // Rilievo del giro 2: oggi l'hover dice «Segno messo il 2026-09-13T08:00:00.000Z».
  const page = await openTab(MANAGE);
  await apri(page, { fbs: [pratica()], preapproved: [fusa(1)], preapprovedTotal: 1 });
  const sez = await automazioni(page);
  await expect(sez).toBeVisible({ timeout: 8_000 });
  const who = sez.locator('.sn-mac-recent-who').first();
  await expect(who).toHaveText(/pre-approvata da owner@esempio/);
  const title = await who.getAttribute('title');
  expect(title).toMatch(/\d\d\/\d\d\/\d{4} alle \d\d:\d\d/);
  expect(title).not.toMatch(/T\d\d:\d\d:\d\d/);
});

// ── 3. Testo ostile nei campi della traccia ─────────────────────────────────

test('testo ostile in chi ha pre-approvato, nel ramo e nel numero resta testo', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const ostile = fusa(1, {
    preapprovedBy: '<img src=x onerror="window.__xss=1">',
    branch: '<b onmouseover="window.__xss=2">worker/x</b>',
    num: '#<script>window.__xss=3</script>',
    who: '<svg onload="window.__xss=4">',
  });
  await apri(page, { fbs: [pratica()], preapproved: [ostile], preapprovedTotal: 1 });
  const sez = await automazioni(page);
  await expect(sez).toBeVisible({ timeout: 8_000 });
  await expect(sez.locator('img, svg, b, script')).toHaveCount(0);
  const testo = await sez.innerText();
  expect(testo).toContain('<img src=x onerror="window.__xss=1">');
  expect(testo).toContain('worker/x');
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

// ── 4. Il segno tolto dallo script mentre Gestione è aperta sparisce da solo ─

test('il segno tolto dallo script mentre Gestione è aperta sparisce da solo, in lista e nel dettaglio', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ _updateTime: 't1' });
  await apri(page, { fbs: [fb] });
  await page.evaluate((f) => window.__mgTest.setTab(window.SN_MANAGE_REVIEW.manageTabFor(f, {})), fb);
  await expect(page.locator('.mg-item .mg-preapproved')).toHaveCount(1);
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await expect(page.locator('#mgPreapproveBtn')).toHaveText('Chiedimi prima di fondere');

  const senza = pratica({ _updateTime: 't2', mergePreapproved: undefined });
  await page.evaluate((doc) => {
    window.__mgTest.setLiveSources({
      listVersions: async () => [{ _id: doc._id, _updateTime: 't2' }],
      getMany: async () => [doc],
    });
  }, senza);
  const r = await page.evaluate(() => window.__mgTest.pollNow());
  expect(r.changed).toBe(1);
  await expect(page.locator('.mg-item .mg-preapproved')).toHaveCount(0);
  await expect(page.locator('#mgPreapproveBtn')).toHaveText('Fondi senza chiedermelo');
  await expect(page.locator('#mgPreapprovedInfo')).toBeHidden();
});

// ── 5. Non è l'owner: l'elenco non c'è, e il main vero dice di no ───────────

test('chi non è l’owner non vede «Fuse senza chiedere»; il main vero rifiuta l’elenco', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, { admin: false, fbs: [pratica()], preapproved: [fusa(1)], preapprovedTotal: 1 });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await expect(page.locator('#mgMergeApprovalsPreapproved')).toBeHidden();

  const page2 = await openTab(MANAGE);
  await page2.waitForFunction(() => window.filo);
  const r = await page2.evaluate(() => window.filo.message({ type: 'merge_approvals_get' }));
  expect(r && r.ok).toBe(false);
  expect(String(r.error || '')).toMatch(/amministrator/i);
});
