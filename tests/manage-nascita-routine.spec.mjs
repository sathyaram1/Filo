// #914/#1148: in Gestione un feedback fidato aperto da una routine, che i giudici li ha saltati alla nascita, sta nei
// Ricevuti come «da approvare» e dice perché non ha verdetti; senza la fiducia resta da giudicare.

import { test, expect } from './fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';

function fb(over = {}) {
  return Object.assign({
    _id: 'rt-1', name: 'Il cancello non chiude il ramo', text: 'Trovato verificando #900, giro 2.',
    seq: 931, subSeq: 0, status: 'aligned', statusPublic: 'open',
    clientId: 'routine:residuo', senderProof: 'server', fiducia: 'fidato',
    pipeline: { skipped: 'routine_proven', verdicts: [], l1Category: null, l2Class: null, action: 'human_review', stage: 'nascita' },
    createdAt: '2026-10-02T07:00:00Z', images: [],
  }, over);
}

async function apri(page, lista) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      return orig(msg);
    };
  });
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, lista);
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
}

test('routine fidata: nei Ricevuti da approvare, non «da ri-giudicare», e i giudici vuoti dicono perché', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const provata = fb();
  await apri(page, [provata]);

  const scheda = page.locator('.mg-item', { hasText: '#931' });
  await expect(scheda).toHaveCount(1);
  await expect(scheda).not.toHaveClass(/mg-item--unfiltered/);

  await page.evaluate((id) => window.__mgTest.openDetail(id), provata._id);
  await expect(page.locator('#mgThread')).toContainText('Aperto da un lavoro fidato: i giudici non servono.');
  await page.locator('#mgLivelliRow .mg-dot--empty').first().click();
  await expect(page.locator('#mgSideBody')).toContainText(/giudici non servono/i);
  await expect(page.locator('#mgSideBody')).not.toContainText(/credito esaurito/);
});

test('lo stesso segno senza la fiducia non vale, nemmeno con la prova del server: resta da giudicare', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const finta = fb({ _id: 'rt-2', seq: 932, senderProof: undefined, fiducia: undefined });
  const provata = fb({ _id: 'rt-3', seq: 933, fiducia: undefined });
  await apri(page, [finta, provata]);
  for (const id of ['rt-2', 'rt-3']) {
    await page.evaluate((i) => window.__mgTest.openDetail(i), id);
    await expect(page.locator('#mgThread')).not.toContainText(/giudici non servono/i);
  }
});
