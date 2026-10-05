// #1033: si risponde alle domande di Claude anche dal pannello del rombo verde.
// La casella del pannello e quella sotto la conversazione sono la stessa
// risposta (una bozza, un invio): la risposta entra in chat e la pratica torna in coda.

import { test, expect } from './fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';

const FB_DOMANDE = {
  _id: 'fb-risposta-rombo', text: 'Il pulsante X non funziona.', name: 'Pulsante X',
  seq: 1033, subSeq: 0, status: 'design', statusReason: 'clarify',
  notes: '--- Filo ---\nQuale pulsante X intendi? Non lo trovo.',
  clientId: 'tester@example.com', createdAt: '2026-10-05T10:00:00Z', images: [],
};

const FB_SEGNALATO = {
  _id: 'fb-risposta-segnalato', text: 'Menu stretto.', name: 'Menu stretto',
  seq: 1034, subSeq: 0, status: 'todo', reviewDecision: 'accepted',
  clientId: 'tester@example.com', createdAt: '2026-10-05T10:00:00Z', images: [],
  livelli: { l3: { esito: 'segnalato', ruolo: 'verifier', at: '2026-10-05T11:00:00Z', testo: 'Accorciare o andare a capo?' } },
};

async function apri(page, fbs, { admin = true, risposta = { ok: true } } = {}) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo && window.SN_FEEDBACK_THREAD);
  await page.evaluate(() => window.__mgTest.whenReady && window.__mgTest.whenReady());
  await page.evaluate((r) => {
    window.__updates = [];
    window.__risposta = r;
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') { window.__updates.push(msg); return window.__risposta; }
      return orig(msg);
    };
  }, risposta);
  await page.evaluate((a) => window.__mgTest.setAdmin(a), admin);
  await page.evaluate((list) => window.__mgTest.setData(list), fbs);
}

async function apriRombo(page, id) {
  await page.evaluate((i) => window.__mgTest.openDetail(i), id);
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l3"]').click();
  await expect(page.locator('#mgSideTitle')).toHaveText(/Domande|Segnalazione/);
}

test('dal rombo verde si risponde: la risposta entra in conversazione e la pratica torna in coda', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [FB_DOMANDE]);
  await apriRombo(page, FB_DOMANDE._id);

  const casella = page.locator('#mgSideBody #mgSideRispostaText');
  await expect(casella).toBeVisible();
  // Sotto le domande, non sopra.
  const yDomande = (await page.locator('#mgSideBody .mg-liv-testo').boundingBox()).y;
  expect((await casella.boundingBox()).y).toBeGreaterThan(yDomande);
  await page.screenshot({ path: 'tests/.shots/1033-rombo-risposta.png' });

  await casella.fill('Intendo il pulsante in alto a destra.');
  // Una risposta sola: quella sotto la conversazione dice la stessa cosa.
  await expect(page.locator('#mgClarifyText')).toHaveValue('Intendo il pulsante in alto a destra.');
  await page.locator('#mgSideRispostaBtn').click();

  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  const patch = await page.evaluate(() => window.__updates[0]);
  expect(patch.id).toBe(FB_DOMANDE._id);
  expect(patch.status).toBe('todo');
  expect(patch.notes).toContain('Quale pulsante X intendi?');
  expect(patch.notes).toContain('Intendo il pulsante in alto a destra.');
  await expect(page.locator('#mgDetail')).toBeHidden();
  await expect(page.locator('#mgSide')).toBeHidden();
  await page.locator('.mg-tab[data-tab="queue"]').click();
  await expect(page.locator('.mg-item').filter({ hasText: 'Pulsante X' })).toHaveCount(1);
});

test('la bozza è una sola: scritta sotto la conversazione si ritrova nel pannello, e Ctrl+Invio la manda', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [FB_DOMANDE]);
  await page.evaluate((i) => window.__mgTest.openDetail(i), FB_DOMANDE._id);
  await page.locator('#mgClarifyText').fill('<b>Quello rosso</b> 🔴');
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l3"]').click();
  const casella = page.locator('#mgSideRispostaText');
  await expect(casella).toHaveValue('<b>Quello rosso</b> 🔴');

  // Un ridisegno del pannello (una fusione che cambia) non porta via testo né cursore.
  await casella.focus();
  await casella.press('End');
  await page.evaluate(() => window.__mgTest.loadMergeApprovals && window.__mgTest.loadMergeApprovals());
  await page.keyboard.type(' grazie');
  await expect(page.locator('#mgSideRispostaText')).toHaveValue('<b>Quello rosso</b> 🔴 grazie');

  await page.locator('#mgSideRispostaText').press('Control+Enter');
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  expect(await page.evaluate(() => window.__updates[0].notes)).toContain('<b>Quello rosso</b> 🔴 grazie');
});

test('vuoto o soli spazi non parte; un rifiuto lo dice nel pannello e la bozza resta', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [FB_DOMANDE], { risposta: { ok: false, error: 'aggiornamento rifiutato dal server' } });
  await apriRombo(page, FB_DOMANDE._id);
  const casella = page.locator('#mgSideRispostaText');

  await casella.fill('   ');
  await page.locator('#mgSideRispostaBtn').click();
  await expect(casella).toBeFocused();
  expect(await page.evaluate(() => window.__updates.length)).toBe(0);

  await casella.fill('Quello in alto.');
  await page.locator('#mgSideRispostaBtn').click();
  await expect(page.locator('#mgSideRispostaMsg')).toHaveText('aggiornamento rifiutato dal server');
  await expect(casella).toHaveValue('Quello in alto.');
  await expect(page.locator('#mgSideRispostaBtn')).toBeEnabled();
  await expect(page.locator('#mgDetail')).toBeVisible();
});

test('il rombo che non aspetta una risposta non ha la casella; e nemmeno chi non è l’owner', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [FB_SEGNALATO, FB_DOMANDE]);
  await apriRombo(page, FB_SEGNALATO._id);
  await expect(page.locator('#mgSideBody')).toContainText('Accorciare o andare a capo?');
  await expect(page.locator('#mgSideRispostaText')).toHaveCount(0);

  await page.evaluate(() => window.__mgTest.setAdmin(false));
  await apriRombo(page, FB_DOMANDE._id);
  await expect(page.locator('#mgSideBody')).toContainText('Quale pulsante X intendi?');
  await expect(page.locator('#mgSideRispostaText')).toHaveCount(0);
});

test('tema scuro: la casella del pannello segue i colori della pagina', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.emulateMedia({ colorScheme: 'dark' });
  await apri(page, [FB_DOMANDE]);
  await apriRombo(page, FB_DOMANDE._id);
  const [fondo, testo] = await page.locator('#mgSideRispostaText').evaluate((el) => {
    const cs = getComputedStyle(el);
    return [cs.backgroundColor, cs.color];
  });
  const [fondoMain, testoMain] = await page.locator('#mgClarifyText').evaluate((el) => {
    const cs = getComputedStyle(el);
    return [cs.backgroundColor, cs.color];
  });
  expect([fondo, testo]).toEqual([fondoMain, testoMain]);
  await page.screenshot({ path: 'tests/.shots/1033-rombo-risposta-scuro.png' });
});
