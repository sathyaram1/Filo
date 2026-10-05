// #738 giro 1: una richiesta di fusione aperta in cloud mentre la pagina Feedback è aperta, con lo stato rimasto
// indietro (nessun cambio di stato che faccia rileggere). In Gestione aprire Ricevuti la rilegge e la pratica si
// sposta; nella pagina Feedback la stessa strada deve fare lo stesso.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://feedback/feedback.html';
const MANAGE = 'filo://manage/manage.html';
const RICHIESTA = 'abcdefabcdefabcdefabcdef';

function fb(id, seq, status, extra = {}) {
  return {
    _id: id, _updateTime: 'v1', seq, subSeq: 0, name: `Segnalazione ${seq}`, text: `Testo ${seq}`, notes: '',
    status, statusReason: null, clientId: 'tester@example.com',
    createdAt: new Date(Date.UTC(2026, 7, 1) + seq * 3600e3).toISOString(), images: [], ...extra,
  };
}

function richiesta(feedbackId, num) {
  return {
    id: RICHIESTA, branch: `claude/${feedbackId}`, sha: 'a'.repeat(40), feedbackId, num: String(num),
    who: 'secaudit · x', origin: 'routine', trips: [{ gate: 'rules', label: 'Regole', items: ['firestore.rules'] }],
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };
}

test('richiesta nata in cloud a pagina aperta, stato fermo: aprire Ricevuti la porta lì come in Gestione', async ({ openTab }) => {
  const docs = [fb('f515', 515, 'working', { workingSince: new Date().toISOString() }), fb('f716', 716, 'design')];

  const gestione = await openTab(MANAGE);
  await gestione.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.filo);
  await gestione.evaluate(() => window.__mgTest.whenReady());
  await gestione.evaluate(({ docs }) => {
    window.__pending = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'merge_approvals_get') return { ok: true, pending: window.__pending, failed: [], recent: [], preapproved: [] };
      return orig(msg);
    };
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData(docs);
  }, { docs });
  await gestione.evaluate(() => window.__mgTest.loadMergeApprovals());
  await expect(gestione.locator('.mg-tab[data-tab="queue"] .mg-tab-count')).toHaveText('(1)');

  const page = await openTab(URL);
  await page.waitForFunction(() => window.__fbTest && window.__fbTest.whenReady && window.filo);
  await page.evaluate(() => window.__fbTest.whenReady());
  await page.evaluate(({ docs }) => {
    window.__pending = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'merge_approvals_get') return { ok: true, pending: window.__pending, failed: [], recent: [], preapproved: [] };
      if (msg && msg.type === 'feedback_decrypt_fields') return { ok: true, list: msg.list };
      return orig(msg);
    };
    window.__fbTest.setLiveSources({ giro: async () => ({ ok: true, giro: { kind: 'skipped' } }) });
    window.__fbTest.setAdmin(true, { email: 'owner@example.invalid' });
    window.__fbTest.setLiveTiming({ pollMs: 800, rientroMs: 300, clockMs: 200 });
    window.__fbTest.setData(docs.map((d) => ({ ...d })), { dalVivo: true });
  }, { docs });
  await page.evaluate(() => window.__fbTest.caricaFusioni());
  await expect(page.locator('#tabs [data-tab="queue"]')).toHaveText('In coda (1)');

  // Il server apre la richiesta; lo stato resta «in lavorazione».
  const r = richiesta('f515', 515);
  await page.evaluate((x) => { window.__pending = [x]; }, r);
  await gestione.evaluate((x) => { window.__pending = [x]; }, r);

  // In Gestione aprire Ricevuti rilegge le richieste: la pratica passa lì.
  await gestione.locator('.mg-tab[data-tab="inbox"]').click();
  await expect(gestione.locator('.mg-tab[data-tab="inbox"] .mg-tab-count')).toHaveText('(2)', { timeout: 5000 });

  // La stessa strada nella pagina Feedback.
  await page.locator('#tabs [data-tab="inbox"]').click();
  await expect(page.locator('#tabs [data-tab="inbox"]')).toHaveText('Ricevuti (2)', { timeout: 5000 });
  await expect(page.locator('#list .fb-card[data-id="f515"]')).toBeVisible();
});
