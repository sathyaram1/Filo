// La bacheca non rilegge tutte le schede a ogni apertura (#678).
//
// IL CASO. `filo://board/` chiedeva TUTTE le schede pubbliche a ogni
// caricamento, documenti interi: con 550 fix usciti erano 550 letture per
// apertura e per utente, e il numero cresce da solo a ogni fix nuovo. Con cento
// tester diventa il conto più caro dell'app, per una vetrina di cinquanta righe.
//
// COSA ASSERISCE, dal punto di vista di chi apre la bacheca: i miglioramenti
// ci sono, dal più recente, si può scorrere per vedere i più vecchi, il proprio
// voto resta dov'è anche riaprendo la pagina — e il server, per tutto questo,
// non ha mai spedito più di una pagina per volta.
//
// Il doppio della rete si comporta come Firestore: ordina, taglia al limite
// chiesto, riparte dal cursore e risponde alla domanda «cosa è cambiato».
// Conta i documenti spediti: è quello il costo vero.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://board/board.html';
const QUANTE = 300;
const PAGINA = 50;

// Le schede finte, come sono scritte in `feedback-public`. `resolvedInVersion`
// bassissima: il gate "già in produzione" deve passare qualunque sia la
// versione di Filo che gira qui.
function schede(n) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push({
      _id: `scheda-${String(i).padStart(4, '0')}`,
      name: `Fix numero ${i}`,
      seq: i + 1,
      subSeq: 0,
      status: 'done',
      statusPublic: 'closed',
      resolvedInVersion: '0.0.1',
      createdAt: new Date(Date.UTC(2026, 0, 1) + i * 3600_000).toISOString(),
      publishedAt: new Date(Date.UTC(2026, 5, 1) + i * 3600_000).toISOString(),
    });
  }
  return out;
}

// Installato PRIMA che la pagina parta, così conta anche il primo caricamento.
async function reteFinta(page, docs) {
  await page.addInitScript((base) => {
    window.__conta = { query: 0, documenti: 0 };
    const fsDoc = (c) => {
      const fields = {};
      for (const [k, v] of Object.entries(c)) {
        if (k.startsWith('_')) continue;
        fields[k] = typeof v === 'number' ? { integerValue: String(v) } : { stringValue: String(v) };
      }
      return {
        name: `projects/p/databases/(default)/documents/feedback-public/${c._id}`,
        fields,
        createTime: '2026-09-01T10:00:00Z',
        updateTime: '2026-09-01T10:00:00Z',
      };
    };
    const vera = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = String((input && input.url) || input || '');
      if (!url.includes('firestore.googleapis.com')) return vera(input, init);
      let q = null;
      try { q = JSON.parse((init && init.body) || '{}').structuredQuery; } catch (_) {}
      if (!q || q.from?.[0]?.collectionId !== 'feedback-public') {
        return new Response(JSON.stringify({ error: { code: 403 } }), { status: 403 });
      }
      window.__conta.query += 1;
      // Le schede aggiunte a giro iniziato (un fix uscito mentre non
      // guardavamo) si leggono al momento della richiesta, non alla partenza.
      const tutte = base.concat(window.__extraSchede || []);
      const limite = Number(q.limit) || 50;
      let righe;
      if (q.where) {
        // «Cosa è cambiato da quando non guardavo»: per timbro di
        // pubblicazione, crescente.
        const da = String(q.where.fieldFilter.value.stringValue || '');
        righe = tutte.filter((c) => String(c.publishedAt) > da)
          .sort((a, b) => String(a.publishedAt).localeCompare(String(b.publishedAt)));
      } else {
        righe = tutte.slice().sort((a, b) => {
          const d = String(b.createdAt).localeCompare(String(a.createdAt));
          return d || String(b._id).localeCompare(String(a._id));
        });
        const cur = q.startAt && q.startAt.values;
        if (cur && cur.length === 2) {
          const dopoData = String(cur[0].stringValue || '');
          const dopoId = String(cur[1].referenceValue || '').split('/').pop();
          const i = righe.findIndex((c) => c.createdAt === dopoData && c._id === dopoId);
          righe = i >= 0 ? righe.slice(i + 1) : righe;
        }
      }
      righe = righe.slice(0, limite);
      window.__conta.documenti += righe.length;
      return new Response(JSON.stringify(righe.map((c) => ({ document: fsDoc(c) }))), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    };
  }, docs);
}

async function pronta(page) {
  await page.waitForFunction(
    () => window.__boardTest && window.SN_FEEDBACK && window.SN_MANAGE_REVIEW,
    null,
    { timeout: 15_000 },
  );
  await page.locator('#bdLoading').waitFor({ state: 'hidden', timeout: 20_000 });
}

const conta = (page) => page.evaluate(() => window.__conta);

test('la bacheca mostra le prime schede, in ordine, senza scaricarle tutte', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await pronta(page);
  await reteFinta(page, schede(QUANTE));
  await page.reload();
  await pronta(page);

  await expect(page.locator('.bd-card')).toHaveCount(PAGINA);
  // Dal più recente: l'ordine lo fa la query, non la pagina.
  await expect(page.locator('.bd-card-title').first()).toHaveText(`Fix numero ${QUANTE - 1}`);
  await expect(page.locator('.bd-card-title').nth(1)).toHaveText(`Fix numero ${QUANTE - 2}`);

  // Il costo di un'apertura: una pagina, non la bacheca intera.
  const c = await conta(page);
  expect(c.documenti).toBe(PAGINA);
  expect(c.documenti).toBeLessThan(QUANTE);

  // E si vede che ce n'è dell'altro, invece di un vuoto in fondo.
  await expect(page.locator('#bdMore')).toBeVisible();
});

test('scorrendo arrivano le successive, una pagina per volta', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await pronta(page);
  await reteFinta(page, schede(QUANTE));
  await page.reload();
  await pronta(page);
  await expect(page.locator('.bd-card')).toHaveCount(PAGINA);

  await page.evaluate(() => document.getElementById('bdMore')?.scrollIntoView());
  await expect(page.locator('.bd-card')).toHaveCount(PAGINA * 2);
  // Nessuna ripetizione e nessun salto al confine fra le due pagine.
  await expect(page.locator('.bd-card-title').nth(PAGINA - 1)).toHaveText(`Fix numero ${QUANTE - PAGINA}`);
  await expect(page.locator('.bd-card-title').nth(PAGINA)).toHaveText(`Fix numero ${QUANTE - PAGINA - 1}`);

  const c = await conta(page);
  expect(c.documenti).toBe(PAGINA * 2);
});

test('riaprendo, la bacheca compare subito e non si rilegge niente', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await pronta(page);
  await reteFinta(page, schede(QUANTE));
  await page.reload();
  await pronta(page);
  await expect(page.locator('.bd-card')).toHaveCount(PAGINA);

  // Seconda apertura: la copia su disco disegna la pagina, e al server si
  // chiede solo «cosa è cambiato» — niente, quindi nessun documento.
  await page.reload();
  await pronta(page);
  await expect(page.locator('.bd-card')).toHaveCount(PAGINA);
  await expect(page.locator('.bd-card-title').first()).toHaveText(`Fix numero ${QUANTE - 1}`);

  const c = await conta(page);
  expect(c.documenti).toBe(0);
  expect(c.query).toBe(1); // una domanda sola: «cosa è cambiato?»
});

test('un fix uscito dopo l\'ultima visita compare senza rileggere la bacheca', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await pronta(page);
  await reteFinta(page, schede(QUANTE));
  await page.reload();
  await pronta(page);
  await expect(page.locator('.bd-card')).toHaveCount(PAGINA);

  // Una scheda nuova, pubblicata mentre non guardavamo.
  await page.addInitScript(() => {
    window.__extraSchede = [{
      _id: 'scheda-nuovissima',
      name: 'Fix appena uscito',
      seq: 9001,
      subSeq: 0,
      status: 'done',
      statusPublic: 'closed',
      resolvedInVersion: '0.0.1',
      createdAt: '2027-01-01T00:00:00.000Z',
      publishedAt: '2027-01-01T00:00:00.000Z',
    }];
  });

  await page.reload();
  await pronta(page);
  await expect(page.locator('.bd-card-title').first()).toHaveText('Fix appena uscito');
  const c = await conta(page);
  expect(c.documenti).toBe(1); // una lettura: la sola scheda cambiata
});

test('il proprio voto si vede subito e resta anche riaprendo la pagina', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await pronta(page);
  await reteFinta(page, schede(20));
  await page.reload();
  await pronta(page);

  // Il canale col main risponde come a un utente loggato che vota: qui si
  // prova la BACHECA, il contratto IPC vero sta in board-vote.spec.mjs.
  await page.evaluate(() => {
    const vero = window.filo.message.bind(window.filo);
    window.filo.message = async (m) => {
      if (m && m.type === 'board_cast_vote') {
        return { ok: true, uid: 'tester', votes: { tester: { vote: m.vote, at: '2026-09-20T00:00:00Z' } } };
      }
      return vero(m);
    };
  });
  await page.evaluate(() => window.__boardTest.setSignedIn('tester'));

  const prima = page.locator('.bd-card').first();
  await prima.locator('.bd-vote-works').click();
  await expect(prima.locator('.bd-vote-works')).toHaveAttribute('aria-pressed', 'true');
  await expect(prima.locator('.bd-vote-works .bd-vote-count')).toHaveText('1');

  // Riaperta la pagina, il voto è ancora lì: la copia su disco segue il gesto.
  await page.reload();
  await pronta(page);
  await page.evaluate(() => window.__boardTest.setSignedIn('tester'));
  const dopo = page.locator('.bd-card').first();
  await expect(dopo.locator('.bd-vote-works')).toHaveAttribute('aria-pressed', 'true');
  await expect(dopo.locator('.bd-vote-works .bd-vote-count')).toHaveText('1');
});
