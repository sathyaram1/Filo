// UN LAVORO CHE SI FINISCE SOLO SUL COMPUTER DELL'OWNER (#913, #1424).
//
// COSA DEVE ESSERE VERO
//   1. Nei Ricevuti, su una pratica rimandata perché richiede lavoro locale (motivo `locale`), c'è «💻 Lavoro locale»
//      come tasto principale: un clic la mette «In coda» con l'etichetta «locale», e al main arriva in una scrittura
//      sola l'approvazione, il segno e (a chi non è fidato) il sì dell'owner.
//   2. Sugli altri Ricevuti il tasto non c'è: nessuno decide più a mano che una pratica è un lavoro locale o server.
//   3. La stessa cosa dal tasto destro sulla scheda.
//   4. Lo stesso clic segna fidato il feedback (#1148, richiesta al server); se il server non lo segna, il messaggio
//      lo dice.
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

async function stubMain(page, fiduciaErr = '') {
  await page.evaluate((errore) => {
    window.__updates = [];
    window.__fiducia = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'feedback_update') {
        window.__updates.push(msg);
        return msg.localOnly ? { ok: true, by: 'locale:owner@esempio', at: 1790000000000 } : { ok: true };
      }
      if (t === 'fiducia_segna') {
        window.__fiducia.push(msg);
        return errore ? { ok: false, error: errore } : { ok: true, fiducia: 'fidato' };
      }
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      return orig(msg);
    };
  }, fiduciaErr);
}

async function apri(page, lista, tab = 'inbox', fiduciaErr = '') {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await stubMain(page, fiduciaErr);
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, lista);
  await page.evaluate((t) => window.__mgTest.setTab(t), tab);
}

const tabBtn = (page, tab) => page.locator(`.mg-tab[data-tab="${tab}"]`);
const scrittura = (u) => ({ status: u.status, reviewDecision: u.reviewDecision, localOnly: u.localOnly, localApproval: u.localApproval });

test('dai Ricevuti: «💻 Lavoro locale» la mette In coda come lavoro locale, col sì dell’owner, in una scrittura', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb()]);
  await expect(tabBtn(page, 'inbox')).toHaveText('Ricevuti (1)');
  await page.locator('.mg-item').click();

  const btn = page.locator('#mgAcceptLocalBtn');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveText('💻 Lavoro locale');
  await expect(btn).toHaveAttribute('title', /Si finisce solo sul tuo computer: lo prende una sessione locale/);
  // Rimandato perché richiede lavoro locale: è la scelta attesa, quindi il tasto principale.
  await expect(btn).not.toHaveClass(/sn-btn-secondary/);
  await expect(page.locator('#mgAcceptBtn')).toHaveClass(/sn-btn-secondary/);
  await expect(page.locator('#mgAcceptBtn')).toHaveText('→ In coda');

  await btn.click();
  await expect(tabBtn(page, 'queue')).toHaveText('In coda (1)');
  await expect(tabBtn(page, 'inbox')).toHaveText('Ricevuti (0)');
  await expect(page.locator('#mgToast')).toContainText('In coda come lavoro locale');
  await expect(page.locator('#mgToast')).not.toContainText('Lavori server');
  const updates = await page.evaluate(() => window.__updates);
  expect(updates).toHaveLength(1);
  expect(scrittura(updates[0])).toEqual({ status: 'todo', reviewDecision: 'accepted', localOnly: true, localApproval: true });
  expect(await page.evaluate(() => window.__fiducia)).toEqual([{ type: 'fiducia_segna', feedbackId: 'u-913' }]);

  // In coda: la riga dice «locale», ed è fidata.
  await page.evaluate(() => window.__mgTest.setTab('queue'));
  await expect(page.locator('.mg-item .mg-local-badge')).toHaveText('locale');
  await page.locator('.mg-item').click();
  await expect(page.locator('#mgFiduciaBtn')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#mgFiduciaBtn')).toHaveAttribute('title', /^Fidato: l’hai segnato tu/);
  await expect(page.locator('#mgLocalBtn')).toHaveCount(0);
});

test('sugli altri Ricevuti il tasto non c’è; su un fidato rimandato c’è, senza il sì dell’owner', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const qualunque = fb({ _id: 'u-1', seq: 801, status: 'aligned', statusReason: '' });
  const attacco = fb({ _id: 'u-2', seq: 802, status: 'attack', statusReason: '' });
  const tuo = fb({ _id: 'o-1', seq: 803, clientId: 'owner:me', senderProof: 'admin', fiducia: 'fidato' });
  await apri(page, [qualunque, attacco, tuo]);
  for (const id of ['u-1', 'u-2']) {
    await page.evaluate((i) => window.__mgTest.openDetail(i), id);
    await expect(page.locator('#mgAcceptBtn')).toBeVisible();
    await expect(page.locator('#mgAcceptBtn')).not.toHaveClass(/sn-btn-secondary/);
    await expect(page.locator('#mgAcceptLocalBtn')).toHaveCount(0);
  }
  await page.evaluate(() => window.__mgTest.openDetail('o-1'));
  await page.locator('#mgAcceptLocalBtn').click();
  await expect(tabBtn(page, 'queue')).toHaveText('In coda (1)');
  const updates = await page.evaluate(() => window.__updates);
  expect(scrittura(updates[0])).toEqual({ status: 'todo', reviewDecision: 'accepted', localOnly: true, localApproval: undefined });
  expect(await page.evaluate(() => window.__fiducia)).toEqual([]);
});

test('tasto destro sulla scheda nei Ricevuti: «💻 Lavoro locale», e la pratica passa In coda', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb({ clientId: 'routine:worker', senderProof: 'server' })]);
  await page.locator('.mg-item').click({ button: 'right' });
  const voce = page.locator('.mg-ctxmenu .sn-select-option', { hasText: '💻 Lavoro locale' });
  await expect(voce).toBeVisible();
  await expect(voce).toHaveAttribute('title', /Si finisce solo sul tuo computer/);
  await expect(page.locator('.mg-ctxmenu')).not.toContainText(/[Ll]avoro server/);
  await voce.click();
  await expect(page.locator('.mg-ctxmenu')).toHaveCount(0);
  await expect(tabBtn(page, 'queue')).toHaveText('In coda (1)');
  const updates = await page.evaluate(() => window.__updates);
  expect(scrittura(updates[0])).toEqual({ status: 'todo', reviewDecision: 'accepted', localOnly: true, localApproval: true });
  expect(await page.evaluate(() => window.__fiducia)).toEqual([{ type: 'fiducia_segna', feedbackId: 'u-913' }]);
});

test('se il server non lo segna fidato, il lavoro locale resta e il messaggio lo dice', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb()], 'inbox', 'feedback inesistente');
  await page.locator('.mg-item').click();
  await page.locator('#mgAcceptLocalBtn').click();
  await expect(tabBtn(page, 'queue')).toHaveText('In coda (1)');
  await expect(page.locator('#mgToast')).toContainText('Non segnato fidato: feedback inesistente');
  await tabBtn(page, 'queue').click();
  await page.locator('.mg-item').click();
  await expect(page.locator('#mgFiduciaBtn')).toBeVisible();
  await expect(page.locator('#mgFiduciaBtn')).toHaveAttribute('aria-pressed', 'false');
});

test('segnalato dai giudici: il tasto c’è e l’hover dice di guardarlo prima', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb({ pipeline: { verdicts: [{ judge: 'A', class: 'attack' }] } })]);
  await page.locator('.mg-item').click();
  await expect(page.locator('#mgAcceptLocalBtn')).toHaveAttribute('title', /Attenzione: .*attacco.*guardalo prima/);
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
  await expect.poll(() => page.evaluate(() => window.__fiducia)).toEqual([{ type: 'fiducia_segna', feedbackId: 'u-913' }]);
});
