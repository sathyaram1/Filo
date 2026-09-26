// Verifica giro 3: le due porte interne del giro 2 riprovate (punto d'arrivo su una riga sua In coda, segno
// nato da un clic «Approva» che si toglieva solo fondendo) più qualche sequenza insolita sullo stesso segno.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const RICHIESTA = 'abcdefabcdefabcdefabcdef';
const NUOVA = '0123456789abcdef01234567';
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

function richiesta(id, over = {}) {
  return {
    id, branch: 'claude/menu-copertina', sha: SHA, who: 'secaudit', num: '#515',
    feedbackId: 'fb515', origin: 'routine',
    blocks: [{ gate: 'guard_the_guards', label: 'Tocca aree protette', items: ['firestore.rules'], more: 0 }],
    createdAtMs: Date.now() - 60000, expiresAtMs: Date.now() + 86400000,
    expired: false, used: false, discarded: false,
    ...over,
  };
}

async function apri(openTab, docs, { pending = [] } = {}) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(({ docs, pending }) => {
    window.__stato = { docs: Object.fromEntries(docs.map((d) => [d._id, d])), pending };
    window.__chiamate = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') {
        return { ok: true, pending: window.__stato.pending, failed: [], recent: [], preapproved: [], ttlMs: 7 * 86400000 };
      }
      if (t === 'merge_approval_approve' || t === 'feedback_update' || t === 'merge_approval_discard') {
        window.__chiamate.push(msg);
        if (t === 'feedback_update') return { ok: true, by: 'owner@example.com' };
        return { ok: true, result: 'merged', sha: 'deadbeefcafe' };
      }
      if (t === 'feedback_decrypt_fields') return { ok: true, list: msg.list };
      return orig(msg);
    };
    window.__mgTest.setAdmin(true);
    window.__mgTest.setLiveSources({
      listVersions: async () => Object.values(window.__stato.docs).map((d) => ({ _id: d._id, _updateTime: d._updateTime })),
      getMany: async (ids) => ids.map((id) => window.__stato.docs[id]).filter(Boolean),
      getDettagli: async (ids) => ids.map((id) => window.__stato.docs[id]).filter(Boolean),
    });
    window.__mgTest.setData(docs, { dalVivo: true });
    window.__mgTest.setLiveTiming({ pollMs: 400, clockMs: 150, rientroMs: 150 });
  }, { docs, pending });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  return page;
}

const scheda = (page, id) => page.locator(`.mg-item[data-id="${id}"]`);
const tab = (page, t) => page.locator(`.mg-tab[data-tab="${t}"]`);
const chiamate = (page, tipo) => page.evaluate((tipo) => window.__chiamate.filter((c) => c.type === tipo), tipo);

// Distanza del titolo dal bordo alto della sua scheda, e punto d'arrivo rispetto al numero.
async function geometria(page, id) {
  return scheda(page, id).evaluate((el) => {
    const top = el.getBoundingClientRect().top;
    const t = el.querySelector('.mg-item-title').getBoundingClientRect();
    const n = el.querySelector('.mg-item-num').getBoundingClientRect();
    const riga = el.querySelector('.mg-item-row') || el;
    const p = getComputedStyle(riga, '::before');
    return { titolo: t.top - top, numTop: n.top - top, numBottom: n.bottom - top, larghezza: t.width,
      punto: p.content !== 'none' && p.content !== '' ? { w: p.width, h: p.height } : null };
  });
}

test('porta del giro 2: In coda la scheda arrivata tiene il punto sulla riga del numero, il titolo non scende', async ({ openTab }) => {
  const page = await apri(openTab, [
    fb('fb515', { status: 'design', statusReason: 'l5' }),
    fb('ferma', { seq: 600, status: 'working' }),
    fb('altra', { seq: 601, status: 'revision_capability' }),
  ]);
  await tab(page, 'queue').click();
  await expect(scheda(page, 'ferma')).toBeVisible();
  // Torna al lavoro sul server: la scheda arriva In coda a pagina aperta.
  await page.evaluate(() => {
    window.__stato.docs.fb515 = Object.assign({}, window.__stato.docs.fb515, { _updateTime: 't2', status: 'working', statusReason: '' });
  });
  await expect(scheda(page, 'fb515')).toBeVisible({ timeout: 10000 });
  await expect(scheda(page, 'fb515')).toHaveClass(/mg-item--arrivata/);
  const arrivata = await geometria(page, 'fb515');
  const normale = await geometria(page, 'ferma');
  expect(arrivata.punto).not.toBeNull();
  expect(Math.abs(arrivata.titolo - normale.titolo)).toBeLessThanOrEqual(2);
  expect(arrivata.larghezza).toBeGreaterThan(60);
  await page.screenshot({ path: 'tests/.shots/verifica-ricevuti-vivi-g3-arrivo-coda.png' });
  // Aperta, il punto se ne va e la scheda non si sposta.
  await scheda(page, 'fb515').click();
  await expect(scheda(page, 'fb515')).not.toHaveClass(/mg-item--arrivata/);
  expect(Math.abs((await geometria(page, 'fb515')).titolo - normale.titolo)).toBeLessThanOrEqual(2);
});

test('porta del giro 2: il segno di un clic «Approva» si toglie senza fondere la richiesta nuova ferma', async ({ openTab }) => {
  const segno = { by: `owner@example.com · approvazione ${RICHIESTA}`, at: '2026-09-25T08:30:00.000Z' };
  const page = await apri(openTab, [fb('fb515', { status: 'design', statusReason: 'l5', mergePreapproved: segno })],
    { pending: [richiesta(NUOVA)] });
  await tab(page, 'inbox').click();
  await scheda(page, 'fb515').click();
  await expect(scheda(page, 'fb515').locator('.mg-preapproved')).toHaveText('blocchi già approvati');
  const revoca = page.locator('#mgPreapproveRevokeBtn');
  await expect(revoca).toBeVisible();
  await expect(page.locator('#mgPreapproveBtn')).toHaveAttribute('aria-pressed', 'false');
  await page.screenshot({ path: 'tests/.shots/verifica-ricevuti-vivi-g3-revoca-prima.png' });

  await revoca.click();
  await expect.poll(() => chiamate(page, 'feedback_update')).toHaveLength(1);
  const [upd] = await chiamate(page, 'feedback_update');
  expect(upd.mergePreapproved).toBe(false);
  // Niente fusione: la richiesta coi blocchi nuovi resta lì ad aspettare l'owner.
  await page.waitForTimeout(1500);
  expect(await chiamate(page, 'merge_approval_approve')).toHaveLength(0);
  await expect(scheda(page, 'fb515').locator('.mg-preapproved')).toHaveCount(0);
  await expect(revoca).toBeHidden();
  await expect(page.locator('#mgPreapproveBtn')).toHaveText('Fondi senza chiedermelo');
  await expect(page.locator('#mgPreapprovedInfo')).toBeHidden();
  await expect(tab(page, 'inbox')).toContainText('(1)');
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').click();
  await expect(page.locator('#mgSideBody .sn-mac-btn-go')).toBeVisible();

  // Il server conferma (documento riscritto senza segno): niente ritorna.
  await page.evaluate(() => {
    const d = Object.assign({}, window.__stato.docs.fb515, { _updateTime: 't3' });
    delete d.mergePreapproved;
    window.__stato.docs.fb515 = d;
  });
  await page.waitForTimeout(1500);
  await expect(scheda(page, 'fb515').locator('.mg-preapproved')).toHaveCount(0);
  expect(await chiamate(page, 'merge_approval_approve')).toHaveLength(0);
});

test('revoca e subito dopo il segno pieno: il secondo clic fonde, il primo non ha fuso niente', async ({ openTab }) => {
  const segno = { by: `owner@example.com · approvazione ${RICHIESTA}`, at: '2026-09-25T08:30:00.000Z' };
  const page = await apri(openTab, [fb('fb515', { status: 'design', statusReason: 'l5', mergePreapproved: segno })],
    { pending: [richiesta(NUOVA)] });
  await tab(page, 'inbox').click();
  await scheda(page, 'fb515').click();
  await page.locator('#mgPreapproveRevokeBtn').click();
  await expect.poll(() => chiamate(page, 'feedback_update')).toHaveLength(1);
  expect(await chiamate(page, 'merge_approval_approve')).toHaveLength(0);
  await page.locator('#mgPreapproveBtn').click();
  await expect.poll(() => chiamate(page, 'feedback_update')).toHaveLength(2);
  expect((await chiamate(page, 'feedback_update'))[1].mergePreapproved).toBe(true);
  await expect(page.locator('#mgPreapproveBtn')).toHaveAttribute('aria-pressed', 'true');
  await expect(scheda(page, 'fb515').locator('.mg-preapproved')).toHaveText('senza chiedere');
  await expect.poll(() => chiamate(page, 'merge_approval_approve')).toHaveLength(1);
});

test('segno di un clic su una pratica chiusa: né etichetta né tasto per toglierlo', async ({ openTab }) => {
  const segno = { by: `owner@example.com · approvazione ${RICHIESTA}`, at: '2026-09-25T08:30:00.000Z' };
  const page = await apri(openTab, [fb('chiusa', { status: 'done', statusPublic: 'closed', mergePreapproved: segno,
    fixedInVersion: '0.0.1' })]);
  for (const t of ['queue', 'resolved']) {
    await tab(page, t).click();
    if (await scheda(page, 'chiusa').count()) break;
  }
  await scheda(page, 'chiusa').click();
  await expect(scheda(page, 'chiusa').locator('.mg-preapproved')).toHaveCount(0);
  await expect(page.locator('#mgPreapproveRevokeBtn')).toBeHidden();
});

test('l\'owner passa a un\'altra scheda e torna: la Gestione si aggiorna subito, coi tempi veri', async ({ openTab, shell }) => {
  test.setTimeout(150000);
  const page = await apri(openTab, [fb('fb515', { status: 'revision_security' })]);
  await page.evaluate(() => window.__mgTest.setLiveTiming({ pollMs: 60000, clockMs: 5000, rientroMs: 15000 }));
  await tab(page, 'queue').click();
  await expect(scheda(page, 'fb515')).toBeVisible();
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  const lista = Array.isArray(snap) ? snap : (snap.tabs || []);
  const gestione = lista.find((t) => String(t.url || '').startsWith('filo://manage'));
  expect(gestione).toBeTruthy();
  await shell.evaluate(() => window.filoShell.tabs.open('filo://history/history.html'));
  await page.waitForTimeout(17000);
  await page.evaluate(() => {
    window.__stato.docs.fb515 = Object.assign({}, window.__stato.docs.fb515, { _updateTime: 't2', status: 'design', statusReason: 'l5' });
  });
  const tornata = Date.now();
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), gestione.id);
  await expect(scheda(page, 'fb515')).toHaveCount(0, { timeout: 8000 });
  expect(Date.now() - tornata).toBeLessThan(8000);
  await expect(tab(page, 'inbox')).toContainText('(1)');
  await expect(tab(page, 'inbox')).toHaveClass(/mg-tab--arrivi/);
});
