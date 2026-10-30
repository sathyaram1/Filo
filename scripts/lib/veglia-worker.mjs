// La veglia di chi guida il giro su un worker spostato in sottofondo: uno fermo su un permesso che in cloud nessuno
// approva non manda mai la notifica di fine, e il giro restava appeso per ore (#1797). Quello che legge del worker va
// solo nel guasto, mai nella stampa per l'orchestratore. Regole: tests/unit/vegliaWorker.test.mjs.

import { closeSync, existsSync, openSync, readFileSync, readdirSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { gitIn, lavoroVivo, timbroFile, comandoLeggibile } from './branch-integrity.mjs';
import { bigliettoFinito, leggiMarcatoreBiglietto } from './routine-ticket.mjs';
import { dirImpostazioniUtente, FILE_REGISTRO, impronta } from './orchestratore-cieco.mjs';

// Un sotto-agente vivo scrive il suo transcript almeno a ogni chiamata, e la più lunga (un comando in primo piano) ne
// dura dieci: il doppio è silenzio vero.
export const SOGLIA_FERMO_MS = 20 * 60 * 1000;
// Sotto i due minuti del tempo di serie di una chiamata: un timeout dimenticato non la uccide a metà rilascio.
export const FETTA_MS = 90 * 1000;
export const PASSO_MS = 10 * 1000;
export const USCITA_FINITO = 0;
export const USCITA_FERMO = 3;
export const USCITA_LAVORA = 5;
const CODA_BYTE = 512 * 1024;
// Chi aspetta un figlio ha una chiamata aperta che non è un permesso: il fermo è nel figlio.
const LANCI = new Set(['Agent', 'Task']);

/**
 * Il giudizio su un worker, da segni già letti. PURA.
 * `tempi`: i momenti in cui ha dato segni di vita; `processi`: quanti ne girano nella sua cartella.
 * @returns {{ stato: 'finito'|'lavora'|'fermo', fermoMs: number }}
 */
export function giudica({ finito = false, processi = 0, tempi = [], adesso = Date.now(), soglia = SOGLIA_FERMO_MS } = {}) {
  if (finito) return { stato: 'finito', fermoMs: 0 };
  const noti = tempi.filter((t) => Number.isFinite(t));
  if (processi > 0 || !noti.length) return { stato: 'lavora', fermoMs: 0 };
  const fermoMs = Math.max(0, adesso - Math.max(...noti));
  return { stato: fermoMs >= soglia ? 'fermo' : 'lavora', fermoMs };
}

/** L'ultimo strumento chiesto e rimasto senza risposta, dalle righe di un transcript. PURA. */
export function strumentoInAttesa(righe) {
  const aperti = new Map();
  for (const r of righe) {
    let o;
    try { o = typeof r === 'string' ? JSON.parse(r) : r; } catch (_) { continue; }
    const c = o && o.message && Array.isArray(o.message.content) ? o.message.content : [];
    for (const x of c) {
      if (o.type === 'assistant' && x && x.type === 'tool_use' && x.id) {
        aperti.set(x.id, { nome: String(x.name || ''), input: x.input || {}, ms: Date.parse(String(o.timestamp || '')) });
      } else if (o.type === 'user' && x && x.type === 'tool_result') {
        aperti.delete(x.tool_use_id);
      }
    }
  }
  const voci = [...aperti.values()].filter((v) => !LANCI.has(v.nome));
  if (!voci.length) return null;
  const v = voci.reduce((a, b) => ((b.ms || 0) >= (a.ms || 0) ? b : a));
  const i = v.input;
  const cosa = typeof i.command === 'string' ? i.command : (i.url || i.file_path || i.pattern || '');
  return { nome: v.nome, comando: String(cosa || ''), ms: v.ms };
}

/** Il programma di un comando di shell, per il gruppo del guasto: dopo cd, export e assegnazioni. PURA. */
export function programmaDi(comando) {
  const pezzi = String(comando || '').split(/&&|\|\||[;|\n]/);
  for (const p of pezzi) {
    const parole = p.trim().split(/\s+/).filter(Boolean);
    while (parole.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(parole[0]) || ['env', 'sudo', 'timeout', 'nohup'].includes(parole[0]) || /^-?\d+[smh]?$/.test(parole[0]))) parole.shift();
    const primo = (parole[0] || '').replace(/^["']|["']$/g, '');
    if (!primo || ['cd', 'export', 'set', 'unset', 'source', '.'].includes(primo)) continue;
    const nome = primo.split('/').pop().toLowerCase().replace(/[^a-z0-9._-]/g, '');
    if (nome) return nome;
  }
  return '';
}

// Il guasto finisce in un argomento e nelle note del feedback: una riga, senza virgolette, apici inversi, dollari.
const pulito = (t) => String(t || '').replace(/\\/g, '/').replace(/["`$]/g, "'");

/** Il guasto da dichiarare per un worker fermo, col gruppo davanti. PURA. */
export function testoGuasto({ fermoMs = 0, attesa = null, tracceViste = true } = {}) {
  const minuti = Math.round(fermoMs / 60000);
  const segni = tracceViste ? 'niente commit, salvataggi o passi nel suo transcript' : 'niente commit, salvataggi o processi; transcript non visibile';
  const coda = 'Rilasciato dalla veglia di chi guida il giro.';
  if (attesa) {
    const nome = attesa.nome === 'Bash' ? (programmaDi(attesa.comando) || 'bash') : (attesa.nome.toLowerCase().replace(/[^a-z0-9._-]/g, '') || 'worker');
    const cosa = attesa.comando ? `${attesa.nome} «${comandoLeggibile(attesa.comando)}»` : attesa.nome;
    return pulito(`guasto: permessi ${nome}: permesso in attesa: il worker non dà segni di vita da ${minuti} minuti (${segni}) e il suo ultimo strumento non ha mai avuto risposta: ${cosa}. In cloud nessuno approva un permesso. ${coda}`);
  }
  return pulito(`guasto: strumento worker: worker fermo da ${minuti} minuti (${segni}), senza uno strumento in attesa: forse un permesso, forse il modello. ${coda}`);
}

/** Le righe degli ultimi 512 KB di un transcript: la prima può essere tagliata, e si salta. Illeggibile: nessuna. */
function codaDi(file) {
  let fd = null;
  try {
    const size = statSync(file).size;
    const da = Math.max(0, size - CODA_BYTE);
    const buf = Buffer.alloc(size - da);
    fd = openSync(file, 'r');
    readSync(fd, buf, 0, buf.length, da);
    return buf.toString('utf8').split('\n').filter((r) => r.trim());
  } catch (_) {
    return [];
  } finally {
    if (fd !== null) { try { closeSync(fd); } catch (_) { /* già chiuso */ } }
  }
}

/** La cartella dei transcript dei sotto-agenti della sessione `sessione`, o ''. */
export function cartellaSottoAgenti({ sessione = '', configDir = '' } = {}) {
  const s = String(sessione || '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return '';
  const progetti = join(configDir || dirImpostazioniUtente(), 'projects');
  let nomi = [];
  try { nomi = readdirSync(progetti); } catch (_) { return ''; }
  for (const n of nomi) {
    const d = join(progetti, n, s, 'subagents');
    if (existsSync(d)) return d;
  }
  return '';
}

/**
 * Le tracce dei sotto-agenti scritte da `dopoMs` in poi: l'ultima scrittura e lo strumento rimasto senza risposta.
 * Con un worker alla volta sono tutte del worker e dei suoi figli. `viste` falso: nessun transcript di questo biglietto.
 */
export function tracceSottoAgenti({ dir = '', dopoMs = -Infinity } = {}) {
  let nomi = [];
  try { nomi = dir ? readdirSync(dir).filter((n) => n.endsWith('.jsonl')) : []; } catch (_) { nomi = []; }
  const file = nomi.map((n) => { const p = join(dir, n); try { return { p, m: statSync(p).mtimeMs }; } catch (_) { return null; } })
    .filter((f) => f && f.m >= dopoMs);
  if (!file.length) return { viste: false, ultimoMs: NaN, attesa: null };
  const ultimoMs = Math.max(...file.map((f) => f.m));
  const attese = file.map((f) => strumentoInAttesa(codaDi(f.p))).filter(Boolean);
  const attesa = attese.length ? attese.reduce((a, b) => ((b.ms || 0) >= (a.ms || 0) ? b : a)) : null;
  return { viste: true, ultimoMs, attesa };
}

/** Quando il server ha dato il biglietto, dal registro che il comando ticket scrive per il gancio. NaN se non c'è. */
export function inizioDalRegistro(ticket, { dir = dirImpostazioniUtente() } = {}) {
  try {
    const voci = JSON.parse(readFileSync(join(dir, FILE_REGISTRO), 'utf8')).voci;
    const mia = impronta(ticket);
    const v = Array.isArray(voci) ? voci.find((x) => x && x.impronta === mia) : null;
    return v ? Date.parse(String(v.ora || '')) : NaN;
  } catch (_) {
    return NaN;
  }
}

function mtime(p) {
  try { return statSync(p).mtimeMs; } catch (_) { return NaN; }
}

/**
 * I segni di vita del worker che tiene `ticket` in `root`. Un processo nella sua cartella lo tiene vivo anche col
 * transcript fermo: chi aspetta un comando in sottofondo (una verifica lunga) non scrive niente finché quello non esce.
 */
export function segniDiVita({ root, ticket, sessione = process.env.CLAUDE_CODE_SESSION_ID, configDir = '', leggiProcessi } = {}) {
  const m = leggiMarcatoreBiglietto(root);
  const mio = !!(m && String(m.ticket || '') === String(ticket || ''));
  const dalRegistro = inizioDalRegistro(ticket, configDir ? { dir: configDir } : {});
  const dalMarcatore = mio ? Date.parse(String(m.since || '')) : NaN;
  const tempi = [dalRegistro, dalMarcatore];
  if (mio) {
    const c = gitIn(root)(['log', '-1', '--format=%ct']);
    tempi.push(c.ok ? Number(c.out) * 1000 : NaN, mtime(timbroFile(root)));
  }
  const partenze = [dalRegistro, dalMarcatore].filter(Number.isFinite);
  const dopoMs = partenze.length ? Math.min(...partenze) - 60 * 1000 : -Infinity;
  const tracce = tracceSottoAgenti({ dir: cartellaSottoAgenti({ sessione, configDir }), dopoMs });
  if (tracce.viste) tempi.push(tracce.ultimoMs);
  const processi = !tracce.viste && mio
    ? lavoroVivo(root, { cosa: ['processi'], ...(leggiProcessi ? { leggiProcessi } : {}) }).segni.length
    : 0;
  return { mio, finito: mio && bigliettoFinito(m), tempi, processi, tracce };
}

export const TESTO_FINITO = 'Worker finito: ha rilasciato il suo biglietto. Riparti dal passo 0 del tuo ruolo.';

/**
 * Veglia per una fetta: torna appena il worker ha finito o risulta fermo (e allora `rilascia(guasto, mio)` dichiara il
 * guasto), altrimenti alla fine della fetta. I testi sono fissi: niente del worker arriva a chi guida il giro.
 * @returns {Promise<{ uscita: number, testo: string, guasto?: string }>}
 */
export async function veglia({
  leggi, rilascia, adesso = () => Date.now(), dorme = (ms) => new Promise((ok) => setTimeout(ok, ms)),
  fetta = FETTA_MS, passo = PASSO_MS, soglia = SOGLIA_FERMO_MS,
} = {}) {
  const fine = adesso() + fetta;
  for (;;) {
    const s = leggi();
    const g = giudica({ ...s, adesso: adesso(), soglia });
    if (g.stato === 'finito') return { uscita: USCITA_FINITO, testo: TESTO_FINITO };
    const minuti = Math.round(g.fermoMs / 60000);
    if (g.stato === 'fermo') {
      const guasto = testoGuasto({ fermoMs: g.fermoMs, attesa: s.tracce && s.tracce.attesa, tracceViste: !!(s.tracce && s.tracce.viste) });
      const r = rilascia(guasto, s.mio);
      const esito = r && r.ok
        ? 'biglietto rilasciato con un guasto dichiarato'
        : `rilascio non riuscito (${(r && r.motivo) || 'motivo ignoto'}): battito spento, il biglietto scade da solo`;
      return {
        uscita: USCITA_FERMO,
        guasto,
        testo: `Worker fermo da ${minuti} minuti senza segni di vita: ${esito}. Chiudi il giro come dopo un guasto: non chiedere biglietti e non lanciare altri worker.`,
      };
    }
    if (adesso() + passo >= fine) {
      return { uscita: USCITA_LAVORA, testo: `Worker al lavoro (ultimo segno di vita ${minuti} minuti fa, fermo dopo ${Math.round(soglia / 60000)}). Rilancia lo stesso comando.` };
    }
    await dorme(passo);
  }
}
