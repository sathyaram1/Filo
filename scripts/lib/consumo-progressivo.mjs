// Consumo cumulativo di una sessione, letto solo dalla parte nuova dei transcript (SPEC-DOMANDE.md §8.1).
// Non lancia mai: senza transcript torna consumo null con la nota. I prezzi sono quelli di session-report.mjs.
// Stato in `.claude/routine-consumo.json` (effimero, gitignorato, in SESSION_MARKERS): perso o illeggibile = si rilegge da capo.

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { cartelleTranscript, eSottoAgente, transcriptSottoAgenti, trovaTranscript, valutaUso } from '../session-report.mjs';

const BLOCCO = 1024 * 1024;
// Uno stato per sessione: quelle ferme da più di tre giorni non battono più.
const SESSIONE_VECCHIA_MS = 3 * 24 * 60 * 60 * 1000;

export function statoFile(root) {
  return resolve(root, '.claude', 'routine-consumo.json');
}

function totaliVuoti() {
  return { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, costo: 0, turni: 0 };
}

function fileVuoto() {
  return { offset: 0, ultimoId: '', ultimo: null, totali: totaliVuoti(), modelli: [] };
}

function somma(t, v) {
  t.input += v.input; t.cacheRead += v.cacheRead; t.cacheWrite += v.cacheWrite; t.output += v.output; t.costo += v.costo; t.turni += 1;
}

/** Il transcript principale di una sessione, anche partendo da quello di un suo sotto-agente. PURA. */
export function principaleDi(file) {
  if (!eSottoAgente(file)) return file;
  const cartellaSessione = dirname(dirname(file));
  return join(dirname(cartellaSessione), `${basename(cartellaSessione)}.jsonl`);
}

/**
 * Quale sessione contare: FILO_TRANSCRIPT, poi FILO_SESSION_ID (cercato nelle cartelle del progetto); il ripiego
 * del «più recente» solo dove una sessione locale non può prendere quella di un'altra (routine, biglietto in mano).
 * → { file, sessionId, note }
 */
export function sessioneDa({ env = process.env, cwd = process.cwd(), configDir = '', ripiego = false } = {}) {
  const dichiarato = String(env.FILO_TRANSCRIPT || '').trim();
  if (dichiarato) {
    const file = principaleDi(dichiarato);
    return { file, sessionId: basename(file, '.jsonl'), note: '' };
  }
  const sid = String(env.FILO_SESSION_ID || '').trim();
  if (sid) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(sid)) return { file: '', sessionId: '', note: 'FILO_SESSION_ID con caratteri non ammessi' };
    for (const c of cartelleTranscript({ env, cwd, configDir })) {
      const p = join(c, `${sid}.jsonl`);
      if (existsSync(p)) return { file: p, sessionId: sid, note: '' };
    }
    return { file: '', sessionId: sid, note: `nessun transcript della sessione ${sid}` };
  }
  if (!ripiego) return { file: '', sessionId: '', note: 'sessione non indicata (né FILO_TRANSCRIPT né FILO_SESSION_ID)' };
  const t = trovaTranscript({ env: Object.assign({}, env, { FILO_TRANSCRIPT: '' }), cwd, configDir });
  if (!t.file) return { file: '', sessionId: '', note: t.note };
  const file = principaleDi(t.file);
  return { file, sessionId: basename(file, '.jsonl'), note: '' };
}

/**
 * Avanza lo stato di UN file fino all'ultima riga intera. Vale l'ultima usage di ogni `message.id`: il messaggio
 * in corso resta in `ultimo` e si somma ai totali solo quando ne comincia un altro. File accorciato = da capo.
 */
export function avanzaFile(file, prev) {
  let st = prev && typeof prev === 'object' && prev.totali ? prev : fileVuoto();
  let size;
  try { size = statSync(file).size; } catch (_) { return st; }
  if (size < (Number(st.offset) || 0)) st = fileVuoto();
  if (size === st.offset) return st;
  st = JSON.parse(JSON.stringify(st));
  let fd = null;
  try {
    fd = openSync(file, 'r');
    const buf = Buffer.alloc(BLOCCO);
    let resto = Buffer.alloc(0);
    let pos = st.offset;
    while (pos < size) {
      const n = readSync(fd, buf, 0, Math.min(BLOCCO, size - pos), pos);
      if (!n) break;
      pos += n;
      const pezzo = Buffer.concat([resto, buf.subarray(0, n)]);
      const fine = pezzo.lastIndexOf(0x0a);
      if (fine < 0) { resto = pezzo; continue; }
      const righe = pezzo.subarray(0, fine).toString('utf8').split('\n');
      resto = pezzo.subarray(fine + 1);
      const inizioRighe = pos - pezzo.length;
      let scarto = 0;
      for (const riga of righe) {
        const at = inizioRighe + scarto;
        scarto += Buffer.byteLength(riga, 'utf8') + 1;
        leggiRiga(riga, at, st);
      }
      st.offset = pos - resto.length;
    }
  } catch (_) {
    // Lettura interrotta: lo stato resta all'ultima riga intera letta, e il prossimo battito riprende da lì.
  } finally {
    if (fd !== null) { try { closeSync(fd); } catch (_) { /* già chiuso */ } }
  }
  return st;
}

function leggiRiga(riga, at, st) {
  if (!riga.includes('"assistant"')) return;
  let e;
  try { e = JSON.parse(riga); } catch (_) { return; }
  if (!e || e.type !== 'assistant' || !e.message || typeof e.message !== 'object') return;
  const msg = e.message;
  const model = String(msg.model || '');
  if (/^<[^>]*>$/.test(model)) return;
  const u = msg.usage && typeof msg.usage === 'object' ? msg.usage : null;
  if (!u) return;
  const id = typeof msg.id === 'string' && msg.id ? msg.id : `riga@${at}`;
  const v = valutaUso(u, model);
  if (id !== st.ultimoId && st.ultimo) somma(st.totali, st.ultimo);
  st.ultimoId = id;
  st.ultimo = { input: v.input, cacheRead: v.cacheRead, cacheWrite: v.cacheWrite, output: v.output, costo: v.costo };
  if (model && !st.modelli.includes(model)) st.modelli.push(model);
}

/** I totali di un file, messaggio in corso compreso. PURA. */
export function totaliDi(st) {
  const t = Object.assign({}, st.totali);
  if (st.ultimo) somma(t, st.ultimo);
  return t;
}

function leggiStato(file) {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'));
    return v && typeof v === 'object' && v.sessioni && typeof v.sessioni === 'object' ? v : { v: 1, sessioni: {} };
  } catch (_) {
    return { v: 1, sessioni: {} };
  }
}

function scriviStato(file, stato) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(stato), 'utf8');
    renameSync(tmp, file);
  } catch (_) {
    // Senza stato il prossimo battito rilegge da capo: più lento, mai sbagliato.
  }
}

/**
 * Il consumo cumulativo della sessione (transcript principale + sotto-agenti), nella forma del battito:
 * { consumo:{ sessionId, tokens, costUsd, turni, modelli } | null, note }.
 */
export function consumoSessione({ root, env = process.env, cwd = process.cwd(), configDir = '', ripiego = false, nowMs = Date.now() } = {}) {
  try {
    const s = sessioneDa({ env, cwd, configDir, ripiego });
    if (!s.file || !existsSync(s.file)) return { consumo: null, note: s.note || `transcript assente: ${s.file}` };
    const percorso = statoFile(root || cwd);
    const stato = leggiStato(percorso);
    for (const [k, v] of Object.entries(stato.sessioni)) {
      if (!(Number(v && v.aggiornatoIl) > nowMs - SESSIONE_VECCHIA_MS)) delete stato.sessioni[k];
    }
    const sess = stato.sessioni[s.sessionId] && typeof stato.sessioni[s.sessionId].file === 'object'
      ? stato.sessioni[s.sessionId] : { file: {} };
    const files = [s.file, ...transcriptSottoAgenti(s.file)];
    const tot = totaliVuoti();
    const modelli = [];
    const nuovi = {};
    for (const f of files) {
      const st = avanzaFile(f, sess.file[f]);
      nuovi[f] = st;
      const t = totaliDi(st);
      for (const k of Object.keys(tot)) tot[k] += t[k];
      for (const m of st.modelli) if (!modelli.includes(m)) modelli.push(m);
    }
    stato.sessioni[s.sessionId] = { file: nuovi, aggiornatoIl: nowMs };
    scriviStato(percorso, stato);
    return {
      consumo: {
        sessionId: s.sessionId,
        tokens: { input: tot.input, cacheRead: tot.cacheRead, cacheWrite: tot.cacheWrite, output: tot.output },
        costUsd: Math.round(tot.costo * 10000) / 10000,
        turni: tot.turni,
        modelli: modelli.slice(0, 20),
      },
      note: '',
    };
  } catch (e) {
    return { consumo: null, note: `consumo non letto: ${String((e && e.message) || e)}` };
  }
}

// Le cartelle `subagents/` si leggono da session-report; readdirSync resta importato per chi estende il lettore.
void readdirSync;
