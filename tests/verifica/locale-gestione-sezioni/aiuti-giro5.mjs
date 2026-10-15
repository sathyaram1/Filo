// Main finto delle prove del giro 5, messo PRIMA dell'apertura di Gestione: l'avvio vero legge questi dati.
// Risponde ai messaggi di feedback, domande e accesso; il resto va al main vero.

export const URL_GESTIONE = 'filo://manage/manage.html';

export function fb(id, status, extra) {
  const n = Number(String(id).replace(/\D/g, '')) || 1;
  return {
    _id: id, text: `Feedback ${id}`, name: `Feedback ${id}`, seq: n, subSeq: 0,
    clientId: 'tester@example.com', createdAt: '2026-10-10T10:00:00Z', images: [], status,
    _updateTime: '2026-10-10T10:00:00.000000Z', ...(extra || {}),
  };
}

export function domanda(n, extra) {
  const ora = Date.now() - 3600_000 + n * 1000;
  return {
    id: `D-${n}`, numero: n, titolo: `Domanda ${n}`, contesto: `Contesto della domanda ${n}.`,
    problema: `Problema ${n}.`, priorita: 'importante', stato: 'aperta', fiducia: 'fidato',
    opzioni: [
      { testo: `Riprendi ${n}`, pro: 'Veloce.', contro: 'Costa.', azione: { tipo: 'riprendi', feedbackId: 'fbA' } },
      { testo: `Affida ${n}`, pro: 'Sicuro.', contro: 'Lento.', azione: { tipo: 'compito' } },
    ],
    consiglio: { opzione: 0, perche: 'Perché sì.' },
    collegamenti: [{ tipo: 'feedback', id: 'fbA' }], origine: { tipo: 'feedback', id: 'fbA' },
    conversazione: [], notePerAgenti: 'Nota interna.', creataIl: ora, modificataIl: ora, ...(extra || {}),
  };
}

export async function installa(app, iniziale) {
  await app.evaluate(({ ipcMain }, init) => {
    const H = ipcMain._invokeHandlers;
    if (!H || typeof H.get !== 'function') throw new Error('ipcMain._invokeHandlers non c’è più');
    const orig = globalThis.__fintoOrig || H.get('filo:message');
    globalThis.__fintoOrig = orig;
    globalThis.__finto = Object.assign({ admin: true, feedback: [], domande: [], riferimenti: { fbA: { num: '#901', priorita: 2 } }, log: [] }, init);
    const copia = (x) => JSON.parse(JSON.stringify(x));
    const nostri = new Set(['auth_status', 'feedback_fetch', 'feedback_decrypt_fields', 'feedback_live_subscribe', 'domande_elenco', 'domanda_mostra']);
    H.set('filo:message', async (event, msg) => {
      const F = globalThis.__finto;
      const t = msg && msg.type;
      if (!nostri.has(t)) return orig(event, msg);
      F.log.push({ t, at: Date.now() });
      const g = F.guasti && F.guasti[t];
      if (g && g.n > 0) { g.n -= 1; return { ok: false, error: 'la rete non risponde' }; }
      const ora = Date.now();
      switch (t) {
        case 'auth_status': return { ok: true, signedIn: F.admin, isAdmin: F.admin, profile: null, remembered: false, googleNelleSchede: false, uid: F.admin ? 'owner' : null };
        case 'feedback_fetch':
          if (msg.op === 'listAll') return { ok: true, rows: copia(F.feedback), complete: true, readTime: new Date(ora).toISOString() };
          if (msg.op === 'getMany') return { ok: true, rows: copia(F.feedback.filter((f) => (msg.ids || []).includes(f._id))) };
          return { ok: true, rows: [] };
        case 'feedback_decrypt_fields': return { ok: true, list: msg.list };
        case 'feedback_live_subscribe': return msg.giro ? { ok: true, giro: { kind: 'none' } } : { ok: true };
        case 'domande_elenco': {
          let ds = F.domande;
          if (Number(msg.dopo) > 0) ds = ds.filter((d) => Number(d.modificataIl) > Number(msg.dopo));
          else if (!msg.tutte) ds = ds.filter((d) => d.stato === 'aperta' || d.stato === 'in_lavorazione');
          return { ok: true, domande: copia(ds), riferimenti: copia(F.riferimenti), adesso: ora, altre: false };
        }
        case 'domanda_mostra': {
          const d = F.domande.find((x) => x.id === msg.id);
          return d ? { ok: true, domanda: copia(d), riferimenti: copia(F.riferimenti) } : { ok: false, error: 'non c’è' };
        }
        default: return orig(event, msg);
      }
    });
  }, iniziale || {});
}

/** Cambia lo stato del server finto: `fn` gira nel main con (F, arg). */
export function sulServer(app, fn, arg) {
  return app.evaluate((_, [src, a]) => {
    // eslint-disable-next-line no-new-func
    const f = new Function('F', 'a', `return (${src})(F, a);`);
    return f(globalThis.__finto, a);
  }, [fn.toString(), arg === undefined ? null : arg]);
}

export async function apri(openTab) {
  const page = await openTab(URL_GESTIONE);
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  return page;
}

/** Quante letture delle domande ha visto il server finto. */
export const letture = (app) => sulServer(app, (F) => F.log.filter((x) => x.t === 'domande_elenco').length);
