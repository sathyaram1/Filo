// Verifica locale di Gestione a sezioni: il main finto per domande, feedback e accesso, messo PRIMA che la pagina
// parta, così l'apertura vera (init) legge questi dati. Il resto dei messaggi va al main vero.

export const MANAGE = 'filo://manage/manage.html';

const ORA = Date.parse('2026-10-13T09:00:00Z');

export function fb(over = {}) {
  return Object.assign({
    _id: `fb-${over.seq || 1}`, name: `Pratica ${over.seq || 1}`, text: 'Testo.', seq: 1, subSeq: 0,
    status: 'todo', statusPublic: 'open', clientId: 'utente-x', createdAt: '2026-10-10T08:00:00Z', images: [],
  }, over);
}

// Una pratica per livello dei Ricevuti, più due fuori dai Ricevuti.
export const PRATICHE = [
  fb({ seq: 801, status: 'attack', pipeline: { action: 'block_attack' } }),
  fb({ seq: 802, status: 'suspicious_file' }),
  fb({ seq: 803, status: 'unlabeled' }),
  fb({ seq: 804, status: 'aligned' }),
  fb({ seq: 805, status: 'design', statusReason: 'clarify' }),
  fb({ seq: 806, status: 'design', statusReason: 'secaudit' }),
  fb({ seq: 807, status: 'design', statusReason: 'l5' }),
  fb({ _id: 'fb-813', seq: 813, status: 'todo', name: 'La pratica delle domande' }),
  fb({ _id: 'fb-902', seq: 902, status: 'todo', name: 'Un lavoro locale' }),
];

export const RIFERIMENTI = { 'fb-813': { num: '#813', priorita: 1 }, 'fb-902': { num: '#902', priorita: 2 } };

export function domanda(numero, over = {}) {
  return Object.assign({
    id: `D-${numero}`, numero, titolo: `Domanda ${numero}`, priorita: 'importante', stato: 'aperta', fiducia: 'fidato',
    contesto: 'Il **contesto** della domanda.', problema: 'Cosa succede in pratica.',
    opzioni: [
      { testo: 'Riprendi il lavoro', pro: 'Va avanti.', contro: 'Costa un giro.', azione: { tipo: 'riprendi', feedbackId: 'fb-813' } },
      { testo: 'Archivia', pro: 'Niente costi.', contro: 'Si perde il lavoro.', azione: { tipo: 'archivia', feedbackId: 'fb-813' } },
    ],
    consiglio: { opzione: 0, perche: 'Il lavoro è quasi finito.' },
    notePerAgenti: 'Le note **private** per chi riprende.', gruppo: '', collegamenti: [{ tipo: 'feedback', id: 'fb-813' }],
    origine: { tipo: 'feedback', id: 'fb-813' }, conversazione: [], creataIl: ORA - numero * 60000, modificataIl: ORA - numero * 60000,
  }, over);
}

// cfg: { feedbacks, domande, riferimenti, domandeErr, admin }
export async function mainFinto(app, cfg) {
  await app.evaluate(({ ipcMain }, c) => {
    globalThis.__vstub = c;
    globalThis.__vlog = globalThis.__vlog || [];
    if (globalThis.__vorig) return;
    const orig = ipcMain._invokeHandlers.get('filo:message');
    globalThis.__vorig = orig;
    ipcMain.removeHandler('filo:message');
    ipcMain.handle('filo:message', async (event, msg) => {
      const s = globalThis.__vstub;
      const t = msg && msg.type;
      if (/^(domand|feedback_fetch|auth_status)/.test(t || '')) globalThis.__vlog.push(JSON.parse(JSON.stringify(msg)));
      const admin = s.admin !== false;
      if (t === 'auth_status') return { ok: true, signedIn: admin, isAdmin: admin, profile: null };
      if (t === 'feedback_fetch') {
        if (!admin) return { ok: false, code: 'not_admin', error: 'riservato' };
        const rows = JSON.parse(JSON.stringify(s.feedbacks || []));
        if (msg.op === 'getMany') return { ok: true, rows: rows.filter((r) => (msg.ids || []).includes(r._id)) };
        return { ok: true, rows, complete: true, readTime: new Date().toISOString() };
      }
      if (t === 'feedback_decrypt_fields') return { ok: true, list: msg.list };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 7 * 864e5 };
      const trova = (id) => (s.domande || []).find((d) => d.id === id);
      if (t === 'domande_elenco') {
        if (s.domandeErr) return { ok: false, error: s.domandeErr };
        if (s.domandeLente) await new Promise((r) => setTimeout(r, s.domandeLente));
        return { ok: true, domande: JSON.parse(JSON.stringify(s.domande || [])), riferimenti: s.riferimenti || {}, adesso: Date.now(), altre: false };
      }
      if (t === 'domanda_mostra') return { ok: true, domanda: trova(msg.id) || null, riferimenti: s.riferimenti || {} };
      if (t === 'domanda_rispondi') {
        const d = trova(msg.id);
        if (!d) return { ok: false, error: 'domanda inesistente' };
        d.conversazione = (d.conversazione || []).concat([{ autore: { tipo: 'owner' }, testo: msg.testo || '', scelta: msg.scelta, ora: Date.now() }]);
        d.stato = Number.isInteger(msg.scelta) && !msg.testo ? 'chiusa' : 'in_lavorazione';
        d.esito = { ok: true, applicataIl: Date.now() };
        d.modificataIl = Date.now();
        return { ok: true, domanda: d, esito: d.esito };
      }
      if (t === 'domande_consiglio') {
        const esiti = (msg.ids || []).map((id) => {
          const d = trova(id);
          if (!d) return { id, ok: false, errore: 'inesistente' };
          d.stato = 'chiusa'; d.esito = { ok: true, applicataIl: Date.now() }; d.modificataIl = Date.now();
          d.conversazione = (d.conversazione || []).concat([{ autore: { tipo: 'owner' }, scelta: d.consiglio.opzione, consiglio: true, ora: Date.now() }]);
          return { id, ok: true };
        });
        return { ok: true, esiti };
      }
      if (t === 'domanda_archivia' || t === 'domanda_riapri') {
        const d = trova(msg.id);
        if (!d) return { ok: false, error: 'domanda inesistente' };
        d.stato = t === 'domanda_archivia' ? 'chiusa' : 'aperta';
        d.esito = t === 'domanda_archivia' ? { archiviata: true, applicataIl: Date.now() } : null;
        d.modificataIl = Date.now();
        return { ok: true, domanda: d };
      }
      return orig(event, msg);
    });
  }, cfg);
}

export async function inviati(app, tipo) {
  return app.evaluate((_, t) => (globalThis.__vlog || []).filter((m) => m.type === t), tipo);
}

export async function aspettaAvvio(page) {
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
}

export async function finestra(app, w, h) {
  await app.evaluate(({ BrowserWindow }, s) => { BrowserWindow.getAllWindows().find((x) => x._filoTabs).setSize(s[0], s[1]); }, [w, h]);
}
