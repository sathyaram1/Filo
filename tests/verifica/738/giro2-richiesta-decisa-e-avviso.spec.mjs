// #738 giro 2: le richieste di fusione a stato fermo spostano la pratica nei due versi, sia aprendo Ricevuti
// (richiesta decisa altrove) sia con l'avviso vero del main.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://feedback/feedback.html';
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

async function apri(openTab, docs, pending) {
  const page = await openTab(URL);
  await page.waitForFunction(() => window.__fbTest && window.__fbTest.whenReady && window.filo);
  await page.evaluate(() => window.__fbTest.whenReady());
  await page.evaluate(({ docs, pending }) => {
    window.__pending = pending;
    window.__letture = 0;
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'merge_approvals_get') { window.__letture += 1; return { ok: true, pending: window.__pending, failed: [], recent: [], preapproved: [] }; }
      if (msg && msg.type === 'feedback_decrypt_fields') return { ok: true, list: msg.list };
      return orig(msg);
    };
    window.__fbTest.setLiveSources({ giro: async () => ({ ok: true, giro: { kind: 'skipped' } }) });
    window.__fbTest.setAdmin(true, { email: 'owner@example.invalid' });
    window.__fbTest.setLiveTiming({ pollMs: 800, rientroMs: 300, clockMs: 200 });
    window.__fbTest.setData(docs.map((d) => ({ ...d })), { dalVivo: true });
  }, { docs, pending });
  await page.evaluate(() => window.__fbTest.caricaFusioni());
  return page;
}

const linguetta = (page, t) => page.locator(`#tabs [data-tab="${t}"]`);

test('richiesta decisa altrove a stato fermo: aprire Ricevuti riporta la pratica In coda', async ({ openTab }) => {
  const page = await apri(openTab, [fb('f515', 515, 'working', { workingSince: new Date().toISOString() }), fb('f716', 716, 'design')], [richiesta('f515', 515)]);
  await expect(linguetta(page, 'inbox')).toHaveText('Ricevuti (2)');
  await expect(linguetta(page, 'queue')).toHaveText('In coda (0)');
  await page.evaluate(() => { window.__pending = []; });
  await linguetta(page, 'queue').click();
  await linguetta(page, 'inbox').click();
  await expect(linguetta(page, 'inbox')).toHaveText('Ricevuti (1)', { timeout: 5000 });
  await expect(linguetta(page, 'queue')).toHaveText('In coda (1)');
  await expect(page.locator('#list .fb-card[data-id="f515"]')).toHaveCount(0);
  await linguetta(page, 'queue').click();
  await expect(page.locator('#list .fb-card[data-id="f515"]')).toBeVisible();
  await expect(page.locator('#list .fb-card[data-id="f515"] .fb-fusione')).toHaveCount(0);
});


test('l\'avviso vero del main porta e riporta la pratica, a stato fermo, senza toccare la pagina', async ({ app, openTab }) => {
  const page = await apri(openTab, [fb('f515', 515, 'working', { workingSince: new Date().toISOString() }), fb('f716', 716, 'design')], []);
  await expect(linguetta(page, 'queue')).toHaveText('In coda (1)');
  const avvisa = (pending) => app.evaluate((_e, msg) => globalThis.SN_BROADCAST_FILO(msg), {
    type: 'merge_approvals_changed', pending, recent: [], ttlMs: 86400000,
  });
  await avvisa([richiesta('f515', 515)]);
  await expect(linguetta(page, 'inbox')).toHaveText('Ricevuti (2)', { timeout: 5000 });
  await expect(linguetta(page, 'queue')).toHaveText('In coda (0)');
  await avvisa([]);
  await expect(linguetta(page, 'inbox')).toHaveText('Ricevuti (1)', { timeout: 5000 });
  await expect(linguetta(page, 'queue')).toHaveText('In coda (1)');
});
