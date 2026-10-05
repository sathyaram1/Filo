// VERIFICA #702, giro 3 — due Gestioni aperte: il segno «fondi senza chiedermelo» messo in una
// manda la fusione da tutte e due, e l'altra mostra il tasto acceso durante il tentativo.
// Server finto condiviso fra le due pagine: ne accetta una sola, come quello vero.

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
        // Il server vero segna la richiesta usata appena accetta, poi fonde.
        const primo = await window.__srvApprova(msg.id);
        if (!primo) return { ok: false, error: 'Questa richiesta era già stata usata.' };
        if (window.__cfg.approveDelayMs) await attesa(window.__cfg.approveDelayMs);
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


async function secondaGestione(app, shell, prima) {
  // «Duplica scheda»: l'unica strada per una seconda Gestione nella stessa finestra.
  await shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    const tabs = (snap && (snap.tabs || snap)) || [];
    const t = tabs.find((x) => String(x.url || '').startsWith('filo://manage'));
    return window.filoShell.tabs.duplicate(t.id);
  });
  const fine = Date.now() + 10000;
  while (Date.now() < fine) {
    const p = app.windows().find((w) => w !== prima && (() => { try { return new URL(w.url()).hostname === 'manage'; } catch (_) { return false; } })());
    if (p) { await p.waitForLoadState('domcontentloaded').catch(() => {}); return p; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('seconda Gestione non trovata');
}

test('r1 con due Gestioni aperte il segno manda UNA approvazione e nessuna dice un esito falso', async ({ app, shell, openTab }) => {
  test.setTimeout(120000);
  const usate = new Set();
  const srv = async (id) => { if (usate.has(id)) return false; usate.add(id); return true; };
  const fb = pratica({ status: 'design', statusReason: 'l5' });
  const req = richiesta();

  const a = await openTab(MANAGE);
  const b = await secondaGestione(app, shell, a);
  for (const p of [a, b]) await p.exposeFunction('__srvApprova', srv);
  for (const p of [a, b]) {
    await apri(p, { fbs: [fb], pending: [req], approveDelayMs: 6000 });
    await p.evaluate(() => window.__mgTest.setTab('inbox'));
  }

  // In A l'owner mette il segno: parte la fusione da sola.
  await a.evaluate((fid) => window.__mgTest.openDetail(fid), fb._id);
  await a.locator('#mgPreapproveBtn').click();
  await expect.poll(() => approvazioni(a), { timeout: 5000 }).toEqual([req.id]);

  // B lo viene a sapere come da un giro di un'altra Gestione.
  await daFuori(b, [segnata({ status: 'design', statusReason: 'l5', _updateTime: 't2' })]);
  await apriQuadrato(b, fb._id);
  await b.waitForTimeout(1500);
  const dalB = await approvazioni(b);
  const msgB = await b.locator('#mgManageMsg').textContent().catch(() => '');
  const statoB = await b.locator('#mgSideBody .sn-mac-status').textContent().catch(() => '');
  expect.soft(dalB, 'la seconda Gestione non deve mandare una seconda approvazione').toEqual([]);
  expect.soft(`${msgB} ${statoB}`).not.toContain('già stata usata');
});
