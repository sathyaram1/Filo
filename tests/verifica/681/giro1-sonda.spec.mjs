// Sonda della verifica #681: nome del rombo verde e testo cifrato nel pannello.
import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';

function pratica(over = {}) {
  return Object.assign({
    _id: 'fb-681-001',
    text: 'Il riquadro della traduzione copre il testo selezionato.',
    name: 'Riquadro che copre',
    seq: 904,
    subSeq: 0,
    clientId: 'tester@example.com',
    createdAt: '2026-09-20T10:00:00Z',
    images: [],
    status: 'design',
    statusReason: 'clarify',
    statusPublic: 'open',
    _updateTime: 't1',
    notes: 'Il riquadro copriva la selezione o la riga sotto?',
  }, over);
}

async function apri(page, fbs) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo && window.SN_MANAGE_REVIEW);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      if (t === 'feedback_update') return { ok: true };
      return orig(msg);
    };
  });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((list) => window.__mgTest.setData(list), fbs);
}

async function apriDettaglio(page, fb) {
  await page.evaluate((f) => window.__mgTest.setTab(window.SN_MANAGE_REVIEW.manageTabFor(f, {})), fb);
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await expect(page.locator('#mgDetail')).toBeVisible();
}

async function arriva(page, doc) {
  await page.evaluate((d) => {
    window.__mgTest.setLiveSources({
      listVersions: async () => [{ _id: d._id, _updateTime: d._updateTime }],
      getMany: async () => [d],
    });
  }, doc);
  await page.evaluate(() => window.__mgTest.pollNow());
}

const rombo = (page) => page.locator('#mgForme .mg-forma[data-livello="l3"]');
const SEGN = { l3: { esito: 'segnalato', ruolo: 'resolver', at: '2026-09-20T11:00:00.000Z', testo: 'Ho scelto di spostare il riquadro sotto la riga.' } };

test('domande e segnalazione: hover e titolo coprono entrambe; risposta altrove riporta il nome', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ livelli: SEGN });
  await apri(page, [fb]);
  await apriDettaglio(page, fb);
  const t = await rombo(page).getAttribute('title');
  console.log('HOVER', t);
  await rombo(page).click();
  console.log('TITOLO', await page.locator('#mgSideTitle').innerText());
  console.log('CORPO', await page.locator('#mgSideBody').innerText());
  await page.screenshot({ path: 'tests/.shots/681-entrambe.png' });
  await arriva(page, pratica({ livelli: SEGN, _updateTime: 't2', status: 'todo', statusReason: '' }));
  await page.waitForTimeout(500);
  console.log('DOPO HOVER', await rombo(page).getAttribute('title'));
  console.log('DOPO TITOLO', await page.locator('#mgSideTitle').innerText(), 'visibile', await page.locator('#mgSide').isVisible());
});

for (const [nome, over] of [
  ['decisione cifrata', { statusReason: 'decisione', livelli: { l3: { ...SEGN.l3, testo: 'FENCv1:abcdef0123' } } }],
  ['clarify cifrata note vuote', { notes: '', livelli: { l3: { ...SEGN.l3, testo: 'FENCv1:abcdef0123' } } }],
  ['entrambe cifrate', { notes: 'FENCv1:zz', livelli: { l3: { ...SEGN.l3, testo: 'FENCv1:abcdef0123' } } }],
  ['note cifrate segnalazione leggibile', { notes: 'FENCv1:zz', livelli: SEGN }],
  ['legacy clarify cifrata', { status: 'clarify', statusReason: '', livelli: { l3: { ...SEGN.l3, testo: 'FENCv1:abcdef0123' } } }],
]) {
  test(`cifrato: ${nome}`, async ({ openTab }) => {
    const page = await openTab(MANAGE);
    const fb = pratica(over);
    await apri(page, [fb]);
    await apriDettaglio(page, fb);
    await rombo(page).click();
    const corpo = await page.locator('#mgSideBody').innerText();
    console.log(nome, '| TITOLO', await page.locator('#mgSideTitle').innerText(), '| CORPO', JSON.stringify(corpo));
    expect(corpo).not.toContain('FENCv1');
  });
}

test('tema scuro: pannello con entrambe le parti', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.emulateMedia({ colorScheme: 'dark' });
  const fb = pratica({ livelli: { l3: { ...SEGN.l3, testo: 'FENCv1:abcdef0123' } } });
  await apri(page, [fb]);
  await apriDettaglio(page, fb);
  await rombo(page).hover();
  await rombo(page).click();
  await page.screenshot({ path: 'tests/.shots/681-scuro.png' });
});
