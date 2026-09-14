// La lettura dei feedback non è più pubblica (#583): ogni lettore legittimo
// passa dalla SUA strada, e nessuna superficie scarica più i documenti interi.
//
// Prima: `feedback` aveva `allow read: if true`. Il testo e l'URL erano cifrati
// per l'owner, ma titolo, user agent, link agli screenshot, numero e data no —
// e i documenti anteriori al 25 giugno 2026 erano in chiaro per intero. La
// bacheca scaricava TUTTO e filtrava in pagina: "filtrato" voleva dire soltanto
// "non disegnato".
//
// Cosa asserisce (successo dal punto di vista dell'utente, non assenza
// d'errore):
//   1. la bacheca mostra i miglioramenti leggendo la VISTA pubblica, e non
//      chiede mai la collezione dei feedback;
//   2. da una pagina di Filo la lettura dei feedback non parte dalla pagina:
//      la chiede al main, che la esegue con le credenziali dell'owner e la
//      NEGA a chi non è admin;
//   3. l'invio di un feedback dall'app continua a funzionare (è il cammino che
//      non deve mai chiedere credenziali).
//
// Senza il fix: (1) è rosso perché la bacheca interroga `feedback`; (2) è rosso
// perché la pagina fa la fetch da sé (nessun messaggio al main).

import { test, expect } from './fixtures/electron.mjs';

const BOARD = 'filo://board/board.html';
const MANAGE = 'filo://manage/manage.html';

// Una scheda pubblica come la manda Firestore (runQuery su feedback-public).
const SCHEDA = {
  document: {
    name: 'projects/p/databases/(default)/documents/feedback-public/fb-1',
    createTime: '2026-06-20T10:00:00Z',
    updateTime: '2026-06-22T10:00:00Z',
    fields: {
      name: { stringValue: 'Migliorata la cattura schermo' },
      seq: { integerValue: '42' },
      subSeq: { integerValue: '0' },
      status: { stringValue: 'done' },
      statusPublic: { stringValue: 'closed' },
      resolvedInVersion: { stringValue: '0.2.70' },
      createdAt: { stringValue: '2026-06-20T10:00:00Z' },
      resolvedAt: { stringValue: '2026-06-22T10:00:00Z' },
      clientIdHash: { stringValue: 'a'.repeat(32) },
      userNote: { stringValue: 'Ora prende anche la barra.' },
    },
  },
};

// Sostituisce fetch nella pagina registrando ogni URL: quello che conta non è
// solo cosa si vede, ma COSA SI CHIEDE al server.
async function spiaFetch(page, payload) {
  await page.evaluate((rows) => {
    window.__chieste = [];
    window.fetch = async (url, opts) => {
      // Con runQuery la collezione sta nel CORPO, non nell'indirizzo: guardare
      // solo l'URL non distinguerebbe una vista da una raccolta intera.
      window.__chieste.push({ url: String(url), body: (opts && opts.body) ? String(opts.body) : '' });
      return {
        ok: true,
        status: 200,
        json: async () => rows,
        text: async () => JSON.stringify(rows),
      };
    };
  }, payload);
}

test('la bacheca mostra i miglioramenti leggendo la vista pubblica, mai la collezione dei feedback', async ({ openTab }) => {
  const page = await openTab(BOARD);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__boardTest && window.SN_FEEDBACK);
  await page.locator('#bdLoading').waitFor({ state: 'hidden' });

  await spiaFetch(page, [SCHEDA]);
  await page.evaluate(() => {
    window.__boardTest.setReleasedVersion('0.2.71');
    return window.__boardTest.reload();
  });

  // Il miglioramento si vede: la bacheca funziona con la vista.
  await expect(page.locator('.bd-card')).toHaveCount(1);
  await expect(page.locator('.bd-card-title')).toHaveText('Migliorata la cattura schermo');

  const chieste = await page.evaluate(() => window.__chieste);
  expect(chieste.length).toBeGreaterThan(0);
  // Quello che la bacheca chiede è la VISTA, e solo quella.
  expect(chieste.some((c) => c.body.includes('feedback-public'))).toBe(true);
  for (const c of chieste) {
    expect(c.body).not.toMatch(/"collectionId"\s*:\s*"feedback"/);
    expect(c.url).not.toMatch(/documents\/feedback(\?|\/|$)/);
    expect(c.url).not.toMatch(/documents:batchGet/);
  }
});

test('da una pagina di Filo la lettura passa dal main, che la nega a chi non è admin', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.SN_FEEDBACK && window.filo && window.filo.message);

  const esito = await page.evaluate(async () => {
    const tipi = [];
    const vero = window.filo.message.bind(window.filo);
    window.filo.message = (m) => { tipi.push(m && m.type); return vero(m); };
    let toccataLaRete = false;
    const fetchVero = window.fetch;
    window.fetch = async (...a) => { toccataLaRete = true; return fetchVero(...a); };
    let errore = '';
    let frase = '';
    try { await window.SN_FEEDBACK.list({ pageSize: 10 }); }
    catch (e) {
      errore = String((e && e.message) || e);
      // Quello che l'utente legge davvero in pagina.
      frase = window.SN_CHAT_ERRORS ? window.SN_CHAT_ERRORS.sentence(e) : errore;
    }
    window.fetch = fetchVero;
    window.filo.message = vero;
    return { tipi, toccataLaRete, errore, frase };
  });

  // La pagina ha CHIESTO al main, invece di andarsi a prendere i documenti.
  expect(esito.tipi).toContain('feedback_fetch');
  expect(esito.toccataLaRete).toBe(false);
  // E il main, senza un admin dietro, non legge niente per conto di nessuno.
  expect(esito.errore.toLowerCase()).toContain('amministrator');
  // Chi non può leggere se lo sente dire com'è: non "controlla la
  // connessione", che manderebbe a guardare la cosa sbagliata.
  expect(esito.frase.toLowerCase()).toContain('amministrator');
  expect(esito.frase.toLowerCase()).not.toContain('connessione');
});

test('inviare un feedback continua a funzionare senza credenziali', async ({ openTab }) => {
  const page = await openTab(BOARD);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.filo && window.filo.message);

  const r = await page.evaluate(() => window.filo.message({
    type: 'submit_feedback',
    payload: {
      text: 'Prova di invio dopo la chiusura delle letture.',
      url: 'https://esempio.invalid/pagina',
      title: 'Pagina di prova',
      userAgent: 'spec',
      clientId: 'spec-client',
      images: [],
      files: [],
    },
  }));
  // L'invio è anonimo per scelta: prende in carico il feedback (lo mette in
  // coda) senza chiedere nessuna credenziale.
  expect(r.ok).toBe(true);
  expect(r.queued).toBe(true);
});
