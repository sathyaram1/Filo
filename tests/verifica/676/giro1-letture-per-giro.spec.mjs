// Verifica #676 — giro 1. Quanto legge la dashboard tenuta aperta.
// Firestore è sostituito nel main da un finto servizio che CONTA le richieste e
// i documenti restituiti: il resto del cammino (costruzione della domanda,
// paginazione, cursore, giro al minuto) è il codice vero.

import { test, expect } from '../../fixtures/electron.mjs';

const TOTALE = 774; // quanti feedback ha il progetto oggi

// Il finto Firestore, installato nel main. Ritorna il conto per fase.
async function misura(app, piano) {
  return app.evaluate(async ({}, { TOTALE, piano }) => {
    const FB = globalThis.SN_FEEDBACK;
    const LIVE = globalThis.SN_FEEDBACK_LIVE;
    if (!FB || !LIVE) throw new Error('moduli non caricati nel main');

    // La collezione finta: dal più recente al più vecchio per data d'invio.
    const base = Date.parse('2026-09-01T00:00:00Z');
    const docs = new Map();
    for (let i = 0; i < TOTALE; i += 1) {
      const id = `fb-${String(i).padStart(4, '0')}`;
      const iso = new Date(base + (TOTALE - i) * 60_000).toISOString();
      docs.set(id, { id, createdAt: iso, updatedAt: iso, name: `Titolo ${i}` });
    }

    const PREFIX = 'projects/filo-8b9cb/databases/(default)/documents';
    const toFs = (d, soloCreated) => ({
      name: `${PREFIX}/feedback/${d.id}`,
      createTime: d.createdAt,
      updateTime: d.updatedAt,
      fields: soloCreated
        ? { createdAt: { timestampValue: d.createdAt } }
        : {
          createdAt: { timestampValue: d.createdAt },
          updatedAt: { timestampValue: d.updatedAt },
          name: { stringValue: d.name },
          statusPublic: { stringValue: 'open' },
        },
    });

    const conto = { richieste: 0, documenti: 0, domande: [] };
    const veroFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      const u = String(url);
      const body = opts && opts.body ? JSON.parse(opts.body) : {};
      conto.richieste += 1;
      let out;
      if (u.includes(':batchGet')) {
        const ids = (body.documents || []).map((p) => String(p).split('/').pop());
        out = ids.filter((id) => docs.has(id)).map((id) => ({ found: toFs(docs.get(id)) }));
        conto.domande.push({ tipo: 'batchGet', quanti: ids.length });
      } else if (u.includes(':runQuery')) {
        const q = body.structuredQuery || {};
        const coll = (q.from && q.from[0] && q.from[0].collectionId) || '';
        if (coll !== 'feedback') {
          // feedback-public: in questa prova non esiste nessuna scheda.
          out = [{}];
          conto.domande.push({ tipo: 'altraCollezione', coll });
        } else if (q.where) {
          const since = q.where.fieldFilter.value.timestampValue;
          const campo = q.where.fieldFilter.field.fieldPath;
          const op = q.where.fieldFilter.op;
          let righe = Array.from(docs.values())
            .filter((d) => d.updatedAt > since)
            .sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : (a.id < b.id ? -1 : 1)));
          if (q.startAt && q.startAt.values) {
            const at = q.startAt.values[0].timestampValue;
            const nome = String(q.startAt.values[1].referenceValue).split('/').pop();
            righe = righe.filter((d) => d.updatedAt > at || (d.updatedAt === at && d.id > nome));
          }
          const limite = Number(q.limit) || 500;
          const pagina = righe.slice(0, limite);
          conto.domande.push({
            tipo: 'cambiati', campo, op, since, limite,
            ordina: (q.orderBy || []).map((o) => `${o.field.fieldPath}:${o.direction}`).join(','),
            cursore: !!q.startAt, resi: pagina.length,
          });
          out = pagina.map((d) => ({ document: toFs(d) }));
        } else {
          const limite = Number(q.limit) || 500;
          const proiezione = (q.select && q.select.fields || []).map((f) => f.fieldPath);
          const pagina = Array.from(docs.values())
            .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
            .slice(0, limite);
          conto.domande.push({ tipo: 'elenco', limite, proiezione, resi: pagina.length });
          out = pagina.map((d) => ({ document: toFs(d, proiezione.length === 1 && proiezione[0] === 'createdAt') }));
        }
      } else {
        return veroFetch(url, opts);
      }
      // Firestore fattura almeno una lettura anche a mani vuote.
      conto.documenti += Math.max(1, out.filter((r) => r.document || r.found).length);
      return { ok: true, status: 200, json: async () => out, text: async () => '' };
    };

    // Le schede pubbliche dei soli cambiati: è quello che fa il main a ogni
    // giro che porta righe. Contate a parte, per vedere se un giro a vuoto le
    // tocca lo stesso.
    let schedeChieste = 0;

    const broadcasts = [];
    let orologio = Date.parse('2026-09-24T12:00:00Z');
    const watcher = LIVE.makeWatcher({
      pageSize: FB.LIST_PAGE_SIZE,
      now: () => orologio,
      broadcast: (m) => broadcasts.push(m),
      listVersions: async () => FB.listVersions({ pageSize: FB.LIST_PAGE_SIZE, timeoutMs: 20000 }),
      listChangedSince: async ({ since }) => {
        const out = await FB.listChangedSince({ since, pageSize: FB.LIST_PAGE_SIZE, timeoutMs: 20000 });
        if (out.rows.length) {
          schedeChieste += 1;
          await FB.getManyPublic(out.rows.map((r) => r._id), { timeoutMs: 20000 });
        }
        return { rows: out.rows, complete: out.complete };
      },
    });

    const fasi = [];
    const segna = async (etichetta, avanti) => {
      conto.richieste = 0; conto.documenti = 0; conto.domande = [];
      const primaSchede = schedeChieste;
      orologio += avanti;
      const esito = await watcher.tick({ force: true });
      fasi.push({
        etichetta,
        richieste: conto.richieste,
        documenti: conto.documenti,
        schede: schedeChieste - primaSchede,
        domande: conto.domande.slice(),
        esito,
      });
    };

    await segna('apertura', 0);              // primo giro: riallineamento
    await segna('vuoto-1', 60_000);
    await segna('vuoto-2', 60_000);
    await segna('vuoto-3', 60_000);

    if (piano === 'uno-cambiato') {
      const d = docs.get('fb-0003');
      orologio += 60_000;
      d.updatedAt = new Date(orologio - 5_000).toISOString();
      d.name = 'Titolo riscritto';
      await segna('un-cambiato', 0);
    }

    globalThis.fetch = veroFetch;
    return { fasi, broadcasts };
  }, { TOTALE, piano });
}

test('tre giri senza cambiamenti non rileggono la collezione, e il cambiato arriva nello stesso giro', async ({ app, openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());

  const { fasi, broadcasts } = await misura(app, 'uno-cambiato');
  const per = Object.fromEntries(fasi.map((f) => [f.etichetta, f]));
  console.log('letture per giro:', JSON.stringify(fasi.map((f) => ({
    giro: f.etichetta, richieste: f.richieste, documenti: f.documenti, schede: f.schede,
  }))));

  // La domanda del giro è quella chiesta: filtro e ordinamento su updatedAt.
  const domandaVuota = per['vuoto-1'].domande.find((d) => d.tipo === 'cambiati');
  expect(domandaVuota, 'il giro deve chiedere i soli cambiati').toBeTruthy();
  expect(domandaVuota.campo).toBe('updatedAt');
  expect(domandaVuota.op).toBe('GREATER_THAN');
  expect(domandaVuota.ordina).toBe('updatedAt:ASCENDING,__name__:ASCENDING');

  // Tre giri a vuoto: una richiesta e una lettura ciascuno, nessuna scheda.
  for (const g of ['vuoto-1', 'vuoto-2', 'vuoto-3']) {
    expect(per[g].richieste, `${g}: richieste`).toBe(1);
    expect(per[g].documenti, `${g}: letture`).toBe(1);
    expect(per[g].schede, `${g}: schede pubbliche rilette`).toBe(0);
  }

  // Il giro col cambiamento: poche letture, e la riga aggiornata esce davvero.
  expect(per['un-cambiato'].documenti).toBeLessThan(10);
  const annuncio = broadcasts[broadcasts.length - 1];
  expect(annuncio.kind).toBe('changed');
  expect(annuncio.rows.map((r) => r._id)).toContain('fb-0003');
  expect(annuncio.rows.find((r) => r._id === 'fb-0003').name).toBe('Titolo riscritto');

  // Il successo per l'owner: la riga cambiata compare AGGIORNATA in lista.
  await page.evaluate((righe) => {
    window.__mgTest.setData(righe.map((r) => ({
      _id: r._id, _updateTime: 'v1', name: r.name === 'Titolo riscritto' ? 'Titolo vecchio' : r.name,
      text: 'x', seq: 3, subSeq: 0, clientId: 'tester@example.com',
      createdAt: r.createdAt, images: [],
    })));
    window.__mgTest.setTab('inbox');
  }, annuncio.rows);
  await expect(page.locator('.mg-item[data-id="fb-0003"] .mg-item-title')).toHaveText('Titolo vecchio');

  await page.evaluate((rows) => window.__mgTest.liveMessage({
    kind: 'changed',
    rows: rows.map((r) => ({ ...r, _updateTime: 'v2' })),
  }), annuncio.rows);
  await expect(page.locator('.mg-item[data-id="fb-0003"] .mg-item-title')).toHaveText('Titolo riscritto');
});

test('il riallineamento resta raro e non si ripete a ogni giro', async ({ app }) => {
  const { fasi } = await misura(app, 'solo-vuoti');
  const per = Object.fromEntries(fasi.map((f) => [f.etichetta, f]));
  // All'apertura ci si riallinea: costa, ed è la rete di sicurezza.
  expect(per['apertura'].esito.kind).toBe('reconcile');
  // I giri dopo NON devono essere riallineamenti.
  for (const g of ['vuoto-1', 'vuoto-2', 'vuoto-3']) {
    expect(per[g].esito.kind, `${g} non deve riallineare`).toBe('changed');
  }
});
