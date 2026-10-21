// I LAVORI COL SEGNO IN GESTIONE (#908, #1575).
//
// COSA DEVE ESSERE VERO
//   1. Un feedback col segno `localOnly` sta nella scheda del suo stato («In coda» nell'iter di
//      lavorazione) con l'etichetta «server», col suo numero: la scheda «Lavori server» non c'è.
//   2. Il segno non si mette né si toglie a mano: né dal dettaglio né col tasto destro, su
//      nessuna pratica, fidata o no, aperta o chiusa (dal #1358 lo mette il server).
//   3. Nei Ricevuti un feedback col segno resta lì, lo dice sulla scheda, e l'approvazione
//      lo porta «In coda».
//   4. Automazioni: una fusione locale che ha saltato L5 si legge come tale.
//   5. La pagina gemella dei feedback lo mette In coda come Gestione.
//   6. «Fondi senza chiedermelo» e «È mio» non ci sono più: c'è «Segna fidato», che arriva
//      al main come richiesta al server.
//   7. «Copia» nomina finish solo dove il numero lo lega a un lavoro.

import { test, expect } from './fixtures/electron.mjs';
import { apriScheda } from './helpers/gestione.mjs';

const MANAGE = 'filo://manage/manage.html';
const FEEDBACK = 'filo://feedback/feedback.html';
const SEGNO = { by: 'owner@esempio', at: Date.parse('2026-09-30T08:00:00Z') };

function fb(over = {}) {
  return Object.assign({
    _id: 'loc-1', name: 'Il finish porta il numero della pratica', text: 'Lavoro della sessione.',
    seq: 908, subSeq: 0, status: 'todo', statusPublic: 'open',
    clientId: 'local:claude', senderProof: 'admin', fiducia: 'fidato',
    createdAt: '2026-09-30T07:00:00Z', images: [],
  }, over);
}

async function stubMain(page, { preapproved = [], fiduciaErr = '' } = {}) {
  await page.evaluate((cfg) => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'feedback_update') {
        window.__updates.push(msg);
        return msg.localOnly ? { ok: true, by: 'owner@esempio', at: 1790000000000 } : { ok: true };
      }
      if (t === 'fiducia_segna') {
        window.__updates.push(msg);
        return cfg.fiduciaErr ? { ok: false, error: cfg.fiduciaErr } : { ok: true, fiducia: 'fidato' };
      }
      if (t === 'merge_approvals_get') {
        return { ok: true, pending: [], failed: [], recent: [], preapproved: cfg.preapproved, ttlMs: 7 * 24 * 60 * 60 * 1000 };
      }
      return orig(msg);
    };
  }, { preapproved, fiduciaErr });
}

async function apri(page, lista, { tab = 'queue', ...opts } = {}) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await stubMain(page, opts);
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, lista);
  await page.evaluate((t) => window.__mgTest.setTab(t), tab);
}

const tabBtn = (page, tab) => page.locator(`.mg-tab[data-tab="${tab}"]`);

test('il lavoro col segno sta «In coda» con l’etichetta «server», e la scheda «Lavori server» non c’è', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const locale = fb({ localOnly: SEGNO, pipeline: { skipped: 'local_proven' } });
  const inCoda = fb({ _id: 'q-1', seq: 700, name: 'Una cosa per le routine', clientId: 'utente-x', senderProof: undefined, fiducia: undefined });
  await apri(page, [locale, inCoda]);

  await expect(tabBtn(page, 'local')).toHaveCount(0);
  await expect(page.locator('.mg-tab', { hasText: 'Lavori server' })).toHaveCount(0);
  await expect(tabBtn(page, 'queue')).toHaveText('In coda (2)');
  await expect(page.locator('.mg-item')).toHaveCount(2);
  const conSegno = page.locator('.mg-item[data-id="loc-1"]');
  await expect(conSegno).toContainText('#908');
  // Fuori da una scheda sua, l'etichetta dice che non è un lavoro delle routine; quello delle routine non ce l'ha.
  await expect(conSegno.locator('.mg-local-badge')).toHaveText('server');
  await expect(conSegno.locator('.mg-local-badge')).toHaveAttribute('title', /^Lavoro server\. .*owner@esempio/);
  await expect(page.locator('.mg-item[data-id="q-1"] .mg-local-badge')).toHaveCount(0);
  // Le azioni sono quelle della coda.
  await conSegno.click();
  await expect(page.locator('#mgActionsRow')).toContainText('Risolto');
  // Nato come lavoro locale provato, i giudici li ha saltati: la conversazione lo dice.
  await expect(page.locator('#mgThread')).toContainText(/giudici non servono/i);
});

test('il segno non si mette né si toglie a mano: nessun tasto nel dettaglio, nessuna voce col tasto destro', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fidata = fb({ _id: 'p-1', seq: 901, clientId: 'owner:me' });
  const conSegno = fb({ _id: 'p-2', seq: 902, localOnly: SEGNO });
  const utente = fb({ _id: 'p-3', seq: 903, clientId: 'utente-abc', senderProof: undefined, fiducia: undefined });
  const falso = fb({ _id: 'p-4', seq: 904, clientId: 'local:claude', senderProof: undefined, fiducia: undefined });
  const chiusa = fb({ _id: 'p-5', seq: 905, status: 'done', statusPublic: 'closed' });
  const chiusaConSegno = fb({ _id: 'p-6', seq: 906, status: 'done', statusPublic: 'closed', localOnly: SEGNO });
  await apri(page, [fidata, conSegno, utente, falso, chiusa, chiusaConSegno]);
  await expect(page.locator('#mgLocalBtn')).toHaveCount(0);
  for (const p of [fidata, conSegno, utente, falso, chiusa, chiusaConSegno]) {
    // Ognuna nella scheda del suo stato: le chiuse stanno nei Risolti.
    await page.evaluate((f) => window.__mgTest.setTab(window.SN_MANAGE_REVIEW.manageTabFor(f)), p);
    const riga = page.locator(`.mg-item[data-id="${p._id}"]`);
    await expect(riga, p._id).toHaveCount(1);
    await riga.click();
    await expect(page.locator('#mgStarBtn')).toBeVisible();
    await expect(page.locator('#mgOwnerBar')).not.toContainText(/💻|[Ll]avoro server/);
    await riga.click({ button: 'right' });
    const menu = page.locator('.mg-ctxmenu');
    await expect(menu).toBeVisible();
    await expect(menu).toContainText('Apri');
    await expect(menu, p._id).not.toContainText(/💻|[Ll]avoro server/);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  }
  expect(await page.evaluate(() => window.__updates)).toEqual([]);
});

test('nei Ricevuti col segno: resta lì, la scheda lo dice, l’approvazione lo porta «In coda»', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const pratica = fb({ status: 'aligned', localOnly: SEGNO });
  await apri(page, [pratica], { tab: 'inbox' });
  await expect(tabBtn(page, 'inbox')).toHaveText('Ricevuti (1)');
  await expect(page.locator('#mgAlignedBtn')).toHaveText('Approva tutti gli allineati (1) → In coda');
  const badge = page.locator('.mg-item .mg-local-badge');
  await expect(badge).toHaveText('server');
  await expect(badge).toHaveAttribute('title', /Lavoro server\. Lo prendono le routine.*owner@esempio/);
  await page.locator('.mg-item').click();
  await expect(page.locator('#mgAcceptBtn')).toHaveText('→ In coda');
  await expect(page.locator('#mgAcceptLocalBtn')).toHaveCount(0);
  await page.locator('#mgAcceptBtn').click();
  await expect(tabBtn(page, 'inbox')).toHaveText('Ricevuti (0)');
  await expect(tabBtn(page, 'queue')).toHaveText('In coda (1)');
  const scritte = await page.evaluate(() => window.__updates);
  expect(scritte).toHaveLength(1);
  expect(scritte[0]).toMatchObject({ type: 'feedback_update', id: 'loc-1', status: 'todo' });
  expect(scritte[0].localOnly).toBeUndefined();
  await apriScheda(page, 'queue');
  await expect(page.locator('.mg-item[data-id="loc-1"] .mg-local-badge')).toHaveText('server');
});

test('Log: la fusione locale che ha saltato L5 dice perché non ha chiesto', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fusa = {
    id: 'cd34ef56ab12cd34ef56ab12', branch: 'claude/lavori-locali', sha: 'a1b2c3d4'.repeat(5),
    mergeSha: 'feedface'.repeat(5), who: 'owner@esempio', origin: 'locale', num: '#908', feedbackId: 'loc-1',
    blocks: [{ gate: 'guard_the_guards', label: 'Tocca aree protette', items: ['firestore.rules'], more: 0 }],
    createdAtMs: Date.now() - 60 * 60 * 1000, decidedAtMs: Date.now() - 60 * 60 * 1000,
    used: true, outcome: 'merged', skippedL5: true,
  };
  await apri(page, [fb({ localOnly: SEGNO })], { preapproved: [fusa] });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await apriScheda(page, 'log');
  const box = page.locator('#mgMergeApprovalsPreapproved');
  await expect(box).toBeVisible({ timeout: 8_000 });
  await expect(box).toContainText('lavoro locale · feedback #908');
  await expect(box).toContainText('lavoro locale: L5 saltato');
  await expect(box).not.toContainText('pre-approvata');
  await expect(box).toContainText('firestore.rules');
  // La pratica è a un clic.
  await box.locator('.sn-mac-origin-link').click();
  await expect(page.locator('#mgDetail')).toBeVisible();
});

test('la pagina gemella dei feedback lo mette «In coda», come Gestione', async ({ openTab }) => {
  const page = await openTab(FEEDBACK);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.SN_MANAGE_REVIEW);
  await page.evaluate((items) => window.__fbTest.setData(items), [
    fb({ localOnly: SEGNO }),
    fb({ _id: 'q-1', seq: 700, clientId: 'utente-x', senderProof: undefined, fiducia: undefined }),
  ]);
  // La regola delle sezioni è una sola (MR.manageTabFor): la pagina vecchia non si tocca (la toglie #1051).
  await expect(page.locator('#tabs [data-tab="queue"]')).toHaveText('In coda (2)');
});

test('lavoro locale fidato: il tasto della fiducia è premuto e dice da dove viene; i tasti di prima non ci sono', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const daSessione = fb({ localOnly: SEGNO, fiduciaDa: { by: 'nascita', at: SEGNO.at } });
  await apri(page, [daSessione], { tab: 'queue' });
  await page.evaluate(() => window.__mgTest.openDetail('loc-1'));
  await expect(page.locator('#mgFiduciaBtn')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#mgFiduciaBtn')).toHaveAttribute('title', /^Fidato: scritto da te o da una sessione pulita\./);
  for (const via of ['#mgPreapproveBtn', '#mgPreapproveRevokeBtn', '#mgPreapprovedInfo', '#mgSenderBtn']) {
    await expect(page.locator(via)).toHaveCount(0);
  }
  await page.locator('.mg-item[data-id="loc-1"]').click({ button: 'right' });
  await expect(page.locator('.mg-ctxmenu')).toBeVisible();
  await expect(page.locator('.mg-ctxmenu')).not.toContainText(/Segna fidato|È mio|senza chiedere/);
  await expect(page.locator('.mg-ctxmenu')).toContainText('Togli fiducia');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__updates)).toEqual([]);
});

test('il segno messo da una sessione dice chi l’ha messo come la testata, non col mittente grezzo', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb({ localOnly: { by: 'local:claude', at: SEGNO.at } })], { tab: 'queue' });
  const etichetta = page.locator('.mg-item[data-id="loc-1"] .mg-local-badge');
  await expect(etichetta).toBeVisible();
  await expect(etichetta).toHaveAttribute('title', /Segno messo da Claude \(sessione locale\)/);
  await expect(etichetta).not.toHaveAttribute('title', /local:claude/);
});

test('il proprio non fidato: «Segna fidato» va al main, e il segno a mano non compare nemmeno dopo', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const mio = fb({ _id: 's-1', seq: 908, status: 'todo', fiducia: undefined });
  await apri(page, [mio]);
  await page.evaluate((i) => window.__mgTest.openDetail(i), 's-1');
  const btn = page.locator('#mgFiduciaBtn');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveAttribute('title', /i giudici non servono più/);
  await btn.click();
  await expect(page.locator('#mgManageMsg')).toContainText('Da ora (#908) è fidato.');
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect(btn).toHaveAttribute('title', /^Fidato: l’hai segnato tu/);
  await expect(page.locator('#mgOwnerBar')).not.toContainText(/💻|[Ll]avoro server/);
  expect(await page.evaluate(() => window.__updates)).toEqual([{ type: 'fiducia_segna', feedbackId: 's-1' }]);
});

test('segnalato dai giudici o dal filtro: «Segna fidato» dal tasto destro avverte come il tasto', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const senza = fb({ _id: 's-4', seq: 833, status: 'unlabeled', senderProof: undefined, fiducia: undefined,
    pipeline: { verdicts: [{ judge: 'A', class: 'attack' }, { judge: 'B', class: 'attack' }], expectedJudges: ['A', 'B'] } });
  const provato = fb({ _id: 's-5', seq: 834, status: 'unlabeled', pipeline: { stage: 'L1', action: 'block_attack', l1Category: 'dangerous' } });
  await apri(page, [senza, provato], { tab: 'inbox' });
  await page.evaluate((i) => window.__mgTest.openDetail(i), 's-4');
  await expect(page.locator('#mgFiduciaBtn')).toHaveAttribute('title', /Attenzione: .*attacco.*guardalo prima/);
  await page.locator('.mg-item[data-id="s-4"]').click({ button: 'right' });
  const voce = page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Segna fidato' });
  await expect(voce).toHaveAttribute('title', /Attenzione: .*attacco.*guardalo prima/);
  await page.keyboard.press('Escape');
  await page.locator('.mg-item[data-id="s-5"]').click({ button: 'right' });
  await expect(page.locator('.mg-ctxmenu')).toBeVisible();
  await expect(page.locator('.mg-ctxmenu')).not.toContainText(/[Ll]avoro server/);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__updates.filter((u) => 'localOnly' in u))).toEqual([]);
});

// Giro 4 della verifica locale: un lavoro locale preso in carico non riceve le frasi delle routine.
test('un lavoro locale «In lavorazione» dice che lo porta avanti una sessione, non che rientra in coda da solo', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const da = new Date(Date.now() - 40 * 60 * 1000).toISOString();
  const preso = fb({ status: 'working', workingSince: da, localOnly: SEGNO });
  const routine = fb({ _id: 'r-1', seq: 701, clientId: 'utente-x', senderProof: undefined, fiducia: undefined, status: 'working', workingSince: da });
  await apri(page, [preso, routine]);
  // Il lavoro di una routine resta com'era; quello col segno sta nella stessa scheda, con la sua riga.
  await expect(page.locator('.mg-item[data-id="r-1"]')).toContainText('rientra in coda da solo');
  const scheda = page.locator('.mg-item[data-id="loc-1"]');
  await expect(scheda).toContainText('In lavorazione in una sessione locale');
  await expect(scheda).not.toContainText(/rientra in coda|Controllo sicurezza/);
  await scheda.click();
  await expect(page.locator('#mgWorkState')).toContainText('In lavorazione in una sessione locale');
  await expect(page.locator('#mgWorkState')).not.toContainText('rientra in coda');
});

test('«Copia» sui feedback degli utenti non parla di finish', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const utente = fb({ _id: 'u-1', seq: 911, clientId: 'abc', senderProof: undefined, fiducia: undefined });
  await apri(page, [utente], { tab: 'queue' });
  await page.locator('.mg-item[data-id="u-1"]').click({ button: 'right' });
  await expect(page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Copia #911' })).toHaveAttribute('title', 'Il numero con cui parlarne');
});
