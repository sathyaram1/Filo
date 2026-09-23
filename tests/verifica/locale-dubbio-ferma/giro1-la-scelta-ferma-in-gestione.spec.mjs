// Verifica locale, giro 1 (ramo claude/dubbio-ferma): un feedback fermo su una
// scelta dell'owner sta nei Ricevuti, si legge nel rombo, e da lì l'owner lo
// fa ripartire — rispondendo, o rimettendolo in coda senza scrivere.

import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const GIUDICI = ['g1', 'g2', 'g3', 'g4'];
const SHOTS = 'tests/.shots/verifica-locale-dubbio-ferma';

const SEGNALAZIONE = '## Problema\nIl nome del file salvato: dal sito o chiesto ogni volta?\n\n## Scelte\n- **A.** Dal sito: zero attrito, nomi a volte brutti.\n- **B.** Chiesto: un passaggio in più.\n\n## Cosa ho fatto nel frattempo\nA.';
// La conversazione come la lascia il server quando si ferma: il report di chi
// ha lavorato, e sotto la segnalazione appesa come blocco.
const NOTE_DAL_SERVER = `Ho implementato il salvataggio col nome preso dal sito.\n\nSegnalazione per l'owner (chi verifica):\n${SEGNALAZIONE}`;

function pratica(over = {}) {
  return Object.assign({
    _id: 'fb-ferma-1', seq: 910, subSeq: 0, text: 'Il download non tiene il nome del file.', name: 'Prova',
    clientId: 'tester@example.com', createdAt: '2026-09-20T10:00:00Z', images: [],
    status: 'design', statusReason: 'decisione', statusPublic: 'open', branch: 'claude/nome-file',
    reviewDecision: 'accepted', notes: '',
    pipeline: {
      l1Category: 'clean', l1Reasons: [], action: 'human_review', expectedJudges: GIUDICI.slice(),
      verdicts: GIUDICI.map((g) => ({ judge: g, class: 'aligned', reasoning: `Ragionamento di ${g}.`, model: `modello/${g}` })),
    },
    livelli: { l3: { esito: 'segnalato', ruolo: 'verifier', at: '2026-09-22T09:15:00.000Z', testo: SEGNALAZIONE } },
  }, over);
}

// Apre Gestione da admin con i dati finti e intercetta ogni scrittura verso il
// main: i messaggi `feedback_update` finiscono in window.__inviati.
async function apri(page, fbs) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo && window.SN_MANAGE_REVIEW);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    window.__inviati = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      if (t === 'feedback_update') { window.__inviati.push(msg); return { ok: true }; }
      return orig(msg);
    };
  });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((f) => window.__mgTest.setData(f), fbs);
}

test('fermo su una scelta: sta nei Ricevuti, il rombo spiega, la risposta lo rimette in coda con la risposta davanti', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ notes: NOTE_DAL_SERVER });
  // Accanto: una pratica qualunque appena arrivata, per confrontare a occhio.
  const altra = pratica({ _id: 'fb-altra', seq: 909, status: 'unlabeled', statusReason: '', reviewDecision: '', branch: '', livelli: undefined, text: 'Un altro feedback in attesa dei giudici.' });
  await apri(page, [fb, altra]);

  // 1) La scheda giusta è Ricevuti, non In coda.
  const tab = await page.evaluate((f) => window.SN_MANAGE_REVIEW.manageTabFor(f, {}), fb);
  expect(tab).toBe('inbox');
  await expect(page.locator('.mg-tab[data-tab="inbox"]')).toHaveText('Ricevuti (2)');
  await expect(page.locator('.mg-tab[data-tab="queue"]')).toHaveText('In coda (0)');
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
  await page.screenshot({ path: `${SHOTS}/lista-ricevuti.png` });

  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await expect(page.locator('#mgDetail')).toBeVisible();

  // 2) Il dettaglio offre la casella di risposta e il rombo è quello di una scelta da fare.
  await expect(page.locator('#mgClarify')).toBeVisible();
  await expect(page.locator('#mgForme .mg-forma[data-livello="l3"]')).toHaveClass(/mg-forma--design/);
  await page.screenshot({ path: `${SHOTS}/dettaglio-fermo.png` });

  // 3) Il rombo mostra la segnalazione con chi l'ha fatta — una volta sola.
  await page.locator('#mgForme .mg-forma[data-livello="l3"]').click();
  const body = page.locator('#mgSideBody');
  await expect(body).toContainText('Il nome del file salvato');
  await expect(body).toContainText('chi ha verificato il fix');
  await page.screenshot({ path: `${SHOTS}/rombo-aperto.png` });
  const testoRombo = await body.innerText();
  const volte = testoRombo.split('Il nome del file salvato').length - 1;
  expect(volte, 'la segnalazione si legge una volta sola nel rombo').toBe(1);

  // 4) La risposta dell'owner: il feedback torna in coda con la risposta nella conversazione.
  await page.locator('#mgClarifyText').fill('Scelgo B: chiedi ogni volta.');
  await page.locator('#mgClarifyBtn').click();
  await expect.poll(() => page.evaluate(() => window.__inviati.length)).toBe(1);
  const inviato = await page.evaluate(() => window.__inviati[0]);
  expect(inviato.id).toBe(fb._id);
  expect(inviato.status).toBe('todo');
  expect(String(inviato.notes)).toContain('Scelgo B: chiedi ogni volta.');
  // È un turno dell'owner, distinguibile da chi riprende il lavoro.
  const turni = await page.evaluate((n) => window.SN_FEEDBACK_THREAD.splitNotes(n), inviato.notes);
  const ultimo = turni[turni.length - 1];
  expect(ultimo.role).toBe('user');
  expect(ultimo.body).toContain('Scelgo B');

  // 5) Esce dai Ricevuti e compare in coda.
  await expect(page.locator('.mg-tab[data-tab="inbox"]')).toHaveText('Ricevuti (1)');
  await expect(page.locator('.mg-tab[data-tab="queue"]')).toHaveText('In coda (1)');
});

test('«→ In coda» senza scrivere niente vale «va bene la strada presa»: parte lo stesso todo, senza toccare la conversazione', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ _id: 'fb-ferma-2', seq: 911, notes: NOTE_DAL_SERVER });
  await apri(page, [fb]);
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await expect(page.locator('#mgDetail')).toBeVisible();

  const allowed = await page.evaluate((f) => window.SN_MANAGE_REVIEW.ownerActionAllowsStatus(f, 'todo', {}), fb);
  expect(allowed).toBe(true);
  const inCoda = page.locator('#mgAcceptBtn');
  await expect(inCoda).toBeVisible();
  await inCoda.click();
  await expect.poll(() => page.evaluate(() => window.__inviati.length)).toBe(1);
  const inviato = await page.evaluate(() => window.__inviati[0]);
  expect(inviato.status).toBe('todo');
  expect(inviato.notes === undefined || inviato.notes === fb.notes).toBe(true);
});

test('la segnalazione di chi risolve si legge con chi l’ha fatta; i chiarimenti senza segnalazione offrono comunque la risposta', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const daResolver = pratica({ _id: 'fb-ferma-3', seq: 912, notes: NOTE_DAL_SERVER.replace('chi verifica', 'chi risolve'), livelli: { l3: { esito: 'segnalato', ruolo: 'resolver', at: '2026-09-22T09:15:00.000Z', testo: SEGNALAZIONE } } });
  const soloDomande = pratica({ _id: 'fb-ferma-4', seq: 913, statusReason: 'clarify', livelli: undefined, notes: 'Quale dei due nomi preferisci?' });
  await apri(page, [daResolver, soloDomande]);
  await expect(page.locator('.mg-tab[data-tab="inbox"]')).toHaveText('Ricevuti (2)');
  await page.evaluate(() => window.__mgTest.setTab('inbox'));

  await page.evaluate((id) => window.__mgTest.openDetail(id), daResolver._id);
  await page.locator('#mgForme .mg-forma[data-livello="l3"]').click();
  await expect(page.locator('#mgSideBody')).toContainText('Chi ha segnalato');
  await expect(page.locator('#mgSideBody')).toContainText('Il nome del file salvato');
  await expect(page.locator('#mgClarify')).toBeVisible();

  await page.evaluate((id) => window.__mgTest.openDetail(id), soloDomande._id);
  await expect(page.locator('#mgClarify')).toBeVisible();
  await page.locator('#mgForme .mg-forma[data-livello="l3"]').click();
  await expect(page.locator('#mgSideBody')).toContainText('Quale dei due nomi preferisci?');
});
