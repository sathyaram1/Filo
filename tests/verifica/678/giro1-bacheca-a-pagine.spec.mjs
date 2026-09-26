// Verifica #678, giro 1 — la bacheca a pagine dal punto di vista di chi guarda.
//
// Il lavoro consegnato chiede una pagina per volta al server invece di tutte le
// schede. Qui si prova quello che va storto nelle paginazioni: le schede che
// hanno la STESSA data d'invio (il cursore deve distinguerle lo stesso) e una
// prima pagina fatta tutta di fix non ancora usciti in produzione, che la
// bacheca nasconde (la pagina non deve restare vuota né a girare per sempre).
//
// Il doppio della rete imita Firestore: ordina per data d'invio e, a parità,
// per nome del documento; riparte dopo la riga del cursore; taglia al limite.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://board/board.html';
const PAGINA = 50;

// `resolvedInVersion` bassissima = già in produzione qualunque sia la versione
// di Filo che gira qui; altissima = fix non ancora uscito, la bacheca lo salta.
function scheda(i, { stessaData = false, uscito = true } = {}) {
  return {
    _id: `scheda-${String(i).padStart(4, '0')}`,
    name: `Fix numero ${i}`,
    seq: i + 1,
    subSeq: 0,
    status: 'done',
    statusPublic: 'closed',
    resolvedInVersion: uscito ? '0.0.1' : '999.0.0',
    createdAt: stessaData
      ? '2026-03-01T00:00:00.000Z'
      : new Date(Date.UTC(2026, 0, 1) + i * 3600_000).toISOString(),
    publishedAt: new Date(Date.UTC(2026, 5, 1) + i * 3600_000).toISOString(),
  };
}

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
      const limite = Number(q.limit) || 50;
      let righe;
      if (q.where) {
        const da = String(q.where.fieldFilter.value.stringValue || '');
        righe = base.filter((c) => String(c.publishedAt) > da)
          .sort((a, b) => String(a.publishedAt).localeCompare(String(b.publishedAt)));
      } else {
        // Come Firestore: data d'invio decrescente, e a PARI MERITO il nome del
        // documento, anch'esso decrescente. È l'ordine che il client dichiara.
        righe = base.slice().sort((a, b) => {
          const d = String(b.createdAt).localeCompare(String(a.createdAt));
          return d || String(b._id).localeCompare(String(a._id));
        });
        const cur = q.startAt && q.startAt.values;
        if (cur && cur.length === 2) {
          const dopoData = String(cur[0].stringValue || '');
          const dopoId = String(cur[1].referenceValue || '').split('/').pop();
          const i = righe.findIndex((c) => c.createdAt === dopoData && c._id === dopoId);
          // Un cursore che non si ritrova è un buco silenzioso: qui si urla.
          if (i < 0) {
            return new Response(JSON.stringify({ error: { code: 400, message: 'cursore ignoto' } }), { status: 400 });
          }
          righe = righe.slice(i + 1);
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
    () => window.SN_FEEDBACK && window.SN_MANAGE_REVIEW,
    null,
    { timeout: 15_000 },
  );
  await page.locator('#bdLoading').waitFor({ state: 'hidden', timeout: 20_000 });
}

async function apri(openTab, docs) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await pronta(page);
  await reteFinta(page, docs);
  await page.reload();
  await pronta(page);
  return page;
}

const titoli = (page) => page.locator('.bd-card-title').allTextContents();

test('schede con la stessa data d\'invio: scorrendo non se ne perde né se ne ripete nessuna', async ({ openTab }) => {
  const QUANTE = 130;
  const docs = Array.from({ length: QUANTE }, (_, i) => scheda(i, { stessaData: true }));
  const page = await apri(openTab, docs);

  await expect(page.locator('.bd-card')).toHaveCount(PAGINA);

  // Fino in fondo, una pagina per volta.
  for (let giro = 0; giro < 6; giro += 1) {
    const piu = await page.locator('#bdMore').count();
    if (!piu) break;
    const prima = await page.locator('.bd-card').count();
    await page.evaluate(() => document.getElementById('bdMore')?.scrollIntoView());
    await expect.poll(
      async () => (await page.locator('.bd-card').count()) > prima || (await page.locator('#bdMore').count()) === 0,
      { timeout: 15_000 },
    ).toBe(true);
  }

  const visti = await titoli(page);
  expect(new Set(visti).size).toBe(visti.length);   // nessuna ripetuta
  expect(visti.length).toBe(QUANTE);                // nessuna persa
  // L'ordine dichiarato a pari merito: nome del documento decrescente, che qui
  // è il numero del fix dal più alto.
  expect(visti[0]).toBe(`Fix numero ${QUANTE - 1}`);
  expect(visti[visti.length - 1]).toBe('Fix numero 0');
});

test('una prima pagina tutta di fix non ancora usciti non lascia la bacheca vuota', async ({ openTab }) => {
  // I primi cinquanta (i più recenti) non sono ancora in produzione: la bacheca
  // li nasconde. I dieci più vecchi sì. Chi apre deve vedere QUELLI, non un
  // vuoto né una rotella che gira per sempre.
  const docs = [];
  for (let i = 0; i < 60; i += 1) docs.push(scheda(i, { uscito: i < 10 }));
  const page = await apri(openTab, docs);

  await expect(page.locator('.bd-card')).toHaveCount(10, { timeout: 20_000 });
  await expect(page.locator('.bd-card-title').first()).toHaveText('Fix numero 9');
  await expect(page.locator('#bdEmpty')).toBeHidden();
  // Finite le schede, la riga «carico altri» sparisce invece di restare a girare.
  await expect(page.locator('#bdMore')).toHaveCount(0);
});

test('la riga di caricamento si legge in chiaro e in scuro', async ({ openTab }) => {
  const docs = Array.from({ length: 200 }, (_, i) => scheda(i));
  const page = await apri(openTab, docs);
  await expect(page.locator('#bdMore')).toBeVisible();

  for (const tema of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: tema });
    // La riga prende i colori dai token del tema: niente testo invisibile.
    const c = await page.locator('#bdMore').evaluate((el) => {
      const s = getComputedStyle(el);
      const sp = getComputedStyle(el.querySelector('.bd-spinner'));
      return { testo: s.color, bordo: sp.borderTopColor };
    });
    expect(c.testo).not.toBe('rgba(0, 0, 0, 0)');
    expect(c.bordo).not.toBe('rgba(0, 0, 0, 0)');
    // Guardata davvero: la riga sta in fondo, si porta in vista prima dello scatto.
    await page.evaluate(() => document.getElementById('bdMore')?.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: `tests/.shots/678-bacheca-${tema}.png` });
  }
});
