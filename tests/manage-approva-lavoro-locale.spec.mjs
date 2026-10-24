// IL ROMBO AZZURRO APPROVATO COME LAVORO SERVER (#913, #1575).
//
// COSA DEVE ESSERE VERO
//   1. Nei Ricevuti, sul rombo azzurro (`design`/`locale` senza domanda, nato prima del #1358) c'è «💻 Lavoro
//      server», tasto principale: un clic lo porta «In coda» con l'etichetta «server», e al main arriva in una
//      scrittura sola l'approvazione, il segno e il sì dell'owner.
//   2. Su ogni altra pratica dei Ricevuti il tasto non c'è; sul rombo di un fidato c'è e scrive il solo segno.
//   3. La stessa cosa dal tasto destro sulla scheda, con lo stesso nome.
//   4. Lo stesso clic segna fidato il feedback (#1148, richiesta al server); In coda il dettaglio lo dice, e
//      l'etichetta dice che l'ha approvato l'owner. Se il server non lo segna, il messaggio lo dice.
//   5. La pagina gemella dei feedback offre la stessa azione e scrive gli stessi campi.

import { test, expect } from './fixtures/electron.mjs';
import { apriScheda } from './helpers/gestione.mjs';

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
        return msg.localOnly ? { ok: true, by: 'owner@esempio', at: 1790000000000 } : { ok: true };
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

test('dai Ricevuti: «💻 Lavoro server» lo porta «In coda» col segno e il sì dell’owner, in una scrittura', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb()]);
  await expect(tabBtn(page, 'inbox')).toHaveText('Ricevuti (1)');
  await page.locator('.mg-item').click();

  const btn = page.locator('#mgAcceptLocalBtn');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveText('💻 Lavoro server');
  await expect(btn).toHaveAttribute('title', /Diventa un lavoro server/);
  // Rimandato perché richiede lavoro locale: è la scelta attesa, quindi il tasto principale.
  await expect(btn).not.toHaveClass(/sn-btn-secondary/);
  await expect(page.locator('#mgAcceptBtn')).toHaveClass(/sn-btn-secondary/);

  await btn.click();
  await expect(tabBtn(page, 'queue')).toHaveText('In coda (1)');
  await expect(tabBtn(page, 'inbox')).toHaveText('Ricevuti (0)');
  await expect(page.locator('#mgToast')).toContainText('#913 è In coda come lavoro server.');
  const updates = await page.evaluate(() => window.__updates);
  expect(updates).toHaveLength(1);
  expect(scrittura(updates[0])).toEqual({ status: 'todo', reviewDecision: 'accepted', localOnly: true, localApproval: true });
  expect(await page.evaluate(() => window.__fiducia)).toEqual([{ type: 'fiducia_segna', feedbackId: 'u-913' }]);

  // In coda: è fidato, la riga lo dice col suo scudo, e l'etichetta dice chi l'ha approvato.
  await apriScheda(page, 'queue');
  const riga = page.locator('.mg-item[data-id="u-913"]');
  await expect(riga.locator('.mg-local-badge')).toHaveText('server');
  await expect(riga.locator('.mg-local-badge')).toHaveAttribute('title', /Approvato come lavoro server da /);
  await expect(riga.locator('.mg-fiducia-segno')).toHaveAttribute('aria-label', 'Fidata');
  await riga.click();
  await expect(page.locator('#mgFiduciaBtn')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#mgFiduciaBtn')).toHaveAttribute('title', /^Fidato: l’hai segnato tu/);
  // Il segno a mano non c'è più: nessun tasto per toglierlo.
  await expect(page.locator('#mgLocalBtn')).toHaveCount(0);
  await expect(page.locator('#mgOwnerBar')).not.toContainText(/💻/);
});

test('sul rombo azzurro di un fidato «💻 Lavoro server» c’è lo stesso, e scrive il solo segno', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb({ clientId: 'owner:me', senderProof: 'admin', fiducia: 'fidato' })]);
  await page.locator('.mg-item').click();
  const btn = page.locator('#mgAcceptLocalBtn');
  await expect(btn).toHaveText('💻 Lavoro server');
  await expect(btn).not.toHaveClass(/sn-btn-secondary/);
  await btn.click();
  await expect(tabBtn(page, 'queue')).toHaveText('In coda (1)');
  const updates = await page.evaluate(() => window.__updates);
  expect(scrittura(updates[0])).toEqual({ status: 'todo', reviewDecision: 'accepted', localOnly: true, localApproval: undefined });
  expect(await page.evaluate(() => window.__fiducia)).toEqual([]);
});

test('su ogni altra pratica dei Ricevuti il tasto non c’è, né nel dettaglio né col tasto destro', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const altre = [
    fb({ _id: 'u-1', seq: 801, status: 'aligned', statusReason: '' }),
    fb({ _id: 'o-1', seq: 802, clientId: 'owner:me', senderProof: 'admin', fiducia: 'fidato', status: 'aligned', statusReason: '' }),
    fb({ _id: 'a-1', seq: 803, status: 'attack', statusReason: '' }),
    fb({ _id: 'd-1', seq: 804, statusReason: 'fidato' }),
    fb({ _id: 'n-1', seq: 805, status: 'unlabeled', statusReason: '' }),
  ];
  await apri(page, altre);
  for (const p of altre) {
    await page.evaluate((id) => window.__mgTest.openDetail(id), p._id);
    await expect(page.locator('#mgAcceptBtn'), p._id).toBeVisible();
    await expect(page.locator('#mgAcceptBtn'), p._id).not.toHaveClass(/sn-btn-secondary/);
    await expect(page.locator('#mgAcceptLocalBtn'), p._id).toHaveCount(0);
    await page.locator(`.mg-item[data-id="${p._id}"]`).click({ button: 'right' });
    await expect(page.locator('.mg-ctxmenu')).toBeVisible();
    await expect(page.locator('.mg-ctxmenu'), p._id).not.toContainText(/💻|[Ll]avoro server/);
    await page.keyboard.press('Escape');
  }
});

test('tasto destro sul rombo azzurro: «💻 Lavoro server», e la pratica passa «In coda»', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb({ clientId: 'routine:worker', senderProof: 'server' })]);
  await page.locator('.mg-item').click({ button: 'right' });
  const voce = page.locator('.mg-ctxmenu .sn-select-option', { hasText: '💻 Lavoro server' });
  await expect(voce).toBeVisible();
  await expect(voce).toHaveAttribute('title', /Diventa un lavoro server/);
  await voce.click();
  await expect(page.locator('.mg-ctxmenu')).toHaveCount(0);
  await expect(tabBtn(page, 'queue')).toHaveText('In coda (1)');
  const updates = await page.evaluate(() => window.__updates);
  expect(scrittura(updates[0])).toEqual({ status: 'todo', reviewDecision: 'accepted', localOnly: true, localApproval: true });
  expect(await page.evaluate(() => window.__fiducia)).toEqual([{ type: 'fiducia_segna', feedbackId: 'u-913' }]);
});

test('se il server non lo segna fidato, il lavoro server resta e il messaggio lo dice', async ({ openTab }) => {
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

test('segnalato dai giudici: sul rombo il tasto c’è e l’hover dice di guardarlo prima', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb({ pipeline: { verdicts: [{ judge: 'A', class: 'attack' }], expectedJudges: ['A'] } })]);
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
  await expect(btn).toHaveText('💻 Lavoro server');
  await btn.click();
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  const updates = await page.evaluate(() => window.__updates);
  expect(scrittura(updates[0])).toEqual({ status: 'todo', reviewDecision: 'accepted', localOnly: true, localApproval: true });
  await expect.poll(() => page.evaluate(() => window.__fiducia)).toEqual([{ type: 'fiducia_segna', feedbackId: 'u-913' }]);
});
