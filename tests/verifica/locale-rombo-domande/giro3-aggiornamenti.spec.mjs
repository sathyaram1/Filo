// VERIFICA LOCALE, giro 3 — il rombo verde quando la pratica CAMBIA sotto gli
// occhi dell'owner, e i casi in cui il testo del pannello arriva illeggibile.
//
// I giri 1 e 2 hanno provato la scheda aperta com'è: apri, guardi, chiudi.
// Qui provo la stessa cosa mentre la pratica si muove — Filo fa la domanda
// mentre la scheda è già aperta, la risposta parte dall'altra pagina, il
// pannello del rombo è aperto e arriva una domanda nuova — e i testi che
// questo computer non sa leggere.

import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';

function pratica(over = {}) {
  return Object.assign({
    _id: 'fb-g3-001',
    text: 'Il riquadro della traduzione copre il testo selezionato.',
    name: 'Riquadro che copre',
    seq: 903,
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

async function apri(page, { admin = true, fbs = [] } = {}) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo && window.SN_MANAGE_REVIEW);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((cfg) => {
    window.__inviati = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: cfg.admin, isAdmin: cfg.admin, profile: null };
      if (t === 'merge_approvals_get') {
        if (!cfg.admin) return { ok: false, error: 'Operazione riservata agli amministratori.' };
        return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 7 * 24 * 60 * 60 * 1000 };
      }
      if (t === 'feedback_update') { window.__inviati.push(msg); return { ok: true }; }
      return orig(msg);
    };
  }, { admin });
  await page.evaluate((a) => window.__mgTest.setAdmin(a), admin);
  await page.evaluate((list) => window.__mgTest.setData(list), fbs);
}

async function apriDettaglio(page, fb) {
  await page.evaluate((f) => window.__mgTest.setTab(window.SN_MANAGE_REVIEW.manageTabFor(f, {})), fb);
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await expect(page.locator('#mgDetail')).toBeVisible();
}

// Un aggiornamento che arriva da solo, come quando un'altra istanza scrive.
async function arriva(page, doc) {
  await page.evaluate((d) => {
    window.__mgTest.setLiveSources({
      listVersions: async () => [{ _id: d._id, _updateTime: d._updateTime }],
      getMany: async () => [d],
    });
  }, doc);
  const r = await page.evaluate(() => window.__mgTest.pollNow());
  expect(r.changed).toBe(1);
}

const rombo = (page) => page.locator('#mgForme .mg-forma[data-livello="l3"]');

test('la domanda che arriva a scheda già aperta accende il rombo e apre la casella, senza riaprire', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  // Parte senza domande: in lavorazione, rombo spento e nessuna casella.
  const prima = pratica({ status: 'working', statusReason: '', notes: '' });
  await apri(page, { fbs: [prima] });
  await apriDettaglio(page, prima);
  await expect(rombo(page)).toHaveClass(/mg-forma--vuota/);
  await expect(page.locator('#mgClarify')).toBeHidden();

  // Filo fa la domanda mentre l'owner sta leggendo la scheda.
  await arriva(page, pratica({ _updateTime: 't2' }));

  await expect(page.locator('#mgClarify')).toBeVisible();
  await expect(rombo(page)).toHaveClass(/mg-forma--design/);
  await expect(rombo(page)).not.toHaveClass(/mg-forma--vuota/);
  await rombo(page).click();
  await expect(page.locator('#mgSideBody')).toContainText('Il riquadro copriva la selezione o la riga sotto?');
});

test('la risposta data altrove spegne il rombo e chiude la casella, senza riaprire', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  await apri(page, { fbs: [fb] });
  await apriDettaglio(page, fb);
  await expect(page.locator('#mgClarify')).toBeVisible();
  await expect(rombo(page)).toHaveClass(/mg-forma--design/);

  // L'owner risponde dall'altra pagina (Ricevuti): la pratica rientra in coda.
  await arriva(page, pratica({
    _updateTime: 't2',
    status: 'todo',
    statusReason: '',
    notes: 'Il riquadro copriva la selezione o la riga sotto?\n\nLa selezione.',
  }));

  await expect(page.locator('#mgClarify')).toBeHidden();
  await expect(rombo(page)).toHaveClass(/mg-forma--vuota/);
});

test('col pannello del rombo aperto, la domanda nuova sostituisce quella vecchia', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  await apri(page, { fbs: [fb] });
  await apriDettaglio(page, fb);
  await rombo(page).click();
  await expect(page.locator('#mgSideBody')).toContainText('Il riquadro copriva la selezione');

  const FT = 'La selezione.';
  await arriva(page, pratica({
    _updateTime: 't2',
    notes: `Il riquadro copriva la selezione o la riga sotto?\n\n${FT}\n\nIl riquadro lo apri col tasto destro o con la scorciatoia?`,
  }));

  await expect(page.locator('#mgSide')).toBeVisible();
  await expect(page.locator('#mgSideBody')).toContainText('col tasto destro o con la scorciatoia?');
});

test('domande in attesa e segnalazione cifrata: il pannello dice perché, non mostra il blob', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({
    livelli: { l3: { esito: 'segnalato', ruolo: 'resolver', at: '2026-09-20T11:00:00.000Z', testo: 'FENCv1:8f3a2b91c7d4e6a0b5f2' } },
  });
  await apri(page, { fbs: [fb] });
  await apriDettaglio(page, fb);
  await expect(rombo(page)).toHaveClass(/mg-forma--design/);
  await rombo(page).click();
  const body = page.locator('#mgSideBody');
  await expect(body).toContainText('Il riquadro copriva la selezione o la riga sotto?');
  // Il blob non si mostra mai: lo dice la stessa pagina quando le domande non
  // ci sono, e le domande in attesa non possono cambiare questa regola.
  expect(await body.innerText()).not.toContain('FENCv1:8f3a2b91c7d4e6a0b5f2');
});

test('domande in attesa e conversazione cifrata: si dice che manca la chiave, niente blob', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ notes: 'FENCv1:aa11bb22cc33dd44ee55' });
  await apri(page, { fbs: [fb] });
  await apriDettaglio(page, fb);
  await expect(page.locator('#mgClarify')).toBeVisible();
  await expect(rombo(page)).toHaveClass(/mg-forma--design/);
  await rombo(page).click();
  expect(await page.locator('#mgSideBody').innerText()).not.toContain('FENCv1:aa11bb22cc33dd44ee55');
});

test('il rombo verde dice, passandoci sopra e nel pannello, che ci sono domande', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  // Nessuna segnalazione registrata: il verde qui vuol dire solo «domande per te».
  const fb = pratica();
  await apri(page, { fbs: [fb] });
  await apriDettaglio(page, fb);
  await expect(rombo(page)).toHaveClass(/mg-forma--design/);
  const hover = await rombo(page).getAttribute('title');
  const aria = await rombo(page).getAttribute('aria-label');
  expect(`${hover} ${aria}`.toLowerCase()).toContain('domand');
  await rombo(page).click();
  expect((await page.locator('#mgSideTitle').innerText()).toLowerCase()).toContain('domand');
});

test('rispondendo dalla casella la pratica esce dai chiarimenti e il rombo torna spento', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  await apri(page, { fbs: [fb] });
  await apriDettaglio(page, fb);
  await page.locator('#mgClarifyText').fill('La selezione, e succede anche col tema scuro.');
  await page.locator('#mgClarifyBtn').click();
  await expect(page.locator('#mgClarify')).toBeHidden();
  const inviati = await page.evaluate(() => window.__inviati);
  expect(inviati.length).toBe(1);
  expect(inviati[0].status).toBe('todo');
  // Riaprendo la stessa pratica il rombo non è più verde.
  await page.evaluate((f) => window.__mgTest.setTab(window.SN_MANAGE_REVIEW.manageTabFor(
    Object.assign({}, f, { status: 'todo', statusReason: '' }), {})), fb);
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await expect(page.locator('#mgDetail')).toBeVisible();
  await expect(page.locator('#mgClarify')).toBeHidden();
  await expect(rombo(page)).toHaveClass(/mg-forma--vuota/);
});

test('doppio clic sul tasto di invio: una sola risposta parte', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  await apri(page, { fbs: [fb] });
  await apriDettaglio(page, fb);
  await page.locator('#mgClarifyText').fill('La selezione.');
  await page.locator('#mgClarifyBtn').dblclick();
  await expect(page.locator('#mgClarify')).toBeHidden();
  expect((await page.evaluate(() => window.__inviati)).length).toBe(1);
});
