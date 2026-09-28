import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

function fb(id, extra = {}) {
  return {
    _id: id, _updateTime: 't1',
    text: `Testo del feedback ${id}.`,
    name: `Il menu della copertina si chiude da solo ${id}`,
    seq: 515, subSeq: 0,
    clientId: 'tester@example.com', createdAt: '2026-09-20T10:00:00Z', images: [],
    status: 'working', statusPublic: 'open',
    ...extra,
  };
}

async function apri(openTab, docs, { preapproved = [] } = {}) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(({ docs, preapproved }) => {
    window.__stato = { docs: Object.fromEntries(docs.map((d) => [d._id, d])), guasti: 0, giri: 0 };
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') {
        return { ok: true, pending: [], failed: [], recent: [], preapproved, ttlMs: 7 * 86400000 };
      }
      if (t === 'feedback_decrypt_fields') return { ok: true, list: msg.list };
      return orig(msg);
    };
    window.__mgTest.setAdmin(true);
    window.__mgTest.setLiveSources({
      listVersions: async () => {
        window.__stato.giri += 1;
        if (window.__stato.guasti > 0) { window.__stato.guasti -= 1; throw new Error('rete giù'); }
        return Object.values(window.__stato.docs).map((d) => ({ _id: d._id, _updateTime: d._updateTime }));
      },
      getMany: async (ids) => ids.map((id) => window.__stato.docs[id]).filter(Boolean),
      getDettagli: async (ids) => ids.map((id) => window.__stato.docs[id]).filter(Boolean),
    });
    window.__mgTest.setData(docs, { dalVivo: true });
    window.__mgTest.setLiveTiming({ pollMs: 400, clockMs: 150, rientroMs: 150 });
  }, { docs, preapproved });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  return page;
}

const scheda = (page, id) => page.locator(`.mg-item[data-id="${id}"]`);
const tab = (page, t) => page.locator(`.mg-tab[data-tab="${t}"]`);

test('il server non risponde per due giri: la lista non si ferma, e al primo giro buono la pratica passa nei Ricevuti', async ({ openTab }) => {
  const page = await apri(openTab, [fb('fb515'), fb('altra', { seq: 600 })]);
  await tab(page, 'queue').click();
  await expect(scheda(page, 'fb515')).toBeVisible();
  await page.evaluate(() => {
    window.__stato.guasti = 2;
    window.__stato.docs.fb515 = Object.assign({}, window.__stato.docs.fb515, { _updateTime: 't2', status: 'design', statusReason: 'l5' });
  });
  await expect.poll(() => page.evaluate(() => window.__stato.giri), { timeout: 10000 }).toBeGreaterThanOrEqual(3);
  await expect(scheda(page, 'fb515')).toHaveCount(0, { timeout: 10000 });
  await expect(tab(page, 'inbox')).toContainText('(1)');
  await tab(page, 'inbox').click();
  await expect(scheda(page, 'fb515')).toBeVisible();
});

test('la pratica aperta nel pannello sparisce dal server: il pannello si chiude e i numeri scendono', async ({ openTab }) => {
  const page = await apri(openTab, [fb('fb515', { status: 'design', statusReason: 'l5' }), fb('altra', { seq: 600, status: 'design', statusReason: 'l5' })]);
  await tab(page, 'inbox').click();
  await expect(tab(page, 'inbox')).toContainText('(2)');
  await scheda(page, 'fb515').click();
  await expect(page.locator('#mgDetail')).toBeVisible();
  await page.evaluate(() => { delete window.__stato.docs.fb515; });
  await expect(page.locator('#mgDetail')).toBeHidden({ timeout: 10000 });
  await expect(scheda(page, 'fb515')).toHaveCount(0);
  await expect(tab(page, 'inbox')).toContainText('(1)');
  await expect(scheda(page, 'altra')).toBeVisible();
});
