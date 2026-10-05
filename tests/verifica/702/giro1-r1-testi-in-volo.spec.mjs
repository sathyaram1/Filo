// VERIFICA #702, giro 1 — la fusione partita da sola: tasto spento e riga d'attesa ci sono,
// ma il pannello e la lista dicono ancora che la fusione aspetta il sì dell'owner.
// Canale verso il main sostituito come nei giri locali: gira il codice vero della pagina.

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



/** Le frasi che si leggono nel pannello di lato e nella riga della pratica in lista. */
const testiPannello = (page) => page.evaluate(() => {
  const side = document.querySelector('#mgSideBody');
  return side ? side.innerText : '';
});
const rigaLista = (page, id) => page.evaluate((fid) => {
  const it = Array.from(document.querySelectorAll('.mg-item')).find((i) => i.dataset.id === fid || i.textContent.includes('#701'));
  return it ? `${it.title} | ${it.innerText}` : '';
}, id);

test('r1 durante la fusione partita da sola nessuna frase dice che aspetta il tuo sì', async ({ openTab }) => {
  test.setTimeout(90000);
  const page = await openTab(MANAGE);
  const fb = segnata();
  const req = richiesta();
  await apri(page, { fbs: [fb], pending: [req], approveDelayMs: 8000 });
  await expect.poll(() => approvazioni(page), { timeout: 8000 }).toEqual([req.id]);
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
  await apriQuadrato(page, fb._id);

  await expect(page.locator('#mgSideBody .sn-mac-btn-go')).toBeDisabled();
  await expect(page.locator('#mgSideBody .sn-mac-title-text')).toHaveText('Una fusione in corso');
  const pannello = await testiPannello(page);
  expect.soft(pannello).not.toMatch(/via libera|Aspettano il tuo sì/);
  const riga = await rigaLista(page, fb._id);
  expect.soft(riga).toContain('#701');
  expect.soft(riga).not.toMatch(/aspetta il tuo via libera|fusione ferma/);

  // Riuscita: il titolo non può dire «in corso» o «aspetta» accanto a «è su main».
  await expect(page.locator('#mgSideBody .sn-mac-status')).toContainText('su main', { timeout: 12000 });
  const titolo = await page.locator('#mgSideBody .sn-mac-title-text').textContent();
  expect(titolo).not.toMatch(/in corso|aspetta/);
});
