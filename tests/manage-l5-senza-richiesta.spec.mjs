// #1040 (caso #952.1): una pratica ferma al cancello di fusione (design/l5) senza nessuna richiesta sul server.
// Prima la scheda diceva «la richiesta non è (ancora) arrivata» senza nessun tasto, e la pratica restava lì per
// sempre. Adesso, con gli elenchi delle richieste letti, il quadrato offre «Rifai la richiesta»: il server rifà L5
// sul ramo e apre la richiesta legata alla pratica, che compare sulla stessa scheda. Se il ramo non si fonde più con
// main lo dice e offre di rimetterla in coda. Canale verso il main stubbato come in livelli-forme.spec.mjs.

import { test, expect } from './fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const SHA = 'a1b2c3d4'.repeat(5);
const GIORNO = 24 * 60 * 60 * 1000;

const FERMA = {
  _id: 'fb-ferma-952',
  text: 'Il cancello ha fermato la fusione: tocca uno strumento protetto.',
  name: 'Fusione ferma',
  seq: 952, subSeq: 1,
  status: 'design', statusReason: 'l5',
  branch: 'worker/fb-ferma-952',
  clientId: 'tester@example.com',
  createdAt: '2026-10-04T10:00:00Z',
  images: [],
  livelli: { l4: { esito: 'pass', at: '2026-10-04T11:00:00Z', testo: 'Letto il diff: niente di strano.' } },
};

const richiesta = {
  id: 'ab12cd34ef56ab12cd34ef56',
  branch: FERMA.branch, sha: SHA, who: 'owner@esempio', num: '#952.1', feedbackId: FERMA._id, origin: 'routine',
  blocks: [{ gate: 'guard_the_guards', label: 'Tocca aree protette', items: ['.claude/hooks/auto-commit-merge.sh'], more: 0 }],
  createdAtMs: Date.now() - 60 * 1000, expiresAtMs: Date.now() + 7 * GIORNO,
  expired: false, used: false, discarded: false,
};

async function apri(page, { elenchiOk = true, rifai = { ok: true, esito: 'richiesta', requestId: richiesta.id } } = {}) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((cfg) => {
    window.__chiamate = [];
    window.__pending = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') {
        if (!cfg.elenchiOk) return { ok: false, error: 'non raggiungibile' };
        return { ok: true, pending: window.__pending, failed: [], recent: [], preapproved: [], ttlMs: 7 * 24 * 3600 * 1000 };
      }
      if (t === 'fusione_richiesta_rifai') {
        window.__chiamate.push(msg);
        await new Promise((r) => setTimeout(r, 300));
        // Il server ha aperto la richiesta legata alla pratica: da qui in poi l'elenco la porta.
        if (cfg.rifai && cfg.rifai.esito === 'richiesta') window.__pending = [cfg.richiesta];
        return cfg.rifai;
      }
      if (t === 'feedback_update') { window.__chiamate.push(msg); return { ok: true }; }
      return orig(msg);
    };
  }, { elenchiOk, rifai, richiesta });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), [FERMA]);
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.evaluate((id) => window.__mgTest.openDetail(id), FERMA._id);
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').click();
}

test('ferma al cancello senza richiesta: il quadrato lo dice, e «Rifai la richiesta» la fa comparire sulla stessa scheda', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);

  const quad = page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]');
  await expect(quad).toHaveClass(/mg-forma--attack/);
  const pannello = page.locator('#mgSideBody');
  await expect(pannello).toContainText('non hai niente da approvare');
  await expect(pannello).not.toContainText('non è (ancora) arrivata');
  await expect(pannello.locator('.sn-mac-card')).toHaveCount(0);
  await page.screenshot({ path: 'tests/.shots/manage-l5-senza-richiesta-ferma.png' });

  const btn = page.locator('#mgRifaiRichiestaBtn');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveAttribute('title', /ricontrolla la versione del ramo/);
  await btn.click();
  await expect(pannello.locator('.mg-liv-esito')).toContainText('Chiedo al server');

  await expect.poll(() => page.evaluate(() => window.__chiamate.filter((c) => c.type === 'fusione_richiesta_rifai').length)).toBe(1);
  const chiesta = await page.evaluate(() => window.__chiamate[0]);
  expect(chiesta.feedbackId).toBe(FERMA._id);
  expect(chiesta.branch).toBe(FERMA.branch);

  // Il successo per l'owner: la richiesta da approvare c'è, sul quadrato della pratica, coi suoi tasti.
  await expect(pannello.locator('.sn-mac-card')).toHaveCount(1, { timeout: 8_000 });
  await expect(pannello.locator('.sn-mac-btn-go')).toBeVisible();
  await expect(pannello).toContainText('auto-commit-merge.sh');
  await expect(page.locator('#mgRifaiRichiestaBtn')).toHaveCount(0);
  await expect(page.locator('#mgToast')).toContainText('Richiesta rifatta');
  await page.screenshot({ path: 'tests/.shots/manage-l5-senza-richiesta-rifatta.png' });
});

test('il ramo non si fonde più con main: lo dice, resta detto alle riletture, e «Rimetti in coda» la rimette in coda', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, { rifai: { ok: true, esito: 'conflitto' } });
  await page.locator('#mgRifaiRichiestaBtn').click();

  const pannello = page.locator('#mgSideBody');
  await expect(pannello.locator('.mg-liv-testo')).toContainText('non si fonde più con main', { timeout: 8_000 });
  const coda = page.locator('#mgRimettiInCodaBtn');
  await expect(coda).toBeVisible();
  await expect(page.locator('#mgRifaiRichiestaBtn')).toHaveCount(0);

  // Una rilettura delle fusioni ridisegna il pannello: l'esito non sparisce con lui.
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.waitForTimeout(300);
  await expect(pannello.locator('.mg-liv-testo')).toContainText('non si fonde più con main');
  await expect(pannello).not.toContainText('Rifalla');
  await page.screenshot({ path: 'tests/.shots/manage-l5-senza-richiesta-conflitto.png' });

  await coda.click();
  await expect.poll(() => page.evaluate(() => window.__chiamate.filter((c) => c.type === 'feedback_update').map((c) => c.status))).toEqual(['todo']);
});

// Verifica #1040 giro 1, rilievo 1: dopo i controlli il ramo ha preso commit nuovi. Il server non li fonde né li chiede:
// la scheda lo dice e propone di rimettere in coda, come per il ramo che non si fonde più.
test('ramo cambiato dopo i controlli: lo dice e propone «Rimetti in coda», non un errore da riprovare', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, { rifai: { ok: true, esito: 'cambiato' } });
  await page.locator('#mgRifaiRichiestaBtn').click();
  const pannello = page.locator('#mgSideBody');
  await expect(pannello.locator('.mg-liv-testo')).toContainText('commit che nessuno ha letto', { timeout: 8_000 });
  await expect(page.locator('#mgRimettiInCodaBtn')).toBeVisible();
  await expect(page.locator('#mgRifaiRichiestaBtn')).toHaveCount(0);
  await page.locator('#mgRimettiInCodaBtn').click();
  await expect.poll(() => page.evaluate(() => window.__chiamate.filter((c) => c.type === 'feedback_update').map((c) => c.status))).toEqual(['todo']);
});

test('un errore del server si dice, e il tasto resta per riprovare', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, { rifai: { ok: false, error: 'GitHub non risponde: riprova fra poco.' } });
  await page.locator('#mgRifaiRichiestaBtn').click();
  const pannello = page.locator('#mgSideBody');
  await expect(pannello.locator('.mg-liv-esito')).toContainText('GitHub non risponde', { timeout: 8_000 });
  await expect(page.locator('#mgRifaiRichiestaBtn')).toBeEnabled();
});

// «Salta il controllo» con la richiesta non registrata: il server non porta più la pratica in design/l5, la lascia
// ferma all'audit con l'audit già segnato saltato. Il tasto deve restare, o la pratica sarebbe di nuovo senza uscita.
test('audit già saltato ma pratica ancora ferma all’audit: «Salta il controllo» resta per ripremere', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (msg && msg.type === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [] };
      return orig(msg);
    };
  });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  const saltato = { ...FERMA, _id: 'fb-saltato', statusReason: 'secaudit', livelli: { l4: { esito: 'saltato', by: 'owner', at: '2026-10-05T10:00:00Z' } } };
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), [saltato]);
  await page.evaluate((id) => window.__mgTest.openDetail(id), saltato._id);
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l4"]').click();
  await expect(page.locator('#mgSaltaL4Btn')).toBeVisible();
});

test('elenchi delle richieste non letti: nessun tasto, perché non si sa se la richiesta c’è', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, { elenchiOk: false });
  const pannello = page.locator('#mgSideBody');
  await expect(pannello).toContainText('non è (ancora) arrivata');
  await expect(page.locator('#mgRifaiRichiestaBtn')).toHaveCount(0);
});
