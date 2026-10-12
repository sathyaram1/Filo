// Verifica locale «fiducia» (#1148), giro 6: dopo la fusione di main (storia delle fusioni spostata nel Log, #1110)
// «Segna fidato» in Gestione e il controllo a posteriori del lavoro fidato nel Log. Main finto: nessun server vero.
import { test, expect } from './../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';

function fb(over = {}) {
  return Object.assign({
    _id: 'u-1', name: 'Il menu del tasto destro si chiude da solo', text: 'Testo di un utente.',
    seq: 1601, subSeq: 0, status: 'aligned', statusReason: '', statusPublic: 'open',
    clientId: 'utente-abc', createdAt: '2026-10-11T07:00:00Z', images: [],
  }, over);
}

const FUSA_FIDATA = {
  id: 'm-1', num: '1601', feedbackId: 'u-1', branch: 'worker/u-1', sha: 'a'.repeat(40), mergeSha: 'b'.repeat(40),
  origin: 'routine', skippedL5: true, motivo: 'fiducia', decidedAtMs: Date.now() - 3600e3,
  blocks: [{ gate: 'sensitive', items: ['src/main/services/terminal.js'] }],
};

async function apri(page, lista, { errore = '', tab = 'inbox' } = {}) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(({ errore, fusa }) => {
    window.__fiducia = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'feedback_update') return { ok: true };
      if (t === 'fiducia_segna') {
        window.__fiducia.push(msg);
        if (errore) return { ok: false, error: errore };
        return { ok: true, fiducia: msg.fidato === false ? 'non_fidato' : 'fidato' };
      }
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [fusa], preapprovedTotal: 1, ttlMs: 1 };
      return orig(msg);
    };
  }, { errore, fusa: FUSA_FIDATA });
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, lista);
  await page.evaluate((t) => window.__mgTest.setTab(t), tab);
}

test('dal dettaglio: si segna fidato, si toglie, e nessuna traccia di «Fondi senza chiedermelo»', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb()]);
  await page.locator('.mg-item').first().click();
  const btn = page.locator('#mgFiduciaBtn');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveText('🤝 Segna fidato');
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('body')).not.toContainText('Fondi senza chiedermelo');

  await btn.click();
  await expect(btn).toHaveText('🤝 Fidato');
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.__fiducia)).toEqual([{ type: 'fiducia_segna', feedbackId: 'u-1' }]);

  await btn.click();
  await expect(btn).toHaveText('🤝 Segna fidato');
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  const due = await page.evaluate(() => window.__fiducia);
  expect(due[1]).toEqual({ type: 'fiducia_segna', feedbackId: 'u-1', fidato: false });
});

test('dal tasto destro: la stessa azione, e dopo il menu offre di togliere', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb()]);
  await page.locator('.mg-item').first().click({ button: 'right' });
  const segna = page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Segna fidato' });
  await expect(segna).toBeVisible();
  await segna.click();
  await expect(page.locator('#mgFiduciaBtn')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.__fiducia)).toEqual([{ type: 'fiducia_segna', feedbackId: 'u-1' }]);
  await page.locator('.mg-item').first().click({ button: 'right' });
  await expect(page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Togli fiducia' })).toBeVisible();
});

test('un errore del server si legge e lo stato non cambia', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb()], { errore: 'permesso negato' });
  await page.locator('.mg-item').first().click();
  const btn = page.locator('#mgFiduciaBtn');
  await btn.click();
  await expect(page.getByText(/permesso negato/).first()).toBeVisible();
  await expect(btn).toHaveText('🤝 Segna fidato');
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
});

test('su una pratica chiusa il segno non c’è, né dal dettaglio né dal tasto destro', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb({ status: 'done', statusPublic: 'closed' })], { tab: 'resolved' });
  await page.evaluate(() => window.__mgTest.openDetail('u-1'));
  await expect(page.locator('#mgFiduciaBtn')).toBeHidden();
  await page.locator('.mg-item').first().click({ button: 'right' });
  await expect(page.locator('.mg-ctxmenu')).toBeVisible();
  await expect(page.locator('.mg-ctxmenu .sn-select-option', { hasText: /fidato|fiducia/i })).toHaveCount(0);
});

test('nel Log il lavoro fidato fuso senza chiedere si legge per intero, e porta alla segnalazione', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb()]);
  await page.locator('.mg-tab[data-tab="log"]').click();
  const host = page.locator('#mgMergeApprovalsPreapproved');
  await expect(host).toBeVisible();
  await expect(host).toContainText('Fuse senza chiedere');
  await expect(host).toContainText('automazione · feedback #1601');
  await expect(host).toContainText('lavoro fidato: controllo registrato');
  await expect(host).toContainText('src/main/services/terminal.js');
  await host.locator('.sn-mac-origin-link').first().click();
  await expect(page.locator('#mgFiduciaBtn')).toBeVisible();
});
