// VERIFICA LOCALE, giro 4 — quello che i giri prima non hanno provato: la
// risposta che NON parte (rete giù, stato cambiato sotto), la scheda che si
// cambia col pannello del rombo aperto, il rombo raggiunto da tastiera, una
// domanda che si porta dentro gli stessi titoli che il pannello usa per
// separare le sue parti, e la stessa pagina guardata da chi non è l'owner.
//
// Il cammino principale (casella e rombo verde insieme) l'hanno già chiuso i
// giri 1-3: qui si prova a spezzare il legame fra le due cose nei momenti in
// cui la pagina si muove.

import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';

function pratica(over = {}) {
  return Object.assign({
    _id: 'fb-g4-001',
    text: 'La ricerca nella pagina non trova le parole con l’accento.',
    name: 'Ricerca e accenti',
    seq: 904,
    subSeq: 0,
    clientId: 'tester@example.com',
    createdAt: '2026-09-21T10:00:00Z',
    images: [],
    status: 'design',
    statusReason: 'clarify',
    statusPublic: 'open',
    _updateTime: 't1',
    notes: 'La parola la scrivevi con l’accento o senza?',
  }, over);
}

async function apri(page, { admin = true, fbs = [], invioOk = true } = {}) {
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
      if (t === 'feedback_update') {
        window.__inviati.push(msg);
        return cfg.invioOk ? { ok: true } : { ok: false, error: 'Nessuna connessione: riprova.' };
      }
      return orig(msg);
    };
  }, { admin, invioOk });
  await page.evaluate((a) => window.__mgTest.setAdmin(a), admin);
  await page.evaluate((list) => window.__mgTest.setData(list), fbs);
}

async function apriDettaglio(page, fb) {
  await page.evaluate((f) => window.__mgTest.setTab(window.SN_MANAGE_REVIEW.manageTabFor(f, {})), fb);
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await expect(page.locator('#mgDetail')).toBeVisible();
}

const rombo = (page) => page.locator('#mgForme .mg-forma[data-livello="l3"]');

test('la risposta che non parte: il testo resta, la casella resta, il rombo resta verde', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  await apri(page, { fbs: [fb], invioOk: false });
  await apriDettaglio(page, fb);
  await expect(page.locator('#mgClarify')).toBeVisible();
  await expect(rombo(page)).toHaveClass(/mg-forma--design/);

  await page.locator('#mgClarifyText').fill('Con l’accento, sempre.');
  await page.locator('#mgClarifyBtn').click();

  // L'owner deve poter riprovare: la domanda è ancora in attesa, quindi
  // casella e rombo verde restano, e quello che aveva scritto non sparisce.
  await expect(page.locator('#mgClarifyMsg')).toContainText('connessione');
  await expect(page.locator('#mgClarify')).toBeVisible();
  await expect(page.locator('#mgClarifyText')).toHaveValue('Con l’accento, sempre.');
  await expect(rombo(page)).toHaveClass(/mg-forma--design/);
  await expect(page.locator('#mgClarifyBtn')).toBeEnabled();

  // E riprovando (rete tornata) la risposta parte davvero.
  await page.evaluate(() => { window.__ok = true; });
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') { window.__inviati.push(msg); return { ok: true }; }
      return orig(msg);
    };
  });
  await page.locator('#mgClarifyBtn').click();
  await expect(page.locator('#mgClarify')).toBeHidden();
  const inviati = await page.evaluate(() => window.__inviati.length);
  expect(inviati).toBe(2);
});

test('cambiando pratica col pannello del rombo aperto, il pannello non resta su quella di prima', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const conDomande = pratica();
  const senzaDomande = pratica({
    _id: 'fb-g4-002', seq: 905, name: 'Senza domande',
    status: 'design', statusReason: 'judges', notes: '',
  });
  await apri(page, { fbs: [conDomande, senzaDomande] });
  await apriDettaglio(page, conDomande);
  await rombo(page).click();
  await expect(page.locator('#mgSideBody')).toContainText('con l’accento o senza?');

  await apriDettaglio(page, senzaDomande);
  await expect(rombo(page)).toHaveClass(/mg-forma--vuota/);
  await expect(page.locator('#mgClarify')).toBeHidden();
  // Il pannello di prima non può restare aperto su una pratica che non ha
  // domande: direbbe che c'è qualcosa a cui rispondere dove non c'è.
  const testoLaterale = await page.evaluate(() => {
    const s = document.getElementById('mgSide');
    return (s && !s.hidden) ? document.getElementById('mgSideBody').innerText : '';
  });
  expect(testoLaterale).not.toContain('con l’accento o senza?');
});

test('il rombo verde si raggiunge da tastiera e si apre con Invio', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  await apri(page, { fbs: [fb] });
  await apriDettaglio(page, fb);
  await rombo(page).focus();
  await expect(rombo(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#mgSide')).toBeVisible();
  await expect(page.locator('#mgSideBody')).toContainText('con l’accento o senza?');
});

test('una domanda che contiene gli stessi titoli del pannello resta distinguibile dalla segnalazione', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({
    notes: '## Segnalazione\nQuesto l’ho scritto io dentro la domanda.\n\nDavvero: la scrivevi con l’accento?',
    livelli: { l3: { esito: 'segnalato', ruolo: 'resolver', at: '2026-09-21T11:00:00.000Z', testo: 'Serve decidere se la ricerca ignora gli accenti sempre.' } },
  });
  await apri(page, { fbs: [fb] });
  await apriDettaglio(page, fb);
  await expect(rombo(page)).toHaveClass(/mg-forma--design/);
  await rombo(page).click();
  const body = page.locator('#mgSideBody');
  // Le due cose ci sono entrambe e la vera segnalazione non sparisce.
  await expect(body).toContainText('Davvero: la scrivevi con l’accento?');
  await expect(body).toContainText('Serve decidere se la ricerca ignora gli accenti sempre.');
});

test('nell’elenco la pratica che aspetta una risposta si riconosce, e dopo la risposta non lo dice più', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  await apri(page, { fbs: [fb] });
  await apriDettaglio(page, fb);
  await expect(page.locator('#mgList')).toContainText('domande per te');

  await page.locator('#mgClarifyText').fill('Senza accento.');
  await page.locator('#mgClarifyBtn').click();
  await expect(page.locator('#mgClarify')).toBeHidden();

  // Risposta data: l'elenco non può continuare a dire che aspetta una
  // risposta, o l'owner torna su una pratica che non gli chiede più niente.
  await expect(page.locator('#mgList')).not.toContainText('domande per te');
});
