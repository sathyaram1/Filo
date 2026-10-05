// #738 giro 1, esplorazione: il segno di arrivo e quello della fusione ferma nella pagina Feedback, chiaro e scuro.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://feedback/feedback.html';

function fb(id, seq, status, extra = {}) {
  return {
    _id: id, _updateTime: 'v1', seq, subSeq: 0, name: `Segnalazione ${seq}`, text: `Testo ${seq}`, notes: '',
    status, statusReason: null, clientId: 'tester@example.com',
    createdAt: new Date(Date.UTC(2026, 7, 1) + seq * 3600e3).toISOString(), images: [], ...extra,
  };
}

for (const tema of ['light', 'dark']) {
  test(`aspetto ${tema}`, async ({ openTab }) => {
    const page = await openTab(URL);
    await page.emulateMedia({ colorScheme: tema });
    await page.waitForFunction(() => window.__fbTest && window.__fbTest.whenReady && window.filo);
    await page.evaluate(() => window.__fbTest.whenReady());
    await page.evaluate((tema) => {
      document.documentElement.dataset.theme = tema;
      const docs = [fb => fb];
      window.__srv = {
        docs: {
          f515: { _id: 'f515', _updateTime: 'v1', seq: 515, subSeq: 0, name: 'Segnalazione 515', text: 'Testo 515', notes: '', status: 'working', workingSince: new Date().toISOString(), clientId: 't@example.com', createdAt: '2026-08-01T10:00:00Z', images: [] },
          f600: { _id: 'f600', _updateTime: 'v1', seq: 600, subSeq: 0, name: 'Segnalazione 600', text: 'Testo 600', notes: '', status: 'revision_security', clientId: 't@example.com', createdAt: '2026-08-02T10:00:00Z', images: [] },
          f716: { _id: 'f716', _updateTime: 'v1', seq: 716, subSeq: 0, name: 'Segnalazione 716', text: 'Testo 716', notes: '', status: 'design', clientId: 't@example.com', createdAt: '2026-08-03T10:00:00Z', images: [] },
        },
      };
      void docs;
      const orig = window.filo.message.bind(window.filo);
      window.filo.message = async (msg) => {
        if (msg && msg.type === 'merge_approvals_get') {
          return { ok: true, pending: [{ id: 'abcdefabcdefabcdefabcdef', branch: 'claude/f600', sha: 'a'.repeat(40), feedbackId: 'f600', num: '600', who: 'x', origin: 'routine', trips: [{ gate: 'rules', label: 'Regole', items: ['x'] }], createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() }], failed: [], recent: [], preapproved: [] };
        }
        if (msg && msg.type === 'feedback_decrypt_fields') return { ok: true, list: msg.list };
        return orig(msg);
      };
      const copia = (id) => JSON.parse(JSON.stringify(window.__srv.docs[id]));
      window.SN_FEEDBACK.getMany = async (ids) => ids.map(copia);
      window.__fbTest.setLiveSources({
        listVersions: async () => Object.values(window.__srv.docs).map((d) => ({ _id: d._id, _updateTime: d._updateTime, createdAt: d.createdAt })),
        getMany: async (ids) => ids.map(copia),
      });
      window.__fbTest.setAdmin(true, { email: 'owner@example.invalid' });
      window.__fbTest.setLiveTiming({ pollMs: 800, rientroMs: 300, clockMs: 200 });
      window.__fbTest.setData(Object.values(window.__srv.docs).map((d) => ({ ...d })), { dalVivo: true });
    }, tema);
    await page.evaluate(() => window.__fbTest.caricaFusioni());
    await page.evaluate(() => {
      const d = window.__srv.docs.f515;
      window.__srv.docs.f515 = { ...d, status: 'design', statusReason: 'clarify', workingSince: null, _updateTime: 'v2' };
    });
    await expect(page.locator('#tabs [data-tab="inbox"]')).toHaveText('Ricevuti (3)', { timeout: 10_000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `tests/.shots/738-aspetto-${tema}.png` });
  });
}
