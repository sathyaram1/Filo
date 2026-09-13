// VERIFICA LOCALE, giro 3 — Gestione: le porte che restavano da provare.
//
// Scritta da fuori, senza guardare il lavoro. Le prove dei giri 1 e 2 si
// rilanciano intere prima di queste (stessa cartella). Qui:
//   1. la porta messa da parte come decisione dell'owner al giro 1 (il segno
//      che sopravvive alla chiusura, senza un modo di toglierlo dalla
//      dashboard): ri-provata e segnata come attesa rossa finché l'owner non
//      decide;
//   2. il segno si vede in lista in OGNI stato aperto, non solo «in lavorazione»
//      (design, allineata, revisione di sicurezza, da fare, senza etichetta);
//   3. testo ostile in CHI ha messo il segno resta testo, nel dettaglio e in
//      hover sulla lista (il giro 2 l'aveva provato in Automazioni, non qui);
//   4. il main che rifiuta il comando: la pagina lo dice, il tasto torna com'era
//      e in lista non compare un segno che non c'è;
//   5. al tetto del server (duecento tracce) l'elenco le mostra tutte, ognuna con
//      la data per esteso, e dice quante sono rimaste fuori;
//   6. il numero della pratica su una traccia la cui pratica non è (più) in
//      lista: il click non deve morire in silenzio (attesa rossa, situazione
//      rara: rilievo di livello zero di questo giro).
//
// Il canale verso il main è sostituito (stesso schema dei giri 1 e 2): il
// codice VERO di lettura e disegno gira.

import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const SHA = 'c0ffee11'.repeat(5);
const MERGE_SHA = 'deadbeef'.repeat(5);

function pratica(over = {}) {
  return Object.assign({
    _id: 'fb-pre-003',
    text: 'Le regole del database vanno strette sui percorsi condivisi.',
    name: 'Regole strette sui percorsi',
    seq: 503,
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
    num: `#${600 + i}`,
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

async function apri(page, { admin = true, fbs = [], preapproved = [], preapprovedTotal, updateReply } = {}) {
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
        const r = { ok: true, pending: [], failed: [], recent: [], preapproved: cfg.preapproved, ttlMs: 7 * 24 * 60 * 60 * 1000 };
        if (cfg.preapprovedTotal != null) r.preapprovedTotal = cfg.preapprovedTotal;
        return r;
      }
      if (t === 'feedback_update') {
        window.__preCalls.push(msg);
        if (cfg.updateReply) return cfg.updateReply;
        return msg.mergePreapproved === true ? { ok: true, by: 'owner@esempio' } : { ok: true };
      }
      return orig(msg);
    };
  }, { admin, preapproved, preapprovedTotal, updateReply });
  await page.evaluate((a) => window.__mgTest.setAdmin(a), admin);
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), fbs);
}

async function vaiAllaScheda(page, fb) {
  await page.evaluate((f) => window.__mgTest.setTab(window.SN_MANAGE_REVIEW.manageTabFor(f, {})), fb);
}

async function automazioni(page) {
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.locator('.mg-tab[data-tab="automation"]').click();
  return page.locator('#mgMergeApprovalsPreapproved');
}

// ── 1. La porta messa da parte per l'owner (giro 1): attesa rossa ───────────

test('pratica CHIUSA col segno: dalla dashboard il segno si vede (spento) e si può togliere', async ({ openTab }) => {
  test.fail(true, 'Decisione dell’owner rimasta aperta dal giro 1: il segno sopravvive alla chiusura, invisibile, e dalla dashboard non si toglie (lo script «--chiedi-prima» sì). Diventa verde quando l’owner sceglie di mostrarlo spento a pratica chiusa.');
  const page = await openTab(MANAGE);
  const fb = pratica({ status: 'done', statusPublic: 'closed' });
  await apri(page, { fbs: [fb] });
  await vaiAllaScheda(page, fb);
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  // Il segno c'è sul documento: l'owner deve poterlo vedere e togliere.
  await expect(page.locator('#mgPreapprovedInfo')).toBeVisible();
  await expect(page.locator('#mgPreapproveBtn')).toBeVisible();
});

// ── 2. Il segno in lista in ogni stato aperto ───────────────────────────────

const STATI_APERTI = ['design', 'aligned', 'revision_security', 'todo', 'unlabeled', 'revision_capability'];

test('il segno si vede in lista in ogni stato aperto, non solo «in lavorazione»', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fbs = STATI_APERTI.map((status, i) => pratica({
    _id: `fb-stato-${status}`, seq: 610 + i, name: `Pratica in stato ${status}`, status, statusPublic: 'open',
  }));
  await apri(page, { fbs });
  for (const fb of fbs) {
    await vaiAllaScheda(page, fb);
    const item = page.locator('.mg-item', { hasText: fb.name });
    await expect(item, `stato ${fb.status}: la pratica deve stare nella sua scheda`).toHaveCount(1);
    await expect(item.locator('.mg-preapproved'), `stato ${fb.status}: il segno in lista`).toHaveText('senza chiedere');
    await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
    await expect(page.locator('#mgPreapproveBtn'), `stato ${fb.status}: il tasto acceso`).toHaveAttribute('aria-pressed', 'true');
  }
});

// ── 3. Testo ostile in chi ha messo il segno: dettaglio e hover in lista ────

test('testo ostile in chi ha messo il segno resta testo nel dettaglio e in hover sulla lista', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const ostile = '<img src=x onerror="window.__xssSegno=1"> "><b>x</b>';
  const fb = pratica({ mergePreapproved: { by: ostile, at: '2026-09-13T08:00:00.000Z' } });
  await apri(page, { fbs: [fb] });
  await vaiAllaScheda(page, fb);
  const badge = page.locator('.mg-item .mg-preapproved');
  await expect(badge).toHaveAttribute('title', new RegExp('segno messo da <img src=x'));
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  const info = page.locator('#mgPreapprovedInfo');
  await expect(info).toBeVisible();
  await expect(info).toContainText(ostile);
  await expect(info.locator('img, b')).toHaveCount(0);
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__xssSegno)).toBeUndefined();
});

// ── 4. Il main rifiuta: la pagina lo dice, e non finge il segno ─────────────

test('se il main rifiuta il comando, la pagina lo dice e il tasto torna com’era', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ mergePreapproved: undefined });
  await apri(page, { fbs: [fb], updateReply: { ok: false, error: 'Operazione riservata agli amministratori.' } });
  await vaiAllaScheda(page, fb);
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  const btn = page.locator('#mgPreapproveBtn');
  await expect(btn).toHaveText('Fondi senza chiedermelo');
  await btn.click();
  await expect(page.locator('#mgManageMsg')).toContainText('riservata');
  await expect(btn).toHaveText('Fondi senza chiedermelo');
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  await expect(btn).toBeEnabled();
  await expect(page.locator('#mgPreapprovedInfo')).toBeHidden();
  await expect(page.locator('.mg-item .mg-preapproved')).toHaveCount(0);
  // E si può riprovare: il secondo click parte davvero.
  await btn.click();
  await expect.poll(async () => page.evaluate(() => window.__preCalls.length)).toBe(2);
});

// ── 5. Al tetto del server: duecento righe, tutte con la data, e il conto ───

test('duecento fusioni pre-approvate: duecento righe con la data per esteso, e quante restano fuori', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const tracce = Array.from({ length: 200 }, (_, i) => fusa(i + 1));
  await apri(page, { fbs: [pratica()], preapproved: tracce, preapprovedTotal: 250 });
  const sez = await automazioni(page);
  await expect(sez).toBeVisible({ timeout: 8_000 });
  const righe = sez.locator('.sn-mac-preapproved-row');
  await expect(righe).toHaveCount(200);
  await expect(sez.locator('.sn-mac-preapproved-more')).toHaveText(/altre 50/);
  const quando = await sez.locator('.sn-mac-recent-when').allInnerTexts();
  expect(quando.length).toBe(200);
  for (const q of quando) expect(q).toMatch(/fusa il \d\d\/\d\d\/\d{4} alle \d\d:\d\d/);
  // La più recente sta in cima, la più vecchia in fondo (l'ordine del server si rispetta).
  await expect(righe.first()).toContainText('#601');
  await expect(righe.last()).toContainText('#800');
  // Il momento del segno, in hover, è una data e non un timestamp grezzo (porta del giro 2).
  await expect(righe.first().locator('.sn-mac-recent-who')).toHaveAttribute('title', /Segno messo il \d\d\/\d\d\/\d{4}/);
});

// ── 6. Il numero di una pratica che non è in lista: attesa rossa ────────────

test('il numero di una pratica che non è (più) in lista: il click non muore in silenzio', async ({ openTab }) => {
  test.fail(true, 'Rilievo di livello zero del giro 3: se la pratica della traccia non è fra quelle caricate, il click sul numero non fa niente e non dice niente.');
  const page = await openTab(MANAGE);
  const traccia = fusa(1, { num: '#999', feedbackId: 'fb-sparita' });
  await apri(page, { fbs: [pratica()], preapproved: [traccia] });
  const sez = await automazioni(page);
  await expect(sez).toBeVisible({ timeout: 8_000 });
  await sez.locator('button', { hasText: '#999' }).click();
  // O si apre un dettaglio, o la pagina dice che la pratica non c'è.
  const detail = page.locator('#mgDetail');
  const msg = page.locator('#mgManageMsg');
  await expect(detail.or(msg.filter({ hasText: /./ }))).toBeVisible({ timeout: 3_000 });
});
