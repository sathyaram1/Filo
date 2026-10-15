// Il main finto della Gestione messo PRIMA che la pagina parta: l'avvio vero (init, apertura, giro dal vivo) legge
// questi dati. Risponde ad accesso, feedback e domande; il resto va al main vero. Si cambia a pagina aperta.

export const MANAGE = 'filo://manage/manage.html';

const ORA = Date.parse('2026-10-13T09:00:00Z');

export function fb(over = {}) {
  return Object.assign({
    _id: `fb-${over.seq || 1}`, name: `Pratica ${over.seq || 1}`, text: 'Testo.', seq: 1, subSeq: 0,
    status: 'todo', statusPublic: 'open', clientId: 'utente-x', createdAt: '2026-10-10T08:00:00Z', images: [],
  }, over);
}

export const PRATICHE = [
  fb({ seq: 803, status: 'unlabeled' }),
  fb({ seq: 805, status: 'design', statusReason: 'clarify' }),
  fb({ _id: 'fb-813', seq: 813, status: 'todo', name: 'La pratica delle domande' }),
];

export const RIFERIMENTI = { 'fb-813': { num: '#813', priorita: 1 } };

export function domanda(numero, over = {}) {
  return Object.assign({
    id: `D-${numero}`, numero, titolo: `Domanda ${numero}`, priorita: 'importante', stato: 'aperta', fiducia: 'fidato',
    contesto: 'Contesto.', problema: 'Problema.',
    opzioni: [{ testo: 'Riprendi', pro: 'Va avanti.', contro: 'Costa un giro.', azione: { tipo: 'riprendi', feedbackId: 'fb-813' } }],
    consiglio: { opzione: 0, perche: 'È quasi finito.' }, notePerAgenti: '', gruppo: '', collegamenti: [],
    conversazione: [], creataIl: ORA - numero * 60000, modificataIl: ORA - numero * 60000,
  }, over);
}

// cfg: { feedbacks, domande, riferimenti, trattieni, guasti }. Con `trattieni` le letture delle domande aspettano
// `rilasciaDomande`; `guasti` è quante letture dell'elenco, dalla prossima, falliscono. Una risposta passa in lavorazione.
export async function mainFinto(app, cfg) {
  await app.evaluate(({ ipcMain }, c) => {
    globalThis.__mgFinto = c;
    globalThis.__mgFintoAttese = globalThis.__mgFintoAttese || [];
    if (globalThis.__mgFintoOrig) return;
    const orig = ipcMain._invokeHandlers.get('filo:message');
    globalThis.__mgFintoOrig = orig;
    ipcMain.removeHandler('filo:message');
    ipcMain.handle('filo:message', async (event, msg) => {
      const s = globalThis.__mgFinto;
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'feedback_fetch') {
        const rows = JSON.parse(JSON.stringify(s.feedbacks || []));
        if (msg.op === 'getMany') return { ok: true, rows: rows.filter((r) => (msg.ids || []).includes(r._id)) };
        return { ok: true, rows, complete: true, readTime: new Date().toISOString() };
      }
      if (t === 'feedback_decrypt_fields') return { ok: true, list: msg.list };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 7 * 864e5 };
      if (t === 'domande_elenco') {
        if (s.trattieni) await new Promise((r) => globalThis.__mgFintoAttese.push(r));
        if (s.guasti > 0) { s.guasti--; return { ok: false, error: 'deadline-exceeded' }; }
        return { ok: true, domande: JSON.parse(JSON.stringify(s.domande || [])), riferimenti: s.riferimenti || {}, adesso: Date.now(), altre: false };
      }
      if (t === 'domanda_rispondi') {
        const d = (s.domande || []).find((x) => x.id === msg.id);
        if (!d) return { ok: false, error: 'domanda sconosciuta' };
        Object.assign(d, { stato: 'in_lavorazione', modificataIl: Date.now() });
        return { ok: true, domanda: JSON.parse(JSON.stringify(d)) };
      }
      return orig(event, msg);
    });
  }, cfg);
}

export async function rilasciaDomande(app) {
  await app.evaluate(() => {
    globalThis.__mgFinto.trattieni = false;
    for (const r of globalThis.__mgFintoAttese.splice(0)) r();
  });
}

export async function aspettaAvvio(page) {
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
}
