// VERIFICA LOCALE, giro 1 — «Fondi senza chiedermelo» messo DOPO il blocco.
//
// Scritta da fuori, senza guardare il lavoro. Cosa deve essere vero per
// l'owner davanti a Gestione:
//   1. una pratica con un ramo GIÀ fermo dai controlli: metto il segno e il
//      ramo va su main, senza toccare «Approva e fondi»;
//   2. il segno messo prima e il blocco che arriva dopo: stessa cosa, da solo;
//   3. il segno messo da fuori (lo script) mentre Gestione è aperta: stessa cosa;
//   4. se il segno NON viene salvato lo vedo, e niente si fonde;
//   5. il segno su una pratica non fa fondere il lavoro di un'altra pratica,
//      né il lavoro locale, né una richiesta già consumata;
//   6. se la fusione non riesce, rimettere il segno la ritenta.
//
// Il canale verso il main è sostituito (schema di merge-approvals.spec.mjs):
// gira il codice VERO di lettura, scrittura e disegno della pagina.

import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const SHA = 'a1b2c3d4'.repeat(5);
const GIORNO = 24 * 60 * 60 * 1000;

function pratica(over = {}) {
  return Object.assign({
    _id: 'fb-tardivo-1',
    name: 'Le regole del database lasciano leggere i segreti',
    text: 'Segnalazione: firestore.rules va stretto.',
    seq: 701, subSeq: 0,
    status: 'working', statusPublic: 'open',
    clientId: 'tester@esempio',
    createdAt: '2026-09-20T08:00:00Z',
    images: [],
    _updateTime: 't1',
  }, over);
}

/** Una richiesta ferma, come la manda il server. */
function richiesta(over = {}) {
  return Object.assign({
    id: 'ab12cd34ef56ab12cd34ef56',
    branch: 'worker/701-regole',
    sha: SHA,
    who: 'secaudit · notturna',
    origin: 'routine',
    num: '#701',
    feedbackId: 'fb-tardivo-1',
    blocks: [
      { gate: 'guard_the_guards', label: 'Tocca aree protette (guardie, regole del database, chiavi, automatismi)', items: ['firestore.rules'], more: 0 },
    ],
    createdAtMs: Date.now() - 2 * 60 * 1000,
    expiresAtMs: Date.now() + GIORNO,
    expired: false, used: false, discarded: false,
  }, over);
}

/**
 * Canale verso il main sostituito. `window.__cfg` resta modificabile dal test:
 * l'elenco in attesa cambia fra una lettura e l'altra, come sul server vero.
 * Ogni gesto verso il main finisce in `window.__calls`.
 */
async function apri(page, { fbs = [], pending = [], updateReply = null, approveReplies = null } = {}) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo && window.SN_MANAGE_REVIEW);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((cfg) => {
    window.__calls = [];
    window.__cfg = cfg;
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') {
        return { ok: true, pending: window.__cfg.pending, failed: [], recent: [], preapproved: [], ttlMs: 7 * 24 * 60 * 60 * 1000 };
      }
      if (t === 'feedback_update') {
        window.__calls.push(msg);
        if (window.__cfg.updateReply) return window.__cfg.updateReply;
        return msg.mergePreapproved === true ? { ok: true, by: 'owner@esempio' } : { ok: true };
      }
      if (t === 'merge_approval_approve') {
        window.__calls.push(msg);
        const code = (window.__cfg.approveReplies || []).shift();
        if (code) return code;
        // Il server fonde e la richiesta esce dall'elenco in attesa.
        window.__cfg.pending = window.__cfg.pending.filter((r) => r.id !== msg.id);
        return { ok: true, result: 'merged', sha: 'feedface' + '0'.repeat(32) };
      }
      return orig(msg);
    };
  }, { pending, updateReply, approveReplies });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((list) => window.__mgTest.setData(list), fbs);
  await page.evaluate((f) => window.__mgTest.setTab(window.SN_MANAGE_REVIEW.manageTabFor(f, {})), fbs[0]);
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
}

const approvazioni = (page) => page.evaluate(() => window.__calls.filter((c) => c.type === 'merge_approval_approve'));



// ── 1. Il cuore: segno messo con il ramo GIÀ fermo ─────────────────────────

test('ramo già fermo, metto il segno: si fonde senza toccare «Approva e fondi»', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  const req = richiesta();
  await apri(page, { fbs: [fb], pending: [req] });
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);

  const btn = page.locator('#mgPreapproveBtn');
  await expect(btn).toHaveText('Fondi senza chiedermelo');
  await btn.click();

  // Il gesto verso il server è partito da solo, per quella richiesta.
  await expect.poll(() => approvazioni(page)).toEqual([{ type: 'merge_approval_approve', id: req.id }]);
  // E l'owner legge che il lavoro è arrivato su main.
  await expect(page.locator('#mgManageMsg')).toContainText('su main');
  await expect(btn).toHaveText('Chiedimi prima di fondere');
});

// ── 2. Segno prima, blocco dopo ────────────────────────────────────────────

test('pratica già segnata: la richiesta che arriva dopo si fonde da sola', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ mergePreapproved: { by: 'owner@esempio', at: '2026-09-20T09:00:00.000Z' } });
  const req = richiesta();
  await apri(page, { fbs: [fb], pending: [] });
  expect(await approvazioni(page)).toEqual([]);

  // Il server apre la richiesta: la pagina la rilegge.
  await page.evaluate((r) => { window.__cfg.pending = [r]; }, req);
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());

  await expect.poll(() => approvazioni(page)).toEqual([{ type: 'merge_approval_approve', id: req.id }]);
  await expect(page.locator('#mgManageMsg')).toContainText('su main');
});

// ── 3. Il segno messo da fuori, a Gestione aperta ──────────────────────────

test('segno messo dallo script mentre Gestione è aperta: la richiesta ferma si fonde', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  const req = richiesta();
  await apri(page, { fbs: [fb], pending: [req] });
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  expect(await approvazioni(page)).toEqual([]);

  // Lo stesso segno, scritto da fuori: arriva con l'aggiornamento continuo.
  const conSegno = pratica({ _updateTime: 't2', mergePreapproved: { by: 'owner (script)', at: '2026-09-20T10:00:00.000Z' } });
  await page.evaluate((doc) => {
    window.__mgTest.setLiveSources({
      listVersions: async () => [{ _id: doc._id, _updateTime: 't2' }],
      getMany: async () => [doc],
    });
  }, conSegno);
  const r = await page.evaluate(() => window.__mgTest.pollNow());
  expect(r.changed).toBe(1);
  // La pagina ha visto il segno…
  await expect(page.locator('#mgPreapproveBtn')).toHaveText('Chiedimi prima di fondere');
  // …e il ramo fermo deve partire lo stesso, senza riaprire la pagina.
  await expect.poll(() => approvazioni(page), { timeout: 8000 }).toEqual([{ type: 'merge_approval_approve', id: req.id }]);
});

// ── 4. Il segno non salvato si vede ────────────────────────────────────────

test('segno rifiutato dal server: l’owner lo legge, il tasto resta spento, niente si fonde', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  await apri(page, { fbs: [fb], pending: [richiesta()], updateReply: { ok: false, error: 'permesso negato' } });
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);

  const btn = page.locator('#mgPreapproveBtn');
  await btn.click();

  const msg = page.locator('#mgManageMsg');
  await expect(msg).toContainText('permesso negato');
  await expect(msg).toHaveClass(/mg-err/);
  // Il tasto non deve mentire: il segno non c'è.
  await expect(btn).toHaveText('Fondi senza chiedermelo');
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#mgPreapprovedInfo')).toBeHidden();
  await expect(page.locator('.mg-item .mg-preapproved')).toHaveCount(0);
  // E niente è stato fuso.
  expect(await approvazioni(page)).toEqual([]);
});

test('canale muto quando metto il segno: niente fusione e l’owner lo legge', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  await apri(page, { fbs: [fb], pending: [richiesta()] });
  await page.evaluate(() => {
    const prec = window.filo.message;
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') throw new Error('canale chiuso');
      return prec(msg);
    };
  });
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await page.locator('#mgPreapproveBtn').click();

  await expect(page.locator('#mgManageMsg')).toHaveClass(/mg-err/);
  await expect(page.locator('#mgPreapproveBtn')).toHaveText('Fondi senza chiedermelo');
  expect(await approvazioni(page)).toEqual([]);
});

// ── 5. Il segno non deborda ────────────────────────────────────────────────

test('il segno copre solo il lavoro delle automazioni su QUESTA pratica', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  const altrui = richiesta({ id: 'ff'.repeat(12), feedbackId: 'fb-altra', num: '#702' });
  const locale = richiesta({ id: 'ee'.repeat(12), origin: 'locale', feedbackId: '', num: '' });
  const usata = richiesta({ id: 'dd'.repeat(12), used: true });
  await apri(page, { fbs: [fb], pending: [altrui, locale, usata] });
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);

  await page.locator('#mgPreapproveBtn').click();
  await expect(page.locator('#mgPreapproveBtn')).toHaveText('Chiedimi prima di fondere');
  // Nessuna delle tre è roba sua.
  await page.waitForTimeout(500);
  expect(await approvazioni(page)).toEqual([]);
});

// ── 6. Una fusione che non riesce si può ritentare ─────────────────────────

test('fusione non riuscita: togliere e rimettere il segno la ritenta', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  const req = richiesta();
  await apri(page, {
    fbs: [fb], pending: [req],
    approveReplies: [{ ok: false, error: 'github_502 unreachable' }],
  });
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);

  const btn = page.locator('#mgPreapproveBtn');
  await btn.click();
  await expect(page.locator('#mgManageMsg')).toContainText('riprova');
  expect(await approvazioni(page)).toHaveLength(1);

  // L'owner fa l'unica cosa che gli resta sotto le dita: toglie e rimette.
  await btn.click();
  await expect(btn).toHaveText('Fondi senza chiedermelo');
  await btn.click();
  await expect(btn).toHaveText('Chiedimi prima di fondere');

  // Quello che l'owner legge non deve fargli credere che il ramo sia partito.
  await expect(page.locator('#mgManageMsg')).toContainText('ferma');
  // Il ramo è ancora fermo: il secondo tentativo deve esserci.
  await expect.poll(() => approvazioni(page).then((a) => a.length), { timeout: 8000 }).toBe(2);
  await expect(page.locator('#mgManageMsg')).toContainText('su main');
});

// ── 7. L'esito di una fusione partita da sola ──────────────────────────────

test('fusione partita da sola e non riuscita: l’owner la legge senza aprire la pratica', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ mergePreapproved: { by: 'owner@esempio', at: '2026-09-20T09:00:00.000Z' } });
  const req = richiesta();
  await apri(page, {
    fbs: [fb], pending: [],
    approveReplies: [{ ok: false, error: 'github_502 unreachable' }],
  });
  // Nessuna pratica aperta: l'owner sta guardando la lista.
  await page.evaluate((r) => { window.__cfg.pending = [r]; }, req);
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await expect.poll(() => approvazioni(page).then((a) => a.length)).toBe(1);

  // La fusione non è avvenuta: deve arrivare sotto gli occhi, non in un
  // pannello che si apre solo cliccando la scheda.
  await expect(page.locator('#mgManageMsg')).toBeVisible();
  await expect(page.locator('#mgManageMsg')).toContainText('riprova');
});
