// VERIFICA LOCALE, giro 3 — «Fondi senza chiedermelo» messo DOPO il blocco.
//
// I giri 1 e 2 hanno chiuso: segno col ramo già fermo, segno da fuori, segno
// rifiutato, ritentativo col tasto, esiti di più fusioni insieme. Qui si bussa
// a quello che resta: il ritentativo dall'ALTRA strada (lo script dell'owner),
// la fusione partita da sola mentre è ancora in corso, il segno che il server
// dice di aver preso e non ha preso, e l'esito che si deve ritrovare dopo che
// l'avviso è svanito.
//
// Il canale verso il main è sostituito (stesso schema dei giri prima): gira il
// codice vero di lettura, decisione e disegno della pagina.

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

const segnata = (over = {}) => pratica(Object.assign({
  mergePreapproved: { by: 'owner@esempio', at: '2026-09-20T09:00:00.000Z' },
}, over));

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

async function apri(page, { fbs = [], pending = [], updateReply = null, approveReplies = null, approveDelayMs = 0 } = {}) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo && window.SN_MANAGE_REVIEW);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((cfg) => {
    window.__calls = [];
    window.__cfg = cfg;
    const orig = window.filo.message.bind(window.filo);
    const attesa = (ms) => new Promise((res) => setTimeout(res, ms));
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
        if (window.__cfg.approveDelayMs) await attesa(window.__cfg.approveDelayMs);
        const code = (window.__cfg.approveReplies || []).shift();
        if (code) {
          if (code.consuma) window.__cfg.pending = window.__cfg.pending.filter((r) => r.id !== msg.id);
          return code;
        }
        window.__cfg.pending = window.__cfg.pending.filter((r) => r.id !== msg.id);
        return { ok: true, result: 'merged', sha: 'feedface' + '0'.repeat(32) };
      }
      return orig(msg);
    };
  }, { pending, updateReply, approveReplies, approveDelayMs });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((list) => window.__mgTest.setData(list), fbs);
  await page.evaluate((f) => window.__mgTest.setTab(window.SN_MANAGE_REVIEW.manageTabFor(f, {})), fbs[0]);
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
}

const approvazioni = (page) => page.evaluate(() => window.__calls.filter((c) => c.type === 'merge_approval_approve').map((c) => c.id));

/** C'è una frase che si LEGGE davvero sullo schermo? Dove stia non conta. */
const leggibile = (page, frase) => page.evaluate((f) => Array.from(document.body.querySelectorAll('*')).some((el) => {
  if (el.children.length || !String(el.textContent || '').includes(f)) return false;
  const r = el.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0)) return false;
  const st = getComputedStyle(el);
  return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0.05;
}), frase);

/** Il segno che arriva (o sparisce) da FUORI: script dell'owner, altra finestra. */
async function daFuori(page, docs) {
  await page.evaluate((list) => {
    window.__mgTest.setLiveSources({
      listVersions: async () => list.map((d) => ({ _id: d._id, _updateTime: d._updateTime })),
      getMany: async () => list,
    });
  }, docs);
  return page.evaluate(() => window.__mgTest.pollNow());
}

/** Apre il pannello del quadrato: lì stanno le card delle fusioni ferme. */
async function apriQuadrato(page, id) {
  await page.evaluate((fid) => window.__mgTest.openDetail(fid), id);
  await page.locator('.mg-forma[data-livello="l5"]').click();
}


// ── 1. Il ritentativo dall'ALTRA strada ───────────────────────────────────
// Il giro 1 ha chiuso il ritentativo col tasto: togliere e rimettere il segno
// nel dettaglio ritenta la fusione che non era riuscita. Lo script dell'owner
// fa la stessa identica cosa del tasto — e chi ha appena letto «server non
// raggiungibile, riprova» rifà il gesto da dove lo aveva fatto la prima volta.

test('fusione non riuscita: il segno rimesso dallo script la ritenta', async ({ openTab }) => {
  test.fail(true, 'rilievo aperto: dal terminale il segno rimesso non ritenta la fusione non riuscita');
  const page = await openTab(MANAGE);
  const req = richiesta();
  await apri(page, {
    fbs: [segnata()], pending: [req],
    approveReplies: [{ ok: false, error: 'github_502 unreachable' }],
  });

  await expect.poll(() => approvazioni(page), { timeout: 8000 }).toEqual([req.id]);
  await expect.poll(() => leggibile(page, 'nessuna fusione è avvenuta'), { timeout: 6000 }).toBe(true);

  // L'owner rifà il gesto da fuori: toglie il segno e lo rimette.
  const senza = pratica({ _updateTime: 't2' });
  delete senza.mergePreapproved;
  expect((await daFuori(page, [senza])).changed).toBe(1);
  expect((await daFuori(page, [segnata({ _updateTime: 't3' })])).changed).toBe(1);

  // Il ramo deve finire su main: è quello che il gesto chiede.
  await expect.poll(() => approvazioni(page), { timeout: 8000 }).toEqual([req.id, req.id]);
  await expect.poll(() => leggibile(page, 'su main'), { timeout: 6000 }).toBe(true);
});


// ── 2. La fusione partita da sola, mentre è ancora in corso ───────────────
// Il server scarica il diff, rifà i controlli e fonde: sono secondi, non
// millisecondi. In quella finestra la richiesta ferma è davanti all'owner
// esattamente com'era, e due clic la rimandano una seconda volta.

test('fusione partita da sola e ancora in corso: la richiesta ferma non si rilancia', async ({ openTab }) => {
  test.fail(true, 'rilievo aperto: la fusione in corso non si vede e due clic ne mandano una seconda');
  test.setTimeout(90000);
  const page = await openTab(MANAGE);
  const fb = segnata();
  const req = richiesta();
  await apri(page, { fbs: [fb], pending: [req], approveDelayMs: 20000 });

  await expect.poll(() => approvazioni(page), { timeout: 8000 }).toEqual([req.id]);
  await apriQuadrato(page, fb._id);

  const approva = page.locator('#mgSideBody .sn-mac-btn-go');
  await expect(approva).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/preapprovazione-tardiva-giro3-in-corso.png' });

  // Mentre ci prova lo deve dire: una richiesta ferma che non racconta niente
  // è una richiesta su cui l'owner rifà il lavoro che il server sta già facendo.
  await expect.soft(page.locator('#mgSideBody .sn-mac-status')).toBeVisible({ timeout: 1500 });

  if (await approva.isEnabled()) {
    await approva.click();
    await approva.click();
  }
  await page.waitForTimeout(1200);
  expect(await approvazioni(page)).toEqual([req.id]);
});


// ── 3. Il segno che il server dice di aver preso e non ha preso ───────────
// La metà della richiesta che riguarda il non-credere: un aggiornamento
// accettato ma scritto a metà (campo non ammesso dalle regole del database) fa
// tornare il documento senza segno al giro dopo. Da quel momento la pagina non
// deve più dire che da ora si fonde senza chiedere.

test('segno accettato ma non salvato: la pagina smette di dire che c’è', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  await apri(page, { fbs: [fb], pending: [] });
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);

  await page.locator('#mgPreapproveBtn').click();
  await expect(page.locator('#mgPreapproveBtn')).toHaveText('Chiedimi prima di fondere');
  expect(await leggibile(page, 'Da ora si fonde senza chiedere.')).toBe(true);

  // Il documento torna dal server senza il segno.
  expect((await daFuori(page, [pratica({ _updateTime: 't2' })])).changed).toBe(1);

  await expect(page.locator('#mgPreapproveBtn')).toHaveText('Fondi senza chiedermelo');
  await page.screenshot({ path: 'tests/.shots/preapprovazione-tardiva-giro3-segno-perso.png' });
  expect(await leggibile(page, 'Da ora si fonde senza chiedere.')).toBe(false);
});


// ── 4. L'esito si ritrova dopo che l'avviso è svanito ─────────────────────
// L'avviso in basso a destra dura pochi secondi e nessuno garantisce che
// l'owner sia davanti allo schermo. Il perché deve restare su quella richiesta.

test('fusione partita da sola e non riuscita: il perché resta sulla richiesta ferma', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = segnata();
  const req = richiesta();
  await apri(page, {
    fbs: [fb], pending: [req],
    approveReplies: [{ ok: false, error: 'github_502 unreachable' }],
  });

  await expect.poll(() => approvazioni(page), { timeout: 8000 }).toEqual([req.id]);
  await page.waitForTimeout(2000);
  await apriQuadrato(page, fb._id);
  await expect(page.locator('#mgSideBody .sn-mac-status')).toContainText('nessuna fusione è avvenuta');
});


// ── 5. Il tasto dopo un «Approva e fondi» andato male ─────────────────────
// La strada che viene in mente per prima davanti a un ramo fermo è il tasto
// della card. Se quello non riesce, il segno è il ripiego: deve ritentare.

test('«Approva e fondi» non riuscito, poi il segno: il ramo finisce su main', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  const req = richiesta();
  await apri(page, {
    fbs: [fb], pending: [req],
    approveReplies: [{ ok: false, error: 'github_502 unreachable' }],
  });
  await apriQuadrato(page, fb._id);

  const approva = page.locator('#mgSideBody .sn-mac-btn-go');
  await approva.click();
  await expect(approva).toHaveText('Confermi?');
  await approva.click();
  await expect(page.locator('#mgSideBody .sn-mac-status')).toContainText('nessuna fusione è avvenuta');

  await page.locator('#mgPreapproveBtn').click();
  await expect(page.locator('#mgPreapproveBtn')).toHaveText('Chiedimi prima di fondere');
  await expect.poll(() => approvazioni(page), { timeout: 8000 }).toEqual([req.id, req.id]);
  await expect.poll(() => leggibile(page, 'su main'), { timeout: 6000 }).toBe(true);
});
