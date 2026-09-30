// I LAVORI LOCALI IN GESTIONE (#908).
//
// COSA DEVE ESSERE VERO
//   1. Un feedback col segno `localOnly` nell'iter di lavorazione non sta «In coda»
//      (le routine non lo prendono): sta nei «Lavori locali», con il suo numero.
//   2. Sui feedback dell'owner o di una sessione CON la prova il segno si mette e si
//      toglie dal dettaglio (tasto «Locale») e col tasto destro sulla scheda; il gesto
//      arriva al main come sì/no.
//   3. Su un feedback di un utente (o di un falso local: senza prova) non c'è né il
//      tasto né la voce: in locale i feedback degli utenti non si lavorano.
//   4. Nei Ricevuti un feedback col segno resta lì, lo dice sulla scheda, e
//      l'approvazione dice dove va.
//   5. Automazioni: una fusione locale che ha saltato L5 si legge come tale.
//   6. La pagina gemella dei feedback ha la stessa sezione con lo stesso numero.

import { test, expect } from './fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const FEEDBACK = 'filo://feedback/feedback.html';
const SEGNO = { by: 'owner@esempio', at: Date.parse('2026-09-30T08:00:00Z') };

function fb(over = {}) {
  return Object.assign({
    _id: 'loc-1', name: 'Il finish porta il numero della pratica', text: 'Lavoro della sessione.',
    seq: 908, subSeq: 0, status: 'todo', statusPublic: 'open',
    clientId: 'local:claude', senderProof: 'admin',
    createdAt: '2026-09-30T07:00:00Z', images: [],
  }, over);
}

async function stubMain(page, { preapproved = [] } = {}) {
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
      if (t === 'merge_approvals_get') {
        return { ok: true, pending: [], failed: [], recent: [], preapproved: cfg.preapproved, ttlMs: 7 * 24 * 60 * 60 * 1000 };
      }
      return orig(msg);
    };
  }, { preapproved });
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

test('la sezione «Lavori locali» tiene i feedback col segno, fuori dalla coda', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const locale = fb({ localOnly: SEGNO, pipeline: { skipped: 'local_proven' } });
  const inCoda = fb({ _id: 'q-1', seq: 700, name: 'Una cosa per le routine', clientId: 'utente-x', senderProof: undefined });
  await apri(page, [locale, inCoda]);

  await expect(tabBtn(page, 'local')).toHaveText('Lavori locali (1)');
  await expect(tabBtn(page, 'queue')).toHaveText('In coda (1)');
  // «In coda» mostra solo quello delle routine.
  await expect(page.locator('.mg-item')).toHaveCount(1);
  await expect(page.locator('.mg-item')).toContainText('#700');

  await tabBtn(page, 'local').click();
  await expect(page.locator('#mgListHead')).toContainText('Lavori locali');
  await expect(page.locator('.mg-item')).toHaveCount(1);
  await expect(page.locator('.mg-item')).toContainText('#908');
  // Nella sua sezione il segno non si ripete sulla scheda.
  await expect(page.locator('.mg-item .mg-local-badge')).toHaveCount(0);
  // Le azioni sono quelle della coda.
  await page.locator('.mg-item').click();
  await expect(page.locator('#mgActionsRow')).toContainText('Risolto');
  // Nato come lavoro locale provato, i giudici li ha saltati: la conversazione lo dice.
  await expect(page.locator('#mgThread')).toContainText('I giudici non servono');
});

test('dal dettaglio: il tasto «Locale» mette il segno, la pratica passa nei Lavori locali, e si toglie', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const pratica = fb({ clientId: 'owner:me' });
  await apri(page, [pratica]);
  await page.evaluate((id) => window.__mgTest.openDetail(id), pratica._id);

  const btn = page.locator('#mgLocalBtn');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  await expect(btn).toHaveAttribute('title', /nessuna routine/i);
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect(btn).toHaveText(/Solo locale/);
  await expect(page.locator('#mgManageMsg')).toContainText('Lavori locali');
  await expect(tabBtn(page, 'local')).toHaveText('Lavori locali (1)');
  await expect(tabBtn(page, 'queue')).toHaveText('In coda (0)');
  let updates = await page.evaluate(() => window.__updates);
  expect(updates).toEqual([{ type: 'feedback_update', id: pratica._id, localOnly: true }]);
  // L'hover dice chi l'ha messo.
  await expect(btn).toHaveAttribute('title', /owner@esempio/);

  // Se si può mettere si può togliere.
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  await expect(tabBtn(page, 'queue')).toHaveText('In coda (1)');
  updates = await page.evaluate(() => window.__updates);
  expect(updates[1]).toEqual({ type: 'feedback_update', id: pratica._id, localOnly: false });
});

test('tasto destro sulla scheda: la voce del segno, che apre la pratica e la sposta', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const pratica = fb();
  await apri(page, [pratica]);
  await page.locator('.mg-item').click({ button: 'right' });
  const menu = page.locator('.mg-ctxmenu');
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('Apri');
  await expect(menu).toContainText('Copia #908');
  const voce = menu.locator('.sn-select-option', { hasText: 'Solo lavoro locale' });
  await expect(voce).toHaveAttribute('title', /nessuna routine/i);
  await voce.click();
  await expect(menu).toHaveCount(0);
  await expect(page.locator('#mgDetail')).toBeVisible();
  await expect(tabBtn(page, 'local')).toHaveText('Lavori locali (1)');
  const updates = await page.evaluate(() => window.__updates);
  expect(updates).toEqual([{ type: 'feedback_update', id: pratica._id, localOnly: true }]);

  // Dalla sua sezione, la stessa voce lo rimette alle routine.
  await tabBtn(page, 'local').click();
  await page.locator('.mg-item').click({ button: 'right' });
  await page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Rimetti anche alle routine' }).click();
  await expect(tabBtn(page, 'queue')).toHaveText('In coda (1)');
});

test('sui feedback degli utenti, e sui falsi local: senza prova, niente tasto e niente voce', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const utente = fb({ _id: 'u-1', seq: 801, clientId: 'utente-abc', senderProof: undefined });
  const falso = fb({ _id: 'f-1', seq: 802, clientId: 'local:claude', senderProof: undefined });
  await apri(page, [utente, falso]);
  for (const id of ['u-1', 'f-1']) {
    await page.evaluate((i) => window.__mgTest.openDetail(i), id);
    await expect(page.locator('#mgStarBtn')).toBeVisible();
    await expect(page.locator('#mgLocalBtn')).toBeHidden();
    await page.locator(`.mg-item[data-id="${id}"]`).click({ button: 'right' });
    await expect(page.locator('.mg-ctxmenu')).toBeVisible();
    await expect(page.locator('.mg-ctxmenu')).not.toContainText('locale');
    await page.keyboard.press('Escape');
    await expect(page.locator('.mg-ctxmenu')).toHaveCount(0);
  }
  expect(await page.evaluate(() => window.__updates)).toEqual([]);
});

test('una pratica che una routine sta lavorando (battito fresco): il tasto dice perché no, e il clic non scrive', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const adesso = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const presa = fb({ clientId: 'owner:me', status: 'working', workingSince: adesso, beatAt: adesso });
  await apri(page, [presa]);
  await page.evaluate((id) => window.__mgTest.openDetail(id), presa._id);
  const btn = page.locator('#mgLocalBtn');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveAttribute('title', /Adesso non si può: una routine la sta lavorando/);
  await btn.click();
  await expect(page.locator('#mgManageMsg')).toContainText('Segno non messo');
  await expect(tabBtn(page, 'local')).toHaveText('Lavori locali (0)');
  expect(await page.evaluate(() => window.__updates)).toEqual([]);
});

test('nei Ricevuti col segno: resta lì, la scheda lo dice, l’approvazione dice dove va', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const pratica = fb({ status: 'aligned', localOnly: SEGNO });
  await apri(page, [pratica], { tab: 'inbox' });
  await expect(tabBtn(page, 'inbox')).toHaveText('Ricevuti (1)');
  await expect(page.locator('#mgAlignedBtn')).toHaveText('Approva tutti gli allineati (1) → Lavori locali');
  const badge = page.locator('.mg-item .mg-local-badge');
  await expect(badge).toHaveText('locale');
  await expect(badge).toHaveAttribute('title', /nessuna routine.*owner@esempio/);
  await page.locator('.mg-item').click();
  await expect(page.locator('#mgAcceptBtn')).toHaveText('→ Lavori locali');
});

test('Automazioni: la fusione locale che ha saltato L5 dice perché non ha chiesto', async ({ openTab }) => {
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
  await tabBtn(page, 'automation').click();
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

test('la pagina gemella dei feedback ha la stessa sezione, con lo stesso numero', async ({ openTab }) => {
  const page = await openTab(FEEDBACK);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.SN_MANAGE_REVIEW);
  await page.evaluate((items) => window.__fbTest.setData(items), [
    fb({ localOnly: SEGNO }),
    fb({ _id: 'q-1', seq: 700, clientId: 'utente-x', senderProof: undefined }),
  ]);
  await expect(page.locator('#tabs [data-tab="local"]')).toHaveText('Lavori locali (1)');
  await expect(page.locator('#tabs [data-tab="queue"]')).toHaveText('In coda (1)');
});

test('il segno messo da una sessione dice chi l’ha messo come la testata, non col mittente grezzo', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb({ localOnly: { by: 'local:claude', at: SEGNO.at } })], { tab: 'local' });
  await page.evaluate(() => window.__mgTest.openDetail('loc-1'));
  const tasto = page.locator('#mgLocalBtn');
  await expect(tasto).toBeVisible();
  await expect(tasto).toHaveAttribute('title', /Segno messo da Claude \(sessione locale\)/);
  await expect(tasto).not.toHaveAttribute('title', /local:claude/);
});
