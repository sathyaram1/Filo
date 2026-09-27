// Verifica giro 4 (dopo il riallineamento): la fusione nata dal segno di un clic nell'elenco «Fuse senza chiedere»,
// l'aggiornamento continuo che regge a un server che non risponde, la pratica aperta che sparisce dal server.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const RICHIESTA = 'abcdefabcdefabcdefabcdef';
const SHA = 'a1b2c3d4'.repeat(5);

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

test('fusa grazie al segno di un clic: l\'elenco «Fuse senza chiedere» non dice che l\'owner aveva scelto «fondi senza chiedermelo»', async ({ openTab }) => {
  const record = {
    id: '1111111111111111aaaaaaaa', branch: 'claude/menu-copertina', sha: SHA, mergeSha: 'feedfacecafe',
    who: 'worker', num: '#515', feedbackId: 'fb515', origin: 'routine',
    blocks: [{ gate: 'guard_the_guards', label: 'Tocca aree protette', items: ['firestore.rules'], more: 0 }],
    used: true, outcome: 'merged', preapproved: true,
    preapprovedBy: `owner@example.com · approvazione ${RICHIESTA}`, preapprovedAt: '2026-09-25T08:30:00.000Z',
    createdAtMs: Date.now() - 3600000, decidedAtMs: Date.now() - 3000000,
  };
  const page = await apri(openTab, [fb('fb515', { status: 'working' })], { preapproved: [record] });
  await tab(page, 'automation').click();
  const box = page.locator('#mgMergeApprovalsPreapproved');
  await expect(box).toBeVisible({ timeout: 8000 });
  await box.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/.shots/verifica-ricevuti-vivi-g4-fuse-da-clic.png' });
  // La riga dice il vero (viene dal sì a una richiesta, senza il codice)...
  await expect(box.locator('.sn-mac-recent-who')).toContainText('dal tuo sì');
  await expect(box).not.toContainText(RICHIESTA);
  // ...e il testo che la presenta non deve contraddirla: l'owner non ha mai premuto «Fondi senza chiedermelo».
  await expect(box.locator('.sn-mac-preapproved-intro')).not.toContainText('fondi senza chiedermelo');
});

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
