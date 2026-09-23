// Verifica locale, giro 2 (ramo claude/dubbio-ferma): la pratica ferma per un
// rilievo che chiede una scelta (senza file di segnalazione), quella ferma a
// bilancio esaurito con una segnalazione allegata, e cosa il rombo fa del
// testo che gli arriva (markup, grassetto).

import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const GIUDICI = ['g1', 'g2', 'g3', 'g4'];
const SHOTS = 'tests/.shots/verifica-locale-dubbio-ferma';

// La nota che il server appende quando la critica ferma per un [2i?]: nessun
// file di segnalazione, la domanda è il rilievo stesso.
const NOTA_STOP = 'Verifica: 2 rilievi.\nProvato il salvataggio.\nIl lavoro si ferma: c\'è un rilievo interno di livello 2 o 3 che non si può correggere da soli (bilancio esaurito, o chiede una tua decisione).\nUn altro rilievo interno resta davanti a chi riprende dopo la tua risposta.\n- [2i?] Il nome del file salvato: dal sito o chiesto ogni volta? Scelta di prodotto.\n- [1i] Il bordo del riquadro è grigio freddo.';
const SEGNALAZIONE = '## Problema\nIl nome del file salvato: dal sito o chiesto ogni volta?\n\n## Scelte\n- **A.** Dal sito: zero attrito.\n- **B.** Chiesto: un passaggio in più.\n\n## Cosa ho fatto nel frattempo\nA. <img src=x onerror="window.__xss=1"> <b>grassetto</b>';

function pratica(over = {}) {
  return Object.assign({
    _id: 'fb-g2-1', seq: 920, subSeq: 0, text: 'Il download non tiene il nome del file.', name: 'Prova',
    clientId: 'tester@example.com', createdAt: '2026-09-20T10:00:00Z', images: [],
    status: 'design', statusReason: 'decisione', statusPublic: 'open', branch: 'claude/nome-file',
    reviewDecision: 'accepted', notes: NOTA_STOP,
    pipeline: {
      l1Category: 'clean', l1Reasons: [], action: 'human_review', expectedJudges: GIUDICI.slice(),
      verdicts: GIUDICI.map((g) => ({ judge: g, class: 'aligned', reasoning: `Ragionamento di ${g}.`, model: `modello/${g}` })),
    },
  }, over);
}

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
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
}

test('fermo per un rilievo che chiede una scelta, senza file di segnalazione: la domanda si legge nel rombo e la risposta rimette in coda', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  await apri(page, [fb]);
  await expect(page.locator('.mg-tab[data-tab="inbox"]')).toHaveText('Ricevuti (1)');
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await expect(page.locator('#mgDetail')).toBeVisible();
  await expect(page.locator('#mgClarify')).toBeVisible();
  const rombo = page.locator('#mgForme .mg-forma[data-livello="l3"]');
  await expect(rombo).toHaveClass(/mg-forma--design/);
  await rombo.click();
  const body = page.locator('#mgSideBody');
  await expect(body).toContainText('Il nome del file salvato');
  expect((await body.innerText()).split('Il nome del file salvato').length - 1).toBe(1);
  await page.screenshot({ path: `${SHOTS}/giro2-rombo-rilievo-con-segno.png` });

  await page.locator('#mgClarifyText').fill('Chiesto ogni volta.');
  await page.locator('#mgClarifyBtn').click();
  await expect.poll(() => page.evaluate(() => window.__inviati.length)).toBe(1);
  const inviato = await page.evaluate(() => window.__inviati[0]);
  expect(inviato.status).toBe('todo');
  const turni = await page.evaluate((n) => window.SN_FEEDBACK_THREAD.splitNotes(n), inviato.notes);
  expect(turni[turni.length - 1].role).toBe('user');
  expect(turni[turni.length - 1].body).toContain('Chiesto ogni volta.');
});

test('fermo a bilancio esaurito con una segnalazione allegata: la segnalazione è una domanda, e la casella di risposta ci deve essere', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({
    _id: 'fb-g2-2', seq: 921, statusReason: 'loop',
    notes: `Verifica: 1 rilievo.\nIl lavoro si ferma: bilancio esaurito.\n- [2i] Il salvataggio non parte col titolo vuoto.\n\nSegnalazione per l'owner (chi verifica):\n${SEGNALAZIONE}`,
    livelli: { l3: { esito: 'segnalato', ruolo: 'verifier', at: '2026-09-23T09:15:00.000Z', testo: SEGNALAZIONE } },
  });
  await apri(page, [fb]);
  await expect(page.locator('.mg-tab[data-tab="inbox"]')).toHaveText('Ricevuti (1)');
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await expect(page.locator('#mgDetail')).toBeVisible();
  await page.locator('#mgForme .mg-forma[data-livello="l3"]').click();
  await expect(page.locator('#mgSideBody')).toContainText('Il nome del file salvato');
  await page.screenshot({ path: `${SHOTS}/giro2-loop-con-segnalazione.png` });
  // La scelta che gli viene chiesta ha bisogno della casella di risposta, come ogni altra scelta.
  await expect(page.locator('#mgClarify')).toBeVisible();
});

test('il testo della segnalazione non diventa markup nel rombo', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({
    _id: 'fb-g2-3', seq: 922,
    notes: `Ho fatto A.\n\nSegnalazione per l'owner (chi verifica):\n${SEGNALAZIONE}`,
    livelli: { l3: { esito: 'segnalato', ruolo: 'verifier', at: '2026-09-23T09:15:00.000Z', testo: SEGNALAZIONE } },
  });
  await apri(page, [fb]);
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await page.locator('#mgForme .mg-forma[data-livello="l3"]').click();
  const body = page.locator('#mgSideBody');
  await expect(body).toContainText('Cosa ho fatto nel frattempo');
  expect(await body.locator('img').count()).toBe(0);
  expect(await body.locator('b').count()).toBe(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  await expect(body).toContainText('<img src=x');
});

test('il grassetto delle scelte (**A.**, la forma che il modello della segnalazione prescrive) si legge come grassetto, non come asterischi', async ({ openTab }) => {
  test.fail(true, 'esterno: nel rombo il grassetto della segnalazione si vede come asterischi');
  const page = await openTab(MANAGE);
  const fb = pratica({
    _id: 'fb-g2-4', seq: 923,
    notes: `Ho fatto A.\n\nSegnalazione per l'owner (chi verifica):\n${SEGNALAZIONE}`,
    livelli: { l3: { esito: 'segnalato', ruolo: 'verifier', at: '2026-09-23T09:15:00.000Z', testo: SEGNALAZIONE } },
  });
  await apri(page, [fb]);
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await page.locator('#mgForme .mg-forma[data-livello="l3"]').click();
  const body = page.locator('#mgSideBody');
  await expect(body).toContainText('Dal sito: zero attrito');
  await expect(body).not.toContainText('**A.**');
});
