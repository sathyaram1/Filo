// UNA PRATICA FERMA AL CANCELLO SENZA RICHIESTA DA APPROVARE — #1038 (caso #952.1).
//
// Il cancello del server ha fermato la fusione, la pratica è in design/l5, ma sul server non esiste nessuna
// richiesta di via libera. Prima la scheda restava col quadrato rosso e una frase, senza tasti: la pratica
// non usciva più da lì. Deve essere vero che, con gli elenchi delle richieste letti:
//   1. il quadrato offre «Chiedi di nuovo la fusione», che arriva al main con l'id della pratica, e la
//      richiesta riaperta compare nello stesso pannello con i suoi tasti;
//   2. se il ramo non si fonde più con main (o non c'è più) lo dice e propone di rimetterla in coda;
//   3. una richiesta che l'owner aveva scartato non si richiede: si rimette in coda;
//   4. senza elenchi (lettura fallita) non promette niente.
// Il canale verso il main è stubbato come in livelli-forme.spec.mjs; il gestore del main ha i suoi unit
// (tests/unit/riapriFusione.test.mjs).

import { test, expect } from './fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const SHA = 'a1b2c3d4'.repeat(5);
const GIORNO = 24 * 60 * 60 * 1000;

const FERMA = {
  _id: 'fb-952-1',
  text: 'Il riquadro delle note perde il cursore quando si cambia scheda.',
  name: 'Cursore perso',
  seq: 952, subSeq: 1,
  status: 'design', statusReason: 'l5',
  branch: 'worker/Te5j-952',
  clientId: 'tester@example.com',
  createdAt: '2026-10-04T08:00:00Z',
  images: [],
  livelli: { l4: { esito: 'pass', at: '2026-10-04T10:00:00Z', testo: 'Controllato il diff.' } },
};

function richiesta(over = {}) {
  return Object.assign({
    id: 'req952req952req952req952',
    branch: FERMA.branch,
    sha: SHA,
    who: 'owner@esempio',
    num: '#952.1',
    feedbackId: FERMA._id,
    origin: 'routine',
    blocks: [{ gate: 'guard_the_guards', label: 'Tocca aree protette', items: ['scripts/merge-gate.mjs'], more: 0 }],
    createdAtMs: Date.now() - 60 * 1000,
    expiresAtMs: Date.now() + 7 * GIORNO,
    expired: false, used: false, discarded: false,
  }, over);
}

/**
 * Il canale verso il main. `riapri` è la risposta a «Chiedi di nuovo la fusione»; dopo una risposta
 * `richiesta` l'elenco riletto contiene `dopo` (la richiesta che il server ha aperto).
 */
async function stub(page, { recent = [], riapri = null, dopo = null, elencoRotto = false } = {}) {
  await page.evaluate((cfg) => {
    window.__chiamate = [];
    let riaperta = false;
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') {
        if (cfg.elencoRotto) return { ok: false, error: 'rete' };
        const pending = riaperta && cfg.dopo ? [cfg.dopo] : [];
        return { ok: true, pending, failed: [], recent: cfg.recent, preapproved: [], ttlMs: 7 * 24 * 60 * 60 * 1000 };
      }
      if (t === 'merge_approval_reopen') {
        window.__chiamate.push(msg);
        await new Promise((r) => setTimeout(r, 200));
        riaperta = true;
        return cfg.riapri;
      }
      if (t === 'merge_approval_approve' || t === 'merge_approval_discard' || t === 'feedback_update') {
        window.__chiamate.push(msg);
        return { ok: true, result: t === 'merge_approval_discard' ? 'discarded' : 'merged' };
      }
      return orig(msg);
    };
  }, { recent, riapri, dopo, elencoRotto });
}

async function apri(page, opts = {}) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await stub(page, opts);
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), [FERMA]);
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.evaluate((id) => window.__mgTest.openDetail(id), FERMA._id);
  const quad = page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]');
  await expect(quad).toHaveClass(/mg-forma--attack/);
  await quad.click();
}

test('ferma senza richiesta: «Chiedi di nuovo la fusione» la riapre, e i tasti per approvarla compaiono nel quadrato', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, {
    riapri: { ok: true, esito: 'richiesta', requestId: richiesta().id, branch: FERMA.branch },
    dopo: richiesta(),
  });
  const corpo = page.locator('#mgSideBody');
  await expect(corpo).toContainText('non c’è nessuna richiesta da approvare');
  await expect(corpo).not.toContainText('non è (ancora) arrivata');

  const btn = page.locator('#mgRiapriFusioneBtn');
  await expect(btn).toBeVisible();
  await btn.click();
  // Mentre il server rifà i controlli il tasto è spento e lo si dice.
  await expect(corpo.locator('.mg-liv-esito')).toHaveAttribute('data-kind', 'wait');
  await expect(btn).toBeDisabled();

  await expect.poll(() => page.evaluate(() => window.__chiamate.filter((c) => c.type === 'merge_approval_reopen'))).toEqual([
    { type: 'merge_approval_reopen', feedbackId: FERMA._id },
  ]);
  // La richiesta riaperta è nello stesso pannello, con ramo e tasti.
  await expect(corpo.locator('.sn-mac-btn-go')).toBeVisible({ timeout: 8_000 });
  await expect(corpo).toContainText(FERMA.branch);
  await expect(page.locator('#mgRiapriFusioneBtn')).toHaveCount(0);
  await expect(page.locator('#mgToast')).toContainText('Richiesta aperta');
  await page.screenshot({ path: 'tests/.shots/fusione-senza-richiesta-riaperta.png' });
});

test('il ramo non si fonde più con main: lo dice e propone di rimetterla in coda', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, { riapri: { ok: true, esito: 'conflitto', branch: FERMA.branch } });
  await page.locator('#mgRiapriFusioneBtn').click();

  const corpo = page.locator('#mgSideBody');
  await expect(corpo.locator('.mg-liv-esito')).toContainText('non si fonde più con main', { timeout: 8_000 });
  const coda = page.locator('#mgFusioneInCodaBtn');
  await expect(coda).toBeVisible();
  await expect(coda).toHaveText('→ In coda');
  await coda.click();
  await expect.poll(() => page.evaluate(() => window.__chiamate.filter((c) => c.type === 'feedback_update').map((c) => [c.id, c.status])))
    .toEqual([[FERMA._id, 'todo']]);
});

test('il server ferma di nuovo ma non registra la richiesta: lo dice, e si può riprovare', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, { riapri: { ok: true, esito: 'senza_richiesta', reason: 'guard_the_guards' } });
  await page.locator('#mgRiapriFusioneBtn').click();
  const esito = page.locator('#mgSideBody .mg-liv-esito');
  await expect(esito).toContainText('non è riuscito a registrare la richiesta', { timeout: 8_000 });
  await expect(esito).toHaveAttribute('data-kind', 'err');
  await expect(page.locator('#mgRiapriFusioneBtn')).toBeEnabled();
});

test('l’ultima richiesta della pratica l’avevi scartata: niente richiesta nuova, si rimette in coda', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, { recent: [richiesta({ discarded: true, decidedAtMs: Date.now() - 3600 * 1000 })] });
  await expect(page.locator('#mgSideBody')).toContainText('avevi scartato');
  await expect(page.locator('#mgRiapriFusioneBtn')).toHaveCount(0);
  await expect(page.locator('#mgFusioneInCodaBtn')).toBeVisible();
});

test('elenco delle richieste non letto: nessuna promessa e nessun tasto', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, { elencoRotto: true });
  await expect(page.locator('#mgSideBody')).toContainText('non è (ancora) arrivata');
  await expect(page.locator('#mgRiapriFusioneBtn')).toHaveCount(0);
});

test('il pannello senza richiesta si legge in tutti e due i temi', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, { riapri: { ok: true, esito: 'conflitto' } });
  await page.locator('#mgRiapriFusioneBtn').click();
  await expect(page.locator('#mgFusioneInCodaBtn')).toBeVisible({ timeout: 8_000 });
  for (const tema of ['dark', 'light']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
    await page.waitForTimeout(150);
    const colori = await page.locator('#mgSideBody .mg-liv-esito').evaluate((el) => ({
      testo: getComputedStyle(el).color, fondo: getComputedStyle(document.body).backgroundColor,
    }));
    expect(colori.testo, `tema ${tema}`).not.toBe(colori.fondo);
    await page.screenshot({ path: `tests/.shots/fusione-senza-richiesta-${tema}.png` });
  }
});
