// VERIFICA LOCALE, giro 2 — «Fondi senza chiedermelo» messo DOPO il blocco.
//
// Il giro 1 ha chiuso: segno col ramo già fermo, segno prima e blocco dopo,
// segno messo da fuori col dettaglio aperto, segno rifiutato, ritentativo.
// Qui si bussa alle porte rimaste: più pratiche segnate insieme, più rami
// fermi sulla stessa pratica, il segno TOLTO da fuori, la richiesta riaperta
// dal server per i blocchi nuovi, e l'esito che non è una fusione.
//
// Il canale verso il main è sostituito (stesso schema del giro 1): gira il
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
        if (code) {
          if (code.consuma) window.__cfg.pending = window.__cfg.pending.filter((r) => r.id !== msg.id);
          return code;
        }
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


// ── 1. Due pratiche segnate, due rami fermi: l'esito di TUTTE e due ────────
// La prima non riesce, la seconda sì. Quella che non è riuscita resta ferma e
// non verrà ritentata da sola: se il suo perché non arriva sotto gli occhi
// dell'owner, quel ramo resta lì senza che nessuno sappia che c'è già stato un
// tentativo.

test('due pratiche segnate insieme: l’esito di quella non riuscita non si perde', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const uno = segnata();
  const due = segnata({ _id: 'fb-tardivo-2', seq: 702, name: 'Il terminale non ricorda la cartella' });
  const reqUno = richiesta();
  const reqDue = richiesta({ id: 'bb22cc33dd44bb22cc33dd44', num: '#702', feedbackId: 'fb-tardivo-2', branch: 'worker/702-terminale' });
  await apri(page, {
    fbs: [uno, due], pending: [reqUno, reqDue],
    approveReplies: [{ ok: false, error: 'github_502 unreachable' }],
  });

  // Nessuna pratica aperta: l'owner sta guardando la lista.
  await expect.poll(() => approvazioni(page), { timeout: 8000 }).toEqual([reqUno.id, reqDue.id]);

  // Il ramo della prima è ancora fermo. L'owner deve poterlo sapere.
  await expect.poll(() => leggibile(page, '#701'), { timeout: 6000 }).toBe(true);
});

// ── 2. Il segno da fuori mentre l'owner guarda un'ALTRA pratica ────────────

test('segno messo dallo script su una pratica mentre l’owner ne ha aperta un’altra', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const uno = pratica();
  const due = pratica({ _id: 'fb-tardivo-2', seq: 702, name: 'Il terminale non ricorda la cartella' });
  const req = richiesta();
  await apri(page, { fbs: [uno, due], pending: [req] });
  await page.evaluate((id) => window.__mgTest.openDetail(id), due._id);
  expect(await approvazioni(page)).toEqual([]);

  const r = await daFuori(page, [segnata({ _updateTime: 't2' }), Object.assign({}, due)]);
  expect(r.changed).toBe(1);

  await expect.poll(() => approvazioni(page), { timeout: 8000 }).toEqual([req.id]);
  await expect.poll(() => leggibile(page, 'su main'), { timeout: 6000 }).toBe(true);
});

// ── 3. Due rami fermi sulla STESSA pratica ────────────────────────────────
// Succede quando un giro consegna, viene fermato, e il giro dopo riconsegna:
// la richiesta vecchia resta in attesa per giorni. Il segno dice «fondi il
// lavoro delle automazioni su questa pratica», non «fondine uno».

test('due rami fermi sulla stessa pratica: il segno li fonde tutti e due', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  const primo = richiesta();
  const secondo = richiesta({ id: 'cc33dd44ee55cc33dd44ee55', branch: 'worker/701-regole-2', sha: 'b'.repeat(40) });
  await apri(page, { fbs: [fb], pending: [primo, secondo] });
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);

  await page.locator('#mgPreapproveBtn').click();
  await expect(page.locator('#mgPreapproveBtn')).toHaveText('Chiedimi prima di fondere');
  await expect.poll(() => approvazioni(page), { timeout: 8000 }).toEqual([primo.id, secondo.id]);
});

// ── 4. Il segno TOLTO da fuori ────────────────────────────────────────────
// «Chiedimi prima di fondere» deve valere subito, anche se a toglierlo è stato
// lo script mentre Gestione era aperta: fondere dopo un ripensamento è fondere
// senza il permesso di nessuno.

test('segno tolto dallo script: il ramo che si ferma dopo NON parte da solo', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = segnata();
  await apri(page, { fbs: [fb], pending: [] });
  expect(await approvazioni(page)).toEqual([]);

  const senzaSegno = pratica({ _updateTime: 't2' });
  delete senzaSegno.mergePreapproved;
  const r = await daFuori(page, [senzaSegno]);
  expect(r.changed).toBe(1);

  // Adesso i controlli fermano un ramo su quella pratica.
  await page.evaluate((req) => { window.__cfg.pending = [req]; }, richiesta());
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());

  await page.waitForTimeout(1500);
  expect(await approvazioni(page)).toEqual([]);
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await expect(page.locator('#mgPreapproveBtn')).toHaveText('Fondi senza chiedermelo');
});

// ── 5. La richiesta riaperta per i blocchi NUOVI ──────────────────────────
// Il server riallinea il ramo, trova blocchi che prima non c'erano e riapre la
// richiesta apposta perché l'owner li guardi: quella NON si fonde da sola, e
// la pratica deve restare segnata come ferma.

test('richiesta riaperta per blocchi nuovi: non si fonde da sola, e si vede che è ferma', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = segnata();
  const req = richiesta({
    id: 'dd44ee55ff66dd44ee55ff66',
    supersedes: 'ab12cd34ef56ab12cd34ef56',
    realigned: { from: SHA, to: 'c'.repeat(40), mainSha: 'd'.repeat(40) },
  });
  await apri(page, { fbs: [fb], pending: [req] });

  await page.waitForTimeout(1500);
  expect(await approvazioni(page)).toEqual([]);
  await expect(page.locator('.mg-item .mg-fusione-badge').first()).toBeVisible();
});

// ── 6. L'esito che non è una fusione ──────────────────────────────────────

test('il server risponde «conflitto»: la pagina non dice che il lavoro è su main', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  await apri(page, {
    fbs: [fb], pending: [richiesta()],
    approveReplies: [{ ok: true, result: 'conflict', consuma: true }],
  });
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);

  await page.locator('#mgPreapproveBtn').click();
  const msg = page.locator('#mgManageMsg');
  await expect(msg).toContainText('non si incastrano');
  await expect(msg).not.toContainText('su main');
  await expect(msg).toHaveClass(/mg-err/);
});
