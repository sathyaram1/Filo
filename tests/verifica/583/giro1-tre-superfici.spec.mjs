// Verifica #583, giro 1 — le tre superfici che devono continuare a funzionare
// dopo la chiusura della lettura dei feedback.
//
// Il feedback chiede espressamente: «dashboard di Gestione, bacheca utenti e
// l'invio di un feedback dall'app che continuano a funzionare (spec Playwright
// delle tre superfici)». Qui si guarda quello che l'utente VEDE in pagina, non
// quello che tornano i moduli: una lettura negata può essere corretta nel
// modulo e arrivare in pagina come «controlla la connessione», che manda a
// guardare la cosa sbagliata.

import { test, expect } from './../../fixtures/electron.mjs';

const BOARD = 'filo://board/board.html';
const MANAGE = 'filo://manage/manage.html';
const INBOX = 'filo://feedback/feedback.html';

// Righe come le tornerebbe il main all'owner (già decodificate: è il contratto
// di feedback_fetch).
const RIGHE = [
  {
    _id: 'fb-uno',
    _updateTime: '2026-06-22T10:00:00Z',
    name: 'Il salvataggio perde le schede',
    text: 'Quando chiudo Filo le schede aperte non tornano.',
    url: 'https://esempio.invalid/pagina',
    status: 'new',
    seq: 501, subSeq: 0,
    createdAt: '2026-06-20T10:00:00Z',
    images: [], files: [],
  },
  {
    _id: 'fb-due',
    _updateTime: '2026-06-23T10:00:00Z',
    name: 'Migliorata la cattura schermo',
    text: 'La cattura tagliava la barra.',
    status: 'done',
    resolvedInVersion: '0.2.70',
    seq: 502, subSeq: 0,
    createdAt: '2026-06-21T10:00:00Z',
    images: [], files: [],
  },
];

// Fa rispondere il ponte col main come risponderebbe all'OWNER: è l'unico
// pezzo che uno spec non può avere davvero (non c'è modo di far credere al
// main di avere una sessione admin). Tutto il resto — la richiesta che parte
// dalla pagina, il disegno delle schede — è il codice vero.
async function ponteDaOwner(page, righe) {
  await page.evaluate((rows) => {
    const vero = window.filo.message.bind(window.filo);
    window.__chieste = [];
    window.filo.message = (m) => {
      window.__chieste.push(m && m.type);
      if (m && m.type === 'feedback_fetch') {
        if (m.op === 'getMany') {
          const ids = new Set((m.ids || []).map(String));
          return Promise.resolve({ ok: true, rows: rows.filter((r) => ids.has(r._id)) });
        }
        if (Array.isArray(m.fields) && m.fields.length) {
          return Promise.resolve({ ok: true, rows: rows.map((r) => ({ _id: r._id, _updateTime: r._updateTime })) });
        }
        return Promise.resolve({ ok: true, rows });
      }
      return vero(m);
    };
  }, righe);
}

test('la posta dei feedback: con le credenziali dell\'owner le segnalazioni compaiono in pagina', async ({ openTab }) => {
  const page = await openTab(INBOX);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.SN_FEEDBACK && window.filo && window.filo.message);
  // Il caricamento d'apertura (senza credenziali) finisce prima: da lì in poi
  // "Aggiorna" rifà la lettura vera, che è quella che vogliamo guardare.
  await page.locator('#empty, #list .fb-card').first().waitFor({ timeout: 15_000 });

  await ponteDaOwner(page, RIGHE);
  await page.locator('#refresh').click();

  // SUCCESSO dal punto di vista dell'owner: le segnalazioni sono sullo schermo.
  await expect(page.locator('#list')).toContainText('Il salvataggio perde le schede', { timeout: 15_000 });
  await expect(page.locator('#list')).toContainText('Quando chiudo Filo le schede aperte non tornano.');
  // E la pagina le ha CHIESTE al main invece di andarsele a prendere.
  const chieste = await page.evaluate(() => window.__chieste);
  expect(chieste).toContain('feedback_fetch');
});

test('la posta dei feedback senza credenziali: la pagina dice com\'è, non «controlla la connessione»', async ({ openTab }) => {
  const page = await openTab(INBOX);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.SN_FEEDBACK && window.filo);

  // Quello che si legge davvero nel riquadro, non quello che torna un modulo.
  const riquadro = page.locator('#empty');
  await expect(riquadro).toBeVisible({ timeout: 15_000 });
  const testo = (await riquadro.innerText()).toLowerCase();
  expect(testo).toContain('amministrator');
  expect(testo).not.toContain('connessione');
  // E una via d'uscita: il banner che spiega chi può vederli.
  await expect(page.locator('#adminBanner')).toBeVisible();
});

test('Gestione senza credenziali: il banner spiega chi vede i feedback', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#mgBanner')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#mgBanner')).toContainText(/gestisce|owner/i);
});

test('la bacheca senza nessuna scheda pubblicata: stato vuoto, non un errore', async ({ openTab }) => {
  const page = await openTab(BOARD);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__boardTest);
  await page.locator('#bdLoading').waitFor({ state: 'hidden', timeout: 15_000 });
  await page.evaluate(() => {
    window.__boardTest.setReleasedVersion('0.2.71');
    window.__boardTest.setData([]);
  });
  await expect(page.locator('#bdEmpty')).toBeVisible();
  await expect(page.locator('#bdError')).toBeHidden();
});

test('la bacheca legge la vista anche quando la rete torna schede: nessuna richiesta alla collezione dei feedback', async ({ openTab }) => {
  const page = await openTab(BOARD);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.SN_FEEDBACK);

  const chieste = await page.evaluate(async () => {
    const registro = [];
    const vero = window.fetch;
    window.fetch = async (url, opts) => {
      registro.push({ url: String(url), body: (opts && opts.body) ? String(opts.body) : '' });
      return {
        ok: true, status: 200,
        json: async () => ([]),
        text: async () => '[]',
      };
    };
    try { await window.SN_FEEDBACK.listPublic({ pageSize: 5 }); } catch (_) { /* conta cosa ha chiesto */ }
    window.fetch = vero;
    return registro;
  });

  expect(chieste.length).toBeGreaterThan(0);
  for (const c of chieste) {
    const dove = `${c.url} ${c.body}`;
    expect(dove).toContain('feedback-public');
    // `"collectionId":"feedback"` esatto = la collezione vera. La vista si
    // chiama `feedback-public` e non deve essere scambiata per quella.
    expect(dove).not.toMatch(/"collectionId"\s*:\s*"feedback"/);
  }
});
