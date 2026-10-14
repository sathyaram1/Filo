// Main finto della verifica, messo PRIMA dell'apertura di Gestione: l'avvio vero (init) legge questi dati.
// Risponde solo ai messaggi di feedback, domande e accesso; il resto va al main vero.

export const URL_GESTIONE = 'filo://manage/manage.html';

export function fb(id, status, extra) {
  const n = Number(String(id).replace(/\D/g, '')) || 1;
  return {
    _id: id, text: `Feedback ${id}`, name: `Feedback ${id}`, seq: n, subSeq: 0,
    clientId: 'tester@example.com', createdAt: '2026-10-10T10:00:00Z', images: [], status,
    _updateTime: '2026-10-10T10:00:00.000000Z', ...(extra || {}),
  };
}
export const livello = {
  l1: (id) => fb(id, 'suspicious_file'),
  l2: (id) => fb(id, 'aligned'),
  l3: (id) => fb(id, 'design', { statusReason: 'clarify' }),
  l4: (id) => fb(id, 'design', { statusReason: 'secaudit' }),
  l5: (id) => fb(id, 'design', { statusReason: 'l5' }),
};

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
    globalThis.__finto = Object.assign({
      admin: true, feedback: [], domande: [], riferimenti: { fbA: { num: '#901', priorita: 2 } },
      ritardo: {}, guasti: {}, log: [], giroRighe: null, clip: null,
    }, init);
    const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
    const copia = (x) => JSON.parse(JSON.stringify(x));
    const trova = (id) => globalThis.__finto.domande.find((d) => d.id === id);
    const nostri = new Set(['auth_status', 'feedback_fetch', 'feedback_decrypt_fields', 'feedback_live_subscribe',
      'domande_elenco', 'domanda_mostra', 'domanda_rispondi', 'domande_consiglio', 'domanda_archivia', 'domanda_riapri', 'feedback_update']);
    H.set('filo:message', async (event, msg) => {
      const F = globalThis.__finto;
      const t = msg && msg.type;
      if (!nostri.has(t)) return orig(event, msg);
      F.log.push({ t, at: Date.now(), msg: copia(msg && msg.list ? { type: t } : msg) });
      if (F.ritardo[t]) await pausa(F.ritardo[t]);
      const g = F.guasti[t];
      if (g && g.n > 0) { g.n -= 1; return { ok: false, error: g.error || 'la rete non risponde' }; }
      const ora = Date.now();
      switch (t) {
        case 'auth_status': return { ok: true, signedIn: F.admin, isAdmin: F.admin, profile: null, remembered: false, googleNelleSchede: false, uid: F.admin ? 'owner' : null };
        case 'feedback_fetch':
          if (msg.op === 'listAll') return { ok: true, rows: copia(F.feedback), complete: true, readTime: new Date(ora).toISOString() };
          if (msg.op === 'getMany') return { ok: true, rows: copia(F.feedback.filter((f) => (msg.ids || []).includes(f._id))) };
          return { ok: true, rows: [] };
        case 'feedback_decrypt_fields': return { ok: true, list: msg.list };
        case 'feedback_live_subscribe':
          if (msg.giro) {
            const righe = F.giroRighe; F.giroRighe = null;
            return { ok: true, giro: righe ? { kind: 'changed', rows: copia(righe) } : { kind: 'none' } };
          }
          return { ok: true };
        case 'feedback_update': {
          const f = F.feedback.find((x) => x._id === msg.id);
          if (f) Object.assign(f, msg.status ? { status: msg.status } : {}, { _updateTime: new Date(ora).toISOString() });
          return { ok: true };
        }
        case 'domande_elenco': {
          if (!F.admin) return { ok: false, error: 'solo owner', code: 'not_admin' };
          let ds = F.domande;
          if (Number(msg.dopo) > 0) ds = ds.filter((d) => Number(d.modificataIl) > Number(msg.dopo));
          else if (!msg.tutte) ds = ds.filter((d) => d.stato === 'aperta' || d.stato === 'in_lavorazione');
          return { ok: true, domande: copia(ds), riferimenti: copia(F.riferimenti), adesso: ora, altre: false };
        }
        case 'domanda_mostra': { const d = trova(msg.id); return d ? { ok: true, domanda: copia(d), riferimenti: copia(F.riferimenti) } : { ok: false, error: 'non c’è' }; }
        case 'domanda_rispondi': {
          const d = trova(msg.id);
          if (!d) return { ok: false, error: 'non c’è' };
          if (F.rifiutaRispondi) return { ok: false, error: F.rifiutaRispondi };
          d.conversazione = (d.conversazione || []).concat({ autore: { tipo: 'owner' }, testo: msg.testo || '', ...(Number.isInteger(msg.scelta) ? { scelta: msg.scelta } : {}), ora });
          const o = Number.isInteger(msg.scelta) ? d.opzioni[msg.scelta] : null;
          if (!o || o.azione.tipo === 'compito') { d.stato = 'in_lavorazione'; d.esito = null; } else { d.stato = 'chiusa'; d.esito = { ok: true, applicataIl: ora }; }
          d.modificataIl = ora;
          return { ok: true, domanda: copia(d), esito: d.esito };
        }
        case 'domande_consiglio': {
          const esiti = [];
          for (const id of msg.ids || []) {
            const d = trova(id);
            if (!d || d.stato !== 'aperta') { esiti.push({ id, ok: false, errore: 'non_aperta', dettaglio: 'non aspetta più' }); continue; }
            const o = d.opzioni[d.consiglio.opzione];
            d.stato = o.azione.tipo === 'compito' ? 'in_lavorazione' : 'chiusa';
            d.esito = { ok: true, applicataIl: ora };
            d.conversazione = (d.conversazione || []).concat({ autore: { tipo: 'owner' }, scelta: d.consiglio.opzione, consiglio: true, ora });
            d.modificataIl = ora;
            esiti.push({ id, ok: true });
          }
          return { ok: true, esiti };
        }
        case 'domanda_archivia': case 'domanda_riapri': {
          const d = trova(msg.id);
          if (!d) return { ok: false, error: 'non c’è' };
          if (t === 'domanda_archivia') { d.stato = 'chiusa'; d.esito = { archiviata: true, applicataIl: ora }; } else { d.stato = 'aperta'; d.esito = null; }
          d.modificataIl = ora;
          return { ok: true, domanda: copia(d) };
        }
        default: return orig(event, msg);
      }
    });
  }, iniziale || {});
}

// Cambia lo stato del server finto: `fn` gira nel main con (F, arg).
export function sulServer(app, fn, arg) {
  return app.evaluate((_, [src, a]) => {
    // eslint-disable-next-line no-new-func
    const f = new Function('F', 'a', `return (${src})(F, a);`);
    return f(globalThis.__finto, a);
  }, [fn.toString(), arg === undefined ? null : arg]);
}

export async function apri(openTab, { attendi = true } = {}) {
  const page = await openTab(URL_GESTIONE);
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  if (attendi) await page.evaluate(() => window.__mgTest.whenReady());
  return page;
}

export const sezione = (page, s) => page.locator(`.mg-sezione[data-sezione="${s}"]`);
export const scheda = (page, t) => page.locator(`.mg-tab[data-tab="${t}"]`);
