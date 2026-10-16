// #1033, #1061: alle domande di Claude si risponde dal pannello del rombo verde,
// che si apre da sé sulla pratica che aspetta la risposta; sotto la
// conversazione non c'è più una seconda casella. La risposta entra in chat e la pratica torna in coda.

import { test, expect } from './fixtures/electron.mjs';
import { apriScheda } from './helpers/gestione.mjs';

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
  await page.locator('#mgSideRispostaBtn').click();

  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  const patch = await page.evaluate(() => window.__updates[0]);
  expect(patch.id).toBe(FB_DOMANDE._id);
  expect(patch.status).toBe('todo');
  expect(patch.notes).toContain('Quale pulsante X intendi?');
  expect(patch.notes).toContain('Intendo il pulsante in alto a destra.');
  await expect(page.locator('#mgDetail')).toBeHidden();
  await expect(page.locator('#mgSide')).toBeHidden();
  await apriScheda(page, 'queue');
  await expect(page.locator('.mg-item').filter({ hasText: 'Pulsante X' })).toHaveCount(1);
});

test('aprendo la pratica il pannello delle domande è già aperto, e sotto la conversazione non c’è un’altra casella', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [FB_DOMANDE, FB_SEGNALATO]);
  await page.locator(`.mg-item[data-id="${FB_DOMANDE._id}"]`).first().click();

  await expect(page.locator('#mgSideTitle')).toHaveText('Domande di Claude');
  await expect(page.locator('#mgSideBody')).toContainText('Quale pulsante X intendi?');
  await expect(page.locator('#mgSideRispostaText')).toBeVisible();
  await expect(page.locator('#mgLivelliRow .mg-forma[data-livello="l3"]')).toHaveClass(/mg-forma--scelta/);
  // Al centro resta solo il commento della revisione, che è un'altra cosa.
  await expect(page.locator('#mgDetail textarea:visible:not(#mgAcceptComment)')).toHaveCount(0);
  await expect(page.locator('#mgDetail')).not.toContainText('Invia risposta');
  await page.screenshot({ path: 'tests/.shots/1061-domande-aperte.png' });

  // Chiuso a mano, si riapre dal rombo con la bozza dov'era.
  await page.locator('#mgSideRispostaText').fill('Quello in alto');
  await page.locator('#mgSideClose').click();
  await expect(page.locator('#mgSide')).toBeHidden();
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l3"]').click();
  await expect(page.locator('#mgSideRispostaText')).toHaveValue('Quello in alto');

  // Una pratica che non aspetta niente non apre il pannello da sé.
  await page.evaluate((i) => window.__mgTest.openDetail(i), FB_SEGNALATO._id);
  await expect(page.locator('#mgSide')).toBeHidden();
  await expect(page.locator('#mgSideEmpty')).toBeVisible();
  // Tornando sulla prima, il pannello è di nuovo aperto e la bozza c'è ancora.
  await page.evaluate((i) => window.__mgTest.openDetail(i), FB_DOMANDE._id);
  await expect(page.locator('#mgSideRispostaText')).toHaveValue('Quello in alto');
});

test('le domande arrivate mentre la pratica è aperta aprono il pannello; chiuso dall’owner, un ridisegno non lo riapre', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const inCoda = { ...FB_DOMANDE, status: 'todo', statusReason: null };
  await apri(page, [inCoda]);
  await page.evaluate(() => window.__mgTest.setTab('queue'));
  await page.evaluate((i) => window.__mgTest.openDetail(i), inCoda._id);
  await expect(page.locator('#mgSide')).toBeHidden();

  // Il lavoro si ferma su una domanda mentre l'owner guarda la pratica.
  const arriva = (fb) => page.evaluate((f) => {
    window.__mgTest.setData([f]);
    return window.__mgTest.rerenderIfIdle(f._id);
  }, fb);
  expect(await arriva(FB_DOMANDE)).toBe(true);
  await expect(page.locator('#mgSideRispostaText')).toBeVisible();
  await expect(page.locator('#mgSideBody')).toContainText('Quale pulsante X intendi?');

  await page.locator('#mgSideClose').click();
  expect(await arriva({ ...FB_DOMANDE, name: 'Pulsante X rinominato' })).toBe(true);
  await expect(page.locator('#mgDetail')).toBeVisible();
  await expect(page.locator('#mgSide')).toBeHidden();
});

test('la bozza resta fra un ridisegno e l’altro, e Ctrl+Invio la manda', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [FB_DOMANDE]);
  await page.evaluate((i) => window.__mgTest.openDetail(i), FB_DOMANDE._id);
  const casella = page.locator('#mgSideRispostaText');
  await casella.fill('<b>Quello rosso</b> 🔴');

  // Un ridisegno del pannello (una fusione che cambia) non porta via testo né cursore.
  await casella.focus();
  await casella.press('End');
  await casella.evaluate((el) => { el.dataset.prima = '1'; });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await expect(page.locator('#mgSideRispostaText:not([data-prima])')).toHaveCount(1);
  await expect(page.locator('#mgSideRispostaText')).toBeFocused();
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
  const [fondoMain, testoMain] = await page.locator('#mgAcceptComment').evaluate((el) => {
    const cs = getComputedStyle(el);
    return [cs.backgroundColor, cs.color];
  });
  expect([fondo, testo]).toEqual([fondoMain, testoMain]);
  await page.screenshot({ path: 'tests/.shots/1033-rombo-risposta-scuro.png' });
});

test('domande lunghe: la casella resta a vista in fondo al pannello, le domande scorrono sopra', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const lunghe = Array.from({ length: 40 }, (_, i) => `**${String.fromCharCode(65 + (i % 26))}.** Opzione ${i + 1}: una scelta descritta con calma su più righe.`).join('\n\n');
  await apri(page, [{ ...FB_DOMANDE, notes: `--- Filo ---\nDomande per l'owner (chi risolve):\n${lunghe}` }]);
  await apriRombo(page, FB_DOMANDE._id);

  const corpo = page.locator('#mgSideBody');
  const casella = page.locator('#mgSideRispostaText');
  expect(await corpo.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await expect(casella).toBeInViewport({ ratio: 1 });
  await expect(page.locator('#mgSideRispostaBtn')).toBeInViewport({ ratio: 1 });
  await expect(corpo.locator('.mg-liv-testo')).toContainText('Domande per l');
  // A pannello in cima la casella non copre l'inizio delle domande.
  const inizio = await corpo.locator('.mg-liv-testo').boundingBox();
  expect((await casella.boundingBox()).y).toBeGreaterThan(inizio.y + 40);
  await page.screenshot({ path: 'tests/.shots/1033-rombo-risposta-lunga.png' });

  await corpo.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(corpo.locator('.mg-liv-testo')).toContainText('Opzione 40');
  await expect(casella).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: 'tests/.shots/1033-rombo-risposta-lunga-fondo.png' });
});
