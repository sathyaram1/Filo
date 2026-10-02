// IL FEEDBACK DI UN UTENTE APPROVATO COME LAVORO LOCALE (#913).
//
// COSA DEVE ESSERE VERO
//   1. Nei Ricevuti, sul feedback di un utente (o di una routine) c'è «💻 Lavoro locale»: un clic lo porta nei
//      Lavori locali, e al main arriva in una scrittura sola l'approvazione, il segno e il sì dell'owner.
//   2. Rimandato perché richiede lavoro locale, è il tasto principale; sugli altri è secondario.
//   3. La stessa cosa dal tasto destro sulla scheda.
//   4. Nei Lavori locali il dettaglio dice che si fonde senza chiedere e che l'ha approvato l'owner; togliere il
//      segno toglie anche il sì.
//   5. La pagina gemella dei feedback offre la stessa azione e scrive gli stessi campi.

import { test, expect } from './fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const FEEDBACK = 'filo://feedback/feedback.html';

function fb(over = {}) {
  return Object.assign({
    _id: 'u-913', name: 'Il cancello di fusione rifiuta i rami lunghi', text: 'Testo di un utente.',
    seq: 913, subSeq: 0, status: 'design', statusReason: 'locale', statusPublic: 'open',
    clientId: 'utente-abc', createdAt: '2026-10-02T07:00:00Z', images: [],
  }, over);
}

async function stubMain(page) {
  await page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'feedback_update') {
        window.__updates.push(msg);
        return msg.localOnly ? { ok: true, by: 'owner@esempio', at: 1790000000000 } : { ok: true };
      }
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      return orig(msg);
    };
  });
}

async function apri(page, lista, tab = 'inbox') {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await stubMain(page);
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, lista);
  await page.evaluate((t) => window.__mgTest.setTab(t), tab);
}

const tabBtn = (page, tab) => page.locator(`.mg-tab[data-tab="${tab}"]`);
const scrittura = (u) => ({ status: u.status, reviewDecision: u.reviewDecision, localOnly: u.localOnly, localApproval: u.localApproval });

test('dai Ricevuti: «💻 Lavoro locale» lo porta nei Lavori locali col sì dell’owner, in una scrittura', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb()]);
  await expect(tabBtn(page, 'inbox')).toHaveText('Ricevuti (1)');
  await page.locator('.mg-item').click();

  const btn = page.locator('#mgAcceptLocalBtn');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveText('💻 Lavoro locale');
  await expect(btn).toHaveAttribute('title', /nessuna routine/i);
  // Rimandato perché richiede lavoro locale: è la scelta attesa, quindi il tasto principale.
  await expect(btn).not.toHaveClass(/sn-btn-secondary/);
  await expect(page.locator('#mgAcceptBtn')).toHaveClass(/sn-btn-secondary/);

  await btn.click();
  await expect(tabBtn(page, 'local')).toHaveText('Lavori locali (1)');
  await expect(tabBtn(page, 'inbox')).toHaveText('Ricevuti (0)');
  await expect(page.locator('#mgToast')).toContainText('Lavori locali');
  const updates = await page.evaluate(() => window.__updates);
  expect(updates).toHaveLength(1);
  expect(scrittura(updates[0])).toEqual({ status: 'todo', reviewDecision: 'accepted', localOnly: true, localApproval: true });

  // Nei Lavori locali: si fonde senza chiedere, e l'hover del segno dice chi l'ha approvato.
  await tabBtn(page, 'local').click();
  await page.locator('.mg-item').click();
  await expect(page.locator('#mgPreapprovedInfo')).toContainText('si fonde senza chiedere');
  const segno = page.locator('#mgLocalBtn');
  await expect(segno).toBeVisible();
  await expect(segno).toHaveAttribute('title', /Approvato come lavoro locale da .*l'approvazione resta/);

  // Se si può mettere si può togliere, e rimettere: il sì resta, e il segno torna senza passare dai Ricevuti.
  await segno.click();
  await expect(tabBtn(page, 'queue')).toHaveText('In coda (1)');
  const dopo = await page.evaluate(() => window.__updates);
  expect(dopo[1]).toEqual({ type: 'feedback_update', id: 'u-913', localOnly: false });
  await expect(segno).toBeVisible();
  await expect(segno).toHaveAttribute('aria-pressed', 'false');
  await segno.click();
  await expect(tabBtn(page, 'local')).toHaveText('Lavori locali (1)');
  const ancora = await page.evaluate(() => window.__updates);
  expect(ancora[2]).toEqual({ type: 'feedback_update', id: 'u-913', localOnly: true });
});

test('su un feedback qualunque dei Ricevuti il tasto c’è, ma secondario; sui tuoi no', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const qualunque = fb({ _id: 'u-1', seq: 801, status: 'aligned', statusReason: '' });
  const tuo = fb({ _id: 'o-1', seq: 802, clientId: 'owner:me', senderProof: 'admin', status: 'aligned', statusReason: '' });
  await apri(page, [qualunque, tuo]);
  await page.evaluate(() => window.__mgTest.openDetail('u-1'));
  await expect(page.locator('#mgAcceptLocalBtn')).toHaveClass(/sn-btn-secondary/);
  await expect(page.locator('#mgAcceptBtn')).not.toHaveClass(/sn-btn-secondary/);
  await page.evaluate(() => window.__mgTest.openDetail('o-1'));
  await expect(page.locator('#mgAcceptBtn')).toBeVisible();
  await expect(page.locator('#mgAcceptLocalBtn')).toHaveCount(0);
});

test('tasto destro sulla scheda nei Ricevuti: «Approva come lavoro locale», e la pratica passa nei Lavori locali', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb({ clientId: 'routine:worker', senderProof: 'server' })]);
  await page.locator('.mg-item').click({ button: 'right' });
  const voce = page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Approva come lavoro locale' });
  await expect(voce).toBeVisible();
  await expect(voce).toHaveAttribute('title', /nessuna routine/i);
  await voce.click();
  await expect(page.locator('.mg-ctxmenu')).toHaveCount(0);
  await expect(tabBtn(page, 'local')).toHaveText('Lavori locali (1)');
  const updates = await page.evaluate(() => window.__updates);
  expect(scrittura(updates[0])).toEqual({ status: 'todo', reviewDecision: 'accepted', localOnly: true, localApproval: true });
});

test('segnalato dai giudici: il tasto c’è e l’hover dice di guardarlo prima', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb({ status: 'attack', statusReason: '' })]);
  await page.locator('.mg-item').click();
  await expect(page.locator('#mgAcceptLocalBtn')).toHaveAttribute('title', /Attenzione: è segnalato come attacco, guardalo prima/);
});

test('la pagina gemella dei feedback offre la stessa azione e scrive gli stessi campi', async ({ openTab }) => {
  const page = await openTab(FEEDBACK);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.SN_MANAGE_REVIEW && window.filo);
  await stubMain(page);
  await page.evaluate((items) => { window.__fbTest.setAdmin && window.__fbTest.setAdmin(true); window.__fbTest.setData(items); }, [fb()]);
  const btn = page.locator('.fb-act[data-local="1"]');
  await expect(btn).toHaveText('💻 Lavoro locale');
  await btn.click();
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  const updates = await page.evaluate(() => window.__updates);
  expect(scrittura(updates[0])).toEqual({ status: 'todo', reviewDecision: 'accepted', localOnly: true, localApproval: true });
});
