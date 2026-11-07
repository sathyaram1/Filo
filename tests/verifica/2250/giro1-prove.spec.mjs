// Verifica #2250 giro 1: «Approva e fondi» con voci chiuse apre le voci invece di restare spento, la fusione in volo ha
// rotella e tempo che scorre, e una pratica con parte server appena fusa non diventa rossa «fusione ferma».

import { test, expect } from '../../fixtures/electron.mjs';
import { apriScheda } from '../../helpers/gestione.mjs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const MANAGE = 'filo://manage/manage.html';
const SHA = 'a1b2c3d4'.repeat(5);
const BASE = 'b0b0b0b0'.repeat(5);
const DIFF = `https://github.com/sathyaram1/Filo/compare/${BASE}...${SHA}`;
const GIORNO = 24 * 60 * 60 * 1000;

const voci = (n, pref) => Array.from({ length: n }, (_, i) => ({
  file: `src/main/${pref}${i}.js`, riga: 10 + i, testo: `chiama('${pref}-${i}');`, url: `${DIFF}#diff-${'0'.repeat(64)}R${10 + i}`,
}));

function richiesta(blocks, over = {}) {
  return Object.assign({
    id: 'cd12cd34ef56ab12cd34ef56',
    branch: 'claude/voci-chiuse',
    sha: SHA,
    diffUrl: DIFF,
    who: 'owner@esempio',
    blocks,
    createdAtMs: Date.now() - 60 * 1000,
    expiresAtMs: Date.now() + GIORNO,
    expired: false,
    used: false,
    discarded: false,
  }, over);
}

// `approva`: 'mai' = la risposta del server non arriva (fusione in volo), altrimenti la risposta data.
async function apriGestione(page, { pending = [], approva = 'mai' } = {}) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((cfg) => {
    window.__approvate = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') {
        return { ok: true, pending: cfg.pending, failed: [], recent: [], preapproved: [], preapprovedTotal: 0, ttlMs: 7 * GIORNO };
      }
      if (t === 'merge_approval_approve') {
        window.__approvate.push(msg.id);
        if (cfg.approva === 'mai') return new Promise(() => {});
        return cfg.approva;
      }
      return orig(msg);
    };
  }, { pending, approva });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.setData([]));
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await apriScheda(page, 'automation');
}

const DUE_BLOCCHI = [
  { gate: 'child_process', gruppo: 'capacita', label: 'Avvia un programma esterno', voci: voci(20, 'servizio'), more: 0 },
  { gate: 'diff_integrity', gruppo: 'contenuto', label: 'Il diff non si lascia leggere per intero', voci: voci(15, 'grezzo'), more: 0 },
];

test('voci chiuse: il tasto è acceso e dice quante ne apre, il clic le apre tutte, poi approva con la conferma', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apriGestione(page, { pending: [richiesta(DUE_BLOCCHI)] });
  const card = page.locator('#mgMergeApprovalsOrphans .sn-mac-card');
  await expect(card).toBeVisible({ timeout: 8_000 });
  const tasto = card.locator('.sn-mac-btn-go');
  await expect(tasto).toHaveText('Apri le 11 voci');
  await expect(tasto).toBeEnabled();
  await expect(card).not.toContainText('Apri tutte le voci per approvare');
  expect((await tasto.getAttribute('title')) || '').not.toBe('');
  await card.screenshot({ path: 'tests/.shots/verifica-2250-voci-chiuse-chiaro.png' }).catch(() => {});

  await tasto.click();
  const tutte = card.locator('.sn-mac-voce');
  await expect(tutte).toHaveCount(35);
  for (let i = 0; i < 35; i++) await expect(tutte.nth(i)).toBeVisible();
  // La prima voce appena aperta (la tredicesima del primo blocco) è in vista.
  await expect(card.locator('.sn-mac-gruppo[data-gruppo="capacita"] .sn-mac-voce').nth(12)).toBeInViewport();
  await expect(tasto).toHaveText('Approva e fondi');
  await expect(tasto).toBeEnabled();
  expect(await page.evaluate(() => window.__approvate.length)).toBe(0);

  await tasto.click();
  await expect(tasto).toHaveText('Confermi?');
  await tasto.click();
  await expect.poll(() => page.evaluate(() => window.__approvate.length)).toBe(1);
});

test('un doppio clic su «Apri le N voci» apre le voci e non arma la conferma', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apriGestione(page, { pending: [richiesta(DUE_BLOCCHI)] });
  const tasto = page.locator('#mgMergeApprovalsOrphans .sn-mac-card .sn-mac-btn-go');
  await expect(tasto).toHaveText('Apri le 11 voci', { timeout: 8_000 });
  await tasto.dblclick();
  await expect(tasto).toHaveText('Approva e fondi');
  await page.waitForTimeout(300);
  await expect(tasto).toHaveText('Approva e fondi');
  expect(await page.evaluate(() => window.__approvate.length)).toBe(0);
});

test('aprire le voci a mano, blocco per blocco, porta il tasto ad «Approva e fondi»', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apriGestione(page, { pending: [richiesta(DUE_BLOCCHI)] });
  const card = page.locator('#mgMergeApprovalsOrphans .sn-mac-card');
  const tasto = card.locator('.sn-mac-btn-go');
  await expect(tasto).toHaveText('Apri le 11 voci', { timeout: 8_000 });
  await card.locator('.sn-mac-gruppo[data-gruppo="capacita"] .sn-mac-tutte').click();
  await expect(tasto).toHaveText('Apri le 3 voci');
  await card.locator('.sn-mac-gruppo[data-gruppo="contenuto"] .sn-mac-tutte').click();
  await expect(tasto).toHaveText('Approva e fondi');
});

test('un blocco di un server di prima con voci mai mandate: il tasto le conta e il clic le dice', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const vecchio = [{ gate: 'diff_integrity', label: 'Il diff non si lascia leggere', items: ['a.js', 'b.js', 'c.js'], more: 73 }];
  await apriGestione(page, { pending: [richiesta(vecchio)] });
  const card = page.locator('#mgMergeApprovalsOrphans .sn-mac-card');
  const tasto = card.locator('.sn-mac-btn-go');
  await expect(tasto).toHaveText('Apri le 73 voci', { timeout: 8_000 });
  await tasto.click();
  await expect(card.locator('.sn-mac-mancanti')).toBeVisible();
  await expect(tasto).toHaveText('Approva e fondi');
});

test('fusione in volo: rotella, «Sto fondendo» e un tempo dal clic che cresce, anche dopo un ridisegno', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const poche = [{ gate: 'child_process', gruppo: 'capacita', label: 'Avvia un programma esterno', voci: voci(3, 'x'), more: 0 }];
  await apriGestione(page, { pending: [richiesta(poche)] });
  const card = page.locator('#mgMergeApprovalsOrphans .sn-mac-card');
  const tasto = card.locator('.sn-mac-btn-go');
  await expect(tasto).toHaveText('Approva e fondi', { timeout: 8_000 });
  await tasto.click();
  await tasto.click();
  await expect(tasto).toHaveText('Sto fondendo');
  await expect(tasto).toHaveClass(/is-fondendo/);
  // La rotella: un ::before che gira.
  const anim = await tasto.evaluate((b) => getComputedStyle(b, '::before').animationName);
  expect(anim).not.toBe('none');
  // Il tasto non è sbiadito come uno spento.
  expect(Number(await tasto.evaluate((b) => getComputedStyle(b).opacity))).toBe(1);
  const tempo = card.locator('.sn-mac-status .sn-mac-trascorso');
  await expect(tempo).toBeVisible();
  const prima = await tempo.textContent();
  await page.waitForTimeout(2_300);
  const dopo = await tempo.textContent();
  expect(dopo).not.toBe(prima);
  await card.screenshot({ path: 'tests/.shots/verifica-2250-in-volo-chiaro.png' }).catch(() => {});

  // Una rilettura delle fusioni a metà volo non riporta il tempo a zero.
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.waitForTimeout(500);
  const card2 = page.locator('#mgMergeApprovalsOrphans .sn-mac-card');
  await expect(card2.locator('.sn-mac-btn-go')).toHaveText('Sto fondendo');
  const secondi = (t) => { const m = /(\d+) s/.exec(t || ''); return m ? Number(m[1]) : -1; };
  expect(secondi(await card2.locator('.sn-mac-trascorso').textContent())).toBeGreaterThanOrEqual(2);
});

test('tema scuro: le schede nei due stati', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.emulateMedia({ colorScheme: 'dark' });
  await apriGestione(page, { pending: [richiesta(DUE_BLOCCHI)] });
  const card = page.locator('#mgMergeApprovalsOrphans .sn-mac-card');
  await expect(card).toBeVisible({ timeout: 8_000 });
  await card.locator('.sn-mac-actions').scrollIntoViewIfNeeded();
  await card.screenshot({ path: 'tests/.shots/verifica-2250-voci-chiuse-scuro.png' }).catch(() => {});
  await card.locator('.sn-mac-btn-go').click();
  await card.locator('.sn-mac-btn-go').click();
  await card.locator('.sn-mac-btn-go').click();
  await expect(card.locator('.sn-mac-btn-go')).toHaveText('Sto fondendo');
  await page.waitForTimeout(1_200);
  await card.locator('.sn-mac-actions').screenshot({ path: 'tests/.shots/verifica-2250-in-volo-scuro.png' }).catch(() => {});
});

test.describe('pratica con parte server appena fusa', () => {
  require(join(ROOT, 'src', 'shared', 'feedbackStatus.js'));
  require(join(ROOT, 'src', 'shared', 'domande.js'));
  require(join(ROOT, 'src', 'shared', 'manageReview.js'));
  const MR = globalThis.SN_MANAGE_REVIEW;
  const FUSA_ALLE = Date.parse('2026-11-07T10:48:58Z');
  const pratica = (over = {}) => Object.assign({
    _id: 'fb1249x4', seq: 1249, subSeq: 4, num: '#1249.4', status: 'design', statusReason: 'l5',
    branch: 'worker/abc', localOnly: { by: 'owner', at: '2026-11-06T10:00:00Z' },
  }, over);
  const fusa = { id: 'r1', feedbackId: 'fb1249x4', branch: 'worker/abc', used: true, outcome: 'merged', decidedAtMs: FUSA_ALLE, createdAtMs: FUSA_ALLE - 300_000 };
  const opts = { fusioni: { pending: [], failed: [], preapproved: [], recent: [fusa] }, fusioniLette: true };

  test('documento di prima della fusione: è fusa, non ferma', () => {
    const l = MR.livelloL5(pratica({ updatedAt: '2026-11-07T10:44:00Z' }), opts);
    expect(l.statoFusione).toBe('fusa');
  });
  test('documento di prima, conosciuto solo dall’ora di Firestore: è fusa', () => {
    const l = MR.livelloL5(pratica({ _updateTime: '2026-11-07T10:44:00Z' }), opts);
    expect(l.statoFusione).toBe('fusa');
  });
  test('documento cambiato dopo la fusione e ancora fermo: l’ha fermata il cancello del server', () => {
    const l = MR.livelloL5(pratica({ updatedAt: '2026-11-07T10:50:00Z' }), opts);
    expect(l.statoFusione).toBe('senza');
  });
  test('la fusa di un altro ramo non conta', () => {
    const l = MR.livelloL5(pratica({ updatedAt: '2026-11-07T10:44:00Z', branch: 'worker/nuovo' }), opts);
    expect(l.statoFusione).toBe('senza');
  });
});
