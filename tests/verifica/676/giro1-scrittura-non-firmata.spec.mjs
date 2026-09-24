// Verifica #676 — giro 1. ROSSE FINCHÉ IL RILIEVO È APERTO.
// Il giro al minuto chiede «chi è stato scritto dopo questo istante?» a un
// campo che deve scrivere chi scrive, non Firestore. Queste due prove
// asseriscono il SUCCESSO per l'owner — la dashboard mostra il cambiamento
// entro il giro — nei due casi in cui quel campo non è affidabile: chi scrive
// senza firmarlo (oggi il server delle routine) e chi lo firma con un orologio
// indietro. Diventano verdi quando il giro smette di dipendere da una data
// scritta a mano.

import { test, expect } from '../../fixtures/electron.mjs';

test('un feedback riscritto senza firmare l’ora non arriva col giro al minuto', async ({ app }) => {
  const esito = await app.evaluate(async () => {
    const FB = globalThis.SN_FEEDBACK;
    const LIVE = globalThis.SN_FEEDBACK_LIVE;

    const base = Date.parse('2026-09-01T00:00:00Z');
    const docs = new Map();
    for (let i = 0; i < 5; i += 1) {
      const id = `fb-${i}`;
      const iso = new Date(base + i * 60_000).toISOString();
      docs.set(id, { id, createdAt: iso, updatedAt: iso, updateTime: iso, name: `Titolo ${i}`, status: 'todo' });
    }

    const PREFIX = 'projects/filo-8b9cb/databases/(default)/documents';
    const toFs = (d, soloCreated) => ({
      name: `${PREFIX}/feedback/${d.id}`,
      createTime: d.createdAt,
      updateTime: d.updateTime,
      fields: soloCreated ? { createdAt: { timestampValue: d.createdAt } } : {
        createdAt: { timestampValue: d.createdAt },
        updatedAt: { timestampValue: d.updatedAt },
        name: { stringValue: d.name },
        status: { stringValue: d.status },
      },
    });

    const veroFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      const u = String(url);
      const body = opts && opts.body ? JSON.parse(opts.body) : {};
      let out = [];
      if (u.includes(':batchGet')) {
        const ids = (body.documents || []).map((p) => String(p).split('/').pop());
        out = ids.filter((id) => docs.has(id)).map((id) => ({ found: toFs(docs.get(id)) }));
      } else if (u.includes(':runQuery')) {
        const q = body.structuredQuery || {};
        const coll = (q.from && q.from[0] && q.from[0].collectionId) || '';
        if (coll !== 'feedback') out = [{}];
        else if (q.where) {
          const since = q.where.fieldFilter.value.timestampValue;
          out = Array.from(docs.values())
            .filter((d) => d.updatedAt > since)
            .sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : 1))
            .map((d) => ({ document: toFs(d) }));
        } else {
          const proiezione = ((q.select && q.select.fields) || []).map((f) => f.fieldPath);
          out = Array.from(docs.values())
            .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
            .map((d) => ({ document: toFs(d, proiezione.length === 1 && proiezione[0] === 'createdAt') }));
        }
      } else return veroFetch(url, opts);
      return { ok: true, status: 200, json: async () => out, text: async () => '' };
    };

    const annunci = [];
    let orologio = Date.parse('2026-09-24T12:00:00Z');
    const watcher = LIVE.makeWatcher({
      pageSize: FB.LIST_PAGE_SIZE,
      now: () => orologio,
      broadcast: (m) => annunci.push(m),
      listVersions: async () => FB.listVersions({ pageSize: FB.LIST_PAGE_SIZE }),
      listChangedSince: async ({ since }) => {
        const out = await FB.listChangedSince({ since, pageSize: FB.LIST_PAGE_SIZE });
        return { rows: out.rows, complete: out.complete };
      },
    });

    await watcher.tick({ force: true });               // apertura: riallineamento

    // A) qualcuno che FIRMA l'ora (l'app, gli script): dev'essere visto.
    orologio += 60_000;
    const a = docs.get('fb-1');
    a.status = 'working'; a.name = 'Firmato';
    a.updatedAt = new Date(orologio - 5_000).toISOString();
    a.updateTime = a.updatedAt;
    await watcher.tick({ force: true });
    const conFirma = annunci[annunci.length - 1];

    // B) qualcuno che NON firma l'ora (oggi: il server delle routine, che
    //    scrive stato, claim e battiti): Firestore aggiorna updateTime da sé,
    //    ma il campo su cui il giro fa la domanda resta fermo.
    orologio += 60_000;
    const b = docs.get('fb-2');
    b.status = 'working'; b.name = 'Non firmato';
    b.updateTime = new Date(orologio - 5_000).toISOString();
    await watcher.tick({ force: true });
    const senzaFirma = annunci[annunci.length - 1];

    // C) mezz'ora dopo, il riallineamento: lì si vede.
    orologio += 31 * 60_000;
    await watcher.tick({ force: true });
    const dopoRiallineamento = annunci[annunci.length - 1];

    globalThis.fetch = veroFetch;
    return {
      conFirma: { kind: conFirma.kind, ids: (conFirma.rows || []).map((r) => r._id) },
      senzaFirma: { kind: senzaFirma.kind, ids: (senzaFirma.rows || []).map((r) => r._id) },
      dopoRiallineamento: {
        kind: dopoRiallineamento.kind,
        ids: (dopoRiallineamento.versions || []).map((v) => v._id),
      },
      annunci: annunci.map((m) => m.kind),
    };
  });

  // A) chi firma l'ora si vede subito, nel giro del minuto.
  expect(esito.conFirma.kind).toBe('changed');
  expect(esito.conFirma.ids).toContain('fb-1');

  // B) chi NON firma l'ora non arriva col giro: l'annuncio è ancora quello di
  //    prima (nessun nuovo `changed` con fb-2).
  expect(esito.senzaFirma.ids, 'una scrittura senza firma non arriva col giro').not.toContain('fb-2');

  // C) solo il riallineamento (mezz'ora) lo riporta a galla.
  expect(esito.dopoRiallineamento.kind).toBe('reconcile');
  expect(esito.dopoRiallineamento.ids).toContain('fb-2');
});

test('una segnalazione nuova da una macchina con l’orologio indietro non arriva col giro', async ({ app }) => {
  const esito = await app.evaluate(async () => {
    const FB = globalThis.SN_FEEDBACK;
    const LIVE = globalThis.SN_FEEDBACK_LIVE;
    const PREFIX = 'projects/filo-8b9cb/databases/(default)/documents';
    const docs = new Map();
    const vecchio = new Date(Date.parse('2026-09-01T00:00:00Z')).toISOString();
    docs.set('fb-0', { id: 'fb-0', createdAt: vecchio, updatedAt: vecchio, updateTime: vecchio, name: 'Vecchio' });

    const toFs = (d, soloCreated) => ({
      name: `${PREFIX}/feedback/${d.id}`,
      createTime: d.createdAt,
      updateTime: d.updateTime,
      fields: soloCreated ? { createdAt: { timestampValue: d.createdAt } } : {
        createdAt: { timestampValue: d.createdAt },
        updatedAt: { timestampValue: d.updatedAt },
        name: { stringValue: d.name },
      },
    });
    const veroFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      const u = String(url);
      const body = opts && opts.body ? JSON.parse(opts.body) : {};
      let out = [];
      if (u.includes(':runQuery')) {
        const q = body.structuredQuery || {};
        if (((q.from || [])[0] || {}).collectionId !== 'feedback') out = [{}];
        else if (q.where) {
          const since = q.where.fieldFilter.value.timestampValue;
          out = Array.from(docs.values()).filter((d) => d.updatedAt > since).map((d) => ({ document: toFs(d) }));
        } else {
          const p = ((q.select && q.select.fields) || []).map((f) => f.fieldPath);
          out = Array.from(docs.values()).map((d) => ({ document: toFs(d, p.length === 1 && p[0] === 'createdAt') }));
        }
      } else if (u.includes(':batchGet')) out = [];
      else return veroFetch(url, opts);
      return { ok: true, status: 200, json: async () => out, text: async () => '' };
    };

    const annunci = [];
    let orologio = Date.parse('2026-09-24T12:00:00Z');
    const watcher = LIVE.makeWatcher({
      pageSize: FB.LIST_PAGE_SIZE,
      now: () => orologio,
      broadcast: (m) => annunci.push(m),
      listVersions: async () => FB.listVersions({ pageSize: FB.LIST_PAGE_SIZE }),
      listChangedSince: async ({ since }) => {
        const out = await FB.listChangedSince({ since, pageSize: FB.LIST_PAGE_SIZE });
        return { rows: out.rows, complete: out.complete };
      },
    });
    await watcher.tick({ force: true });

    // La segnalazione arriva ADESSO, ma la firma l'orologio del mittente, che è
    // indietro di dieci minuti: la finestra del giro è di due.
    orologio += 60_000;
    const iso = new Date(orologio - 10 * 60_000).toISOString();
    docs.set('nuovo', { id: 'nuovo', createdAt: iso, updatedAt: iso, updateTime: new Date(orologio).toISOString(), name: 'Appena arrivato' });
    await watcher.tick({ force: true });
    const dopo = annunci[annunci.length - 1];

    globalThis.fetch = veroFetch;
    return { kind: dopo.kind, ids: (dopo.rows || dopo.versions || []).map((r) => r._id) };
  });

  expect(esito.ids, 'la segnalazione nuova non arriva col giro al minuto').not.toContain('nuovo');
});
