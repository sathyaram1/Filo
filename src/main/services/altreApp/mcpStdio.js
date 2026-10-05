// Cliente MCP su stdio verso un processo figlio: JSON-RPC 2.0, un messaggio per riga, versione 2025-06-18.
// Non decide quali strumenti chiamare né cosa farne: lo fa il driver che lo usa. Niente shell, niente argomenti
// composti da fuori. Regole: tests/unit/mcpStdio.test.mjs.

const { spawn: spawnDiSerie } = require('node:child_process');

const VERSIONE_PROTOCOLLO = '2025-06-18';
const TETTO_STDERR = 8192;

class ErroreMcp extends Error {
  constructor(messaggio, { codice = 'mcp', dettaglio = null } = {}) {
    super(messaggio);
    this.codice = codice;
    this.dettaglio = dettaglio;
  }
}

// `onUscita(info)` arriva una volta sola quando il processo esce o non parte: chi lo usa decide se è un guasto.
function avviaMcp({ eseguibile, argomenti = [], env, cwd, spawn = spawnDiSerie, clientInfo = { name: 'Filo', version: '0' }, attesaAvvioMs = 20000, onUscita = null } = {}) {
  let figlio;
  const inAttesa = new Map();
  let prossimoId = 1;
  let chiuso = false;
  let stderr = '';
  let resto = '';
  let uscita = null;

  function chiudiTutti(errore) {
    for (const [, p] of inAttesa) { clearTimeout(p.timer); p.reject(errore); }
    inAttesa.clear();
  }

  function finito(info) {
    if (uscita) return;
    uscita = { ...info, stderr: stderr.trim() };
    chiuso = true;
    chiudiTutti(new ErroreMcp(info.messaggio || 'Il componente si è chiuso.', { codice: info.codice || 'uscito', dettaglio: uscita }));
    if (typeof onUscita === 'function') { try { onUscita(uscita); } catch (_) {} }
  }

  try {
    figlio = spawn(eseguibile, argomenti, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false });
  } catch (e) {
    finito({ codice: 'non-parte', messaggio: `Il componente non parte: ${e && e.message ? e.message : e}` });
    return { pronto: Promise.reject(new ErroreMcp(uscita.messaggio, { codice: 'non-parte', dettaglio: uscita })), chiama: rifiutaChiuso, chiudi: () => {}, strumenti: () => [], vivo: () => false, uscita: () => uscita };
  }

  figlio.on('error', (e) => finito({ codice: 'non-parte', messaggio: `Il componente non parte: ${e && e.message ? e.message : e}` }));
  figlio.on('exit', (code, signal) => finito({ codice: 'uscito', code, signal, messaggio: `Il componente si è chiuso (${signal || `uscita ${code}`}).` }));
  figlio.stdin.on('error', () => {});
  figlio.stderr.setEncoding('utf8');
  figlio.stderr.on('data', (s) => { stderr = (stderr + s).slice(-TETTO_STDERR); });
  figlio.stdout.setEncoding('utf8');
  figlio.stdout.on('data', (pezzo) => {
    const righe = (resto + pezzo).split('\n');
    resto = righe.pop();
    for (const riga of righe) ricevi(riga);
  });

  function scrivi(obj) {
    if (chiuso) throw new ErroreMcp('Il componente si è chiuso.', { codice: 'uscito', dettaglio: uscita });
    figlio.stdin.write(`${JSON.stringify(obj)}\n`);
  }

  function ricevi(riga) {
    const t = riga.trim();
    if (!t) return;
    let m;
    try { m = JSON.parse(t); } catch (_) { return; }
    if (!m || typeof m !== 'object') return;
    if (m.id != null && (Object.prototype.hasOwnProperty.call(m, 'result') || Object.prototype.hasOwnProperty.call(m, 'error')) && !m.method) {
      const p = inAttesa.get(m.id);
      if (!p) return;
      inAttesa.delete(m.id);
      clearTimeout(p.timer);
      if (m.error) p.reject(new ErroreMcp(String(m.error.message || 'errore del componente'), { codice: 'rpc', dettaglio: m.error }));
      else p.resolve(m.result);
      return;
    }
    // Richieste del server al cliente: si risponde solo a ping, il resto non lo offriamo.
    if (m.method && m.id != null) {
      try {
        if (m.method === 'ping') scrivi({ jsonrpc: '2.0', id: m.id, result: {} });
        else scrivi({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } });
      } catch (_) {}
    }
  }

  function richiesta(method, params, { attesaMs = 30000 } = {}) {
    return new Promise((resolve, reject) => {
      if (chiuso) { reject(new ErroreMcp('Il componente si è chiuso.', { codice: 'uscito', dettaglio: uscita })); return; }
      const id = prossimoId++;
      const timer = setTimeout(() => {
        inAttesa.delete(id);
        reject(new ErroreMcp(`Il componente non ha risposto entro ${Math.round(attesaMs / 1000)} secondi.`, { codice: 'tempo' }));
      }, attesaMs);
      inAttesa.set(id, { resolve, reject, timer });
      try { scrivi({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }); } catch (e) { clearTimeout(timer); inAttesa.delete(id); reject(e); }
    });
  }

  let elencoStrumenti = [];
  const pronto = (async () => {
    const init = await richiesta('initialize', { protocolVersion: VERSIONE_PROTOCOLLO, capabilities: {}, clientInfo }, { attesaMs: attesaAvvioMs });
    scrivi({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const tutti = [];
    let cursore;
    for (let giri = 0; giri < 50; giri++) {
      const r = await richiesta('tools/list', cursore ? { cursor: cursore } : {}, { attesaMs: attesaAvvioMs });
      if (r && Array.isArray(r.tools)) tutti.push(...r.tools);
      cursore = r && r.nextCursor;
      if (!cursore) break;
    }
    elencoStrumenti = tutti.filter((t) => t && typeof t.name === 'string');
    return { server: init && init.serverInfo ? init.serverInfo : null, strumenti: elencoStrumenti };
  })();
  pronto.catch(() => {});

  async function chiama(nome, args = {}, opzioni = {}) {
    await pronto;
    return richiesta('tools/call', { name: nome, arguments: args }, opzioni);
  }

  function chiudi() {
    if (chiuso) return;
    try { figlio.stdin.end(); } catch (_) {}
    const t = setTimeout(() => { try { figlio.kill(); } catch (_) {} }, 3000);
    if (t.unref) t.unref();
  }

  return {
    pronto,
    chiama,
    chiudi,
    strumenti: () => elencoStrumenti,
    vivo: () => !chiuso,
    uscita: () => uscita,
  };
}

function rifiutaChiuso() { return Promise.reject(new ErroreMcp('Il componente non è partito.', { codice: 'non-parte' })); }

module.exports = { avviaMcp, ErroreMcp, VERSIONE_PROTOCOLLO };
