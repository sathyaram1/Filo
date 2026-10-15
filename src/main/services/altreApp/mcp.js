// Cliente MCP minimo su stdio (JSON-RPC una riga per messaggio, versione 2025-06-18) verso un processo figlio del main.
// Non interpreta gli strumenti: li elenca e li chiama. Ogni guasto (avvio, uscita, tempo, protocollo) diventa un errore con
// `codice`, mai un'eccezione fuori dal giro delle promesse; le righe d'errore del figlio restano nei log, non all'utente.
'use strict';

const { spawn: spawnVero } = require('child_process');

const VERSIONE_PROTOCOLLO = '2025-06-18';
// Una schermata intera in base64 sta sotto i 30 MB anche su uno schermo 5K: oltre, il figlio si ferma col numero.
const TETTO_RIGA = 128 * 1024 * 1024;
const CODA_STDERR = 4096;

class ErroreMcp extends Error {
  constructor(codice, messaggio, dettagli) {
    super(messaggio);
    this.codice = codice;
    if (dettagli) this.dettagli = dettagli;
  }
}

/**
 * Avvia il server e fa la stretta di mano. → { strumenti: Map(nome → inputSchema), chiama, chiudi, suUscita, vivo }
 * `spawn` si inietta nelle prove; il comando arriva intero da chi chiama (nessuna shell in mezzo).
 */
async function avvia({ comando, argomenti = [], env, cwd, spawn = spawnVero, cliente = { name: 'Filo', version: '0' },
  tempoAvvioMs = 30000, tempoChiamataMs = 30000 } = {}) {
  let figlio;
  try {
    figlio = spawn(comando, argomenti, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false });
  } catch (e) {
    throw new ErroreMcp('avvio', `il programma non si avvia (${e.code || e.message})`);
  }
  let prossimo = 1;
  let buffer = '';
  let coda = '';
  let uscito = null;
  const attese = new Map();
  const ascoltatoriUscita = new Set();

  const chiudiTutte = (errore) => {
    for (const [, a] of attese) { clearTimeout(a.timer); a.rifiuta(errore); }
    attese.clear();
  };
  const termina = (errore) => {
    if (uscito) return;
    uscito = errore;
    chiudiTutte(errore);
    for (const f of ascoltatoriUscita) { try { f(errore); } catch (_) {} }
  };
  const scrivi = (oggetto) => {
    if (uscito) return;
    try { figlio.stdin.write(`${JSON.stringify(oggetto)}\n`); } catch (_) {}
  };

  const riga = (testo) => {
    if (!testo.trim()) return;
    let m;
    try { m = JSON.parse(testo); } catch (_) { return; }
    if (!m || typeof m !== 'object' || m.jsonrpc !== '2.0') return;
    if (m.method && m.id !== undefined && m.id !== null) {
      // Domande del server: al ping si risponde, il resto (radici, richieste all'utente) Filo non lo offre.
      if (m.method === 'ping') scrivi({ jsonrpc: '2.0', id: m.id, result: {} });
      else scrivi({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'metodo non offerto da Filo' } });
      return;
    }
    if (m.method) return;
    const a = attese.get(m.id);
    if (!a) return;
    attese.delete(m.id);
    clearTimeout(a.timer);
    if (m.error) a.rifiuta(new ErroreMcp('protocollo', String(m.error.message || 'errore del server'), { code: m.error.code }));
    else a.risolvi(m.result);
  };

  figlio.stdout.setEncoding('utf8');
  // Il ritorno a capo si cerca solo nel pezzo nuovo: una schermata in base64 arriva in centinaia di pezzi.
  figlio.stdout.on('data', (pezzo) => {
    let da = 0;
    let i;
    while ((i = pezzo.indexOf('\n', da)) >= 0) {
      pezzi.push(pezzo.slice(da, i));
      const r = pezzi.join('');
      pezzi = [];
      lunghezza = 0;
      da = i + 1;
      riga(r);
    }
    if (da < pezzo.length) { pezzi.push(pezzo.slice(da)); lunghezza += pezzo.length - da; }
    if (lunghezza > TETTO_RIGA) {
      termina(new ErroreMcp('protocollo', `una risposta supera ${Math.round(TETTO_RIGA / 1048576)} MB`));
      try { figlio.kill(); } catch (_) {}
    }
  });
  figlio.stderr.setEncoding('utf8');
  figlio.stderr.on('data', (pezzo) => { coda = (coda + pezzo).slice(-CODA_STDERR); });
  figlio.stdin.on('error', () => {});
  figlio.on('error', (e) => termina(new ErroreMcp('avvio', `il programma non si avvia (${e.code || e.message})`)));
  figlio.on('exit', (code, signal) => {
    termina(new ErroreMcp('uscito', `il programma si è chiuso (${signal || `codice ${code}`})`, { stderr: coda.trim() }));
  });

  function richiesta(method, params, tempoMs = tempoChiamataMs) {
    if (uscito) return Promise.reject(uscito);
    const id = prossimo++;
    return new Promise((risolvi, rifiuta) => {
      const timer = setTimeout(() => {
        attese.delete(id);
        rifiuta(new ErroreMcp('tempo', `nessuna risposta in ${Math.round(tempoMs / 1000)} s`));
      }, tempoMs);
      attese.set(id, { risolvi, rifiuta, timer });
      scrivi({ jsonrpc: '2.0', id, method, params });
    });
  }

  function chiudi() {
    if (uscito) return;
    try { figlio.stdin.end(); } catch (_) {}
    const t = setTimeout(() => { try { figlio.kill(); } catch (_) {} }, 1500);
    if (t.unref) t.unref();
    termina(new ErroreMcp('chiuso', 'chiuso da Filo'));
  }

  try {
    await richiesta('initialize', {
      protocolVersion: VERSIONE_PROTOCOLLO,
      capabilities: {},
      clientInfo: cliente,
    }, tempoAvvioMs);
    scrivi({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const strumenti = new Map();
    let cursore;
    for (let pagina = 0; pagina < 50; pagina++) {
      const r = await richiesta('tools/list', cursore ? { cursor: cursore } : {}, tempoAvvioMs);
      for (const t of (r && Array.isArray(r.tools) ? r.tools : [])) {
        if (t && typeof t.name === 'string') strumenti.set(t.name, t.inputSchema || {});
      }
      cursore = r && r.nextCursor;
      if (!cursore) break;
    }
    return {
      strumenti,
      chiama: (nome, args, tempoMs) => richiesta('tools/call', { name: nome, arguments: args || {} }, tempoMs),
      chiudi,
      suUscita: (f) => { ascoltatoriUscita.add(f); return () => ascoltatoriUscita.delete(f); },
      vivo: () => !uscito,
      stderr: () => coda.trim(),
    };
  } catch (e) {
    const errore = e instanceof ErroreMcp ? e : new ErroreMcp('protocollo', e.message);
    if (!errore.dettagli && coda.trim()) errore.dettagli = { stderr: coda.trim() };
    try { figlio.kill(); } catch (_) {}
    termina(errore);
    throw errore;
  }
}

module.exports = { avvia, ErroreMcp, VERSIONE_PROTOCOLLO, TETTO_RIGA };
