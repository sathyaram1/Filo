// #1517: un numero di feedback può essere di più documenti. In Gestione la richiesta di fusione e il collegamento di
// una domanda aprono il documento del loro id, non il primo col numero; accanto al numero stanno stato e mittente di
// quel documento, e un avviso quando il numero è doppio.

import { test, expect } from './fixtures/electron.mjs';
import { apriScheda } from './helpers/gestione.mjs';

const MANAGE = 'filo://manage/manage.html';
const base = { text: 'x', subSeq: 0, statusPublic: 'open', createdAt: '2026-10-20T08:00:00Z', images: [] };
// L'estraneo viene per primo: è quello che il vecchio «primo col numero» apriva.
const ESTRANEO = { ...base, text: 'Un altro discorso, scritto da un estraneo.', _id: 'fb-estraneo', seq: 5, name: 'Testo che non c’entra', status: 'todo', clientId: 'utente-x', mittenteClasse: 'utente' };
const VERO = { ...base, text: 'Il testo della pratica vera.', _id: 'fb-vero', seq: 5, name: 'La pratica della richiesta', status: 'working', clientId: 'local:claude', senderProof: 'admin', mittenteClasse: 'sessione_locale' };
const FUSA = {
  id: 'ab12cd34ef56ab12cd34ef56', branch: 'claude/numero-doppio', sha: 'a1b2c3d4'.repeat(5), mergeSha: 'feedface'.repeat(5),
  who: 'owner@esempio', origin: 'locale', num: '#5', feedbackId: 'fb-vero', blocks: [],
  createdAtMs: Date.now() - 3600e3, decidedAtMs: Date.now() - 3600e3, used: true, outcome: 'merged',
};

async function apri(page, { preapproved = [] } = {}) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((cfg) => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: cfg.preapproved, ttlMs: 7 * 864e5 };
      return orig(msg);
    };
  }, { preapproved });
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, [ESTRANEO, VERO]);
}

async function scatta(page, nome) {
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({ path: `tests/.shots/1517-${nome}-${colorScheme}.png` }).catch(() => {});
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

test('fusione: il bottone d’origine apre il documento della richiesta e dice che il numero è doppio', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, { preapproved: [FUSA] });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await apriScheda(page, 'log');
  const box = page.locator('#mgMergeApprovalsPreapproved');
  await expect(box).toBeVisible({ timeout: 8_000 });
  await expect(box.locator('.sn-mac-fbinfo')).toHaveText('In lavorazione · sessione locale');
  await expect(box.locator('.sn-mac-fbdoppio')).toHaveText('numero doppio');
  await expect(box.locator('.sn-mac-fbdoppio')).toHaveAttribute('title', /#5 è di 2 segnalazioni/);
  await scatta(page, 'fusione');
  await box.locator('.sn-mac-origin-link').click();
  await expect(page.locator('#mgDetail')).toBeVisible();
  await expect(page.locator('.mg-item[data-id="fb-vero"]')).toHaveClass(/mg-item--selected/);
  await expect(page.locator('.mg-item[data-id="fb-estraneo"]')).not.toHaveClass(/mg-item--selected/);
  await expect(page.locator('#mgDetail')).toContainText('Il testo della pratica vera.');
});

test('fusione senza id e numero doppio: non apre a caso, lo dice', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const { feedbackId, ...senzaId } = FUSA;
  await apri(page, { preapproved: [senzaId] });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await apriScheda(page, 'log');
  const box = page.locator('#mgMergeApprovalsPreapproved');
  await expect(box.locator('.sn-mac-fbdoppio')).toHaveText('numero doppio', { timeout: 8_000 });
  await expect(box.locator('.sn-mac-fbinfo')).toHaveCount(0);
  await box.locator('.sn-mac-origin-link').click();
  await expect(page.locator('#mgToast')).toContainText('#5 è il numero di 2 segnalazioni');
  await expect(page.locator('#mgDetail')).toBeHidden();
});

test('domanda: il collegamento apre il documento del suo id, con stato, mittente e l’avviso del doppio', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  const ora = Date.now();
  await page.evaluate((cfg) => window.__mgTest.setDomande(cfg.l, { riferimenti: cfg.r }), {
    l: [{ id: 'D-40', numero: 40, stato: 'aperta', priorita: 'importante', fiducia: 'fidato', titolo: 'Riprendere la pratica?',
      creataIl: ora, modificataIl: ora, opzioni: [], consiglio: null, conversazione: [], origine: { tipo: 'feedback', id: 'fb-vero' } }],
    r: { 'fb-vero': { num: '#5', stato: 'working' } },
  });
  await apriScheda(page, 'domande');
  const dq = page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-40"]');
  await expect(dq.locator('.mg-dq-legame')).toHaveText('#5');
  await expect(dq.locator('.mg-dq-legame')).toHaveAttribute('data-feedback-id', 'fb-vero');
  await expect(dq.locator('.mg-dq-legame-info')).toHaveText('In lavorazione · sessione locale');
  await expect(dq.locator('.mg-dq-legame-doppio')).toHaveText('numero doppio');
  await scatta(page, 'domanda');
  await dq.locator('.mg-dq-legame').click();
  await expect(page.locator('#mgDetail')).toBeVisible();
  await expect(page.locator('.mg-item[data-id="fb-vero"]')).toHaveClass(/mg-item--selected/);
  await expect(page.locator('#mgDetail')).toContainText('Il testo della pratica vera.');
});

test('domanda aperta prima della lista: stato e mittente arrivano quando la lista arriva', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => { window.__mgTest.setAdmin(true); window.__mgTest.setData([]); });
  const ora = Date.now();
  await page.evaluate((cfg) => window.__mgTest.setDomande(cfg.l, { riferimenti: cfg.r }), {
    l: [{ id: 'D-41', numero: 41, stato: 'aperta', priorita: 'importante', fiducia: 'fidato', titolo: 'Prima della lista',
      creataIl: ora, modificataIl: ora, opzioni: [], consiglio: null, conversazione: [], origine: { tipo: 'feedback', id: 'fb-vero' } }],
    r: { 'fb-vero': { num: '#5', stato: 'working' } },
  });
  await apriScheda(page, 'domande');
  const dq = page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-41"]');
  // Senza la lista vale lo stato mandato dal server.
  await expect(dq.locator('.mg-dq-legame-info')).toHaveText('In lavorazione');
  await page.evaluate((l) => window.__mgTest.setData(l), [ESTRANEO, VERO]);
  await expect(dq.locator('.mg-dq-legame-info')).toHaveText('In lavorazione · sessione locale');
  await expect(dq.locator('.mg-dq-legame-doppio')).toHaveText('numero doppio');
});
