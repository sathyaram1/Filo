// Il biglietto della sessione locale (SPEC-DOMANDE.md §1.2, contratto #1148 §1.3): il file, chi lo trova, le op della
// callable `localTicket`. Il file è un SEGRETO (.gitignore e SESSION_MARKERS): l'hook di salvataggio fa `git add -A`.
// Le regole della fiducia le tiene il server; qui niente decide, e un guasto vale «nessun biglietto» (non fidato).

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

export const CARTELLA = join('.claude', 'biglietti');
export const ENV_FILE = 'FILO_BIGLIETTO_FILE';
const BASE = process.env.FILO_FUNCTIONS_BASE || 'https://europe-west1-filo-8b9cb.cloudfunctions.net';
export const LOCAL_TICKET_URL = `${BASE}/localTicket`;
// Un hook di avvio non deve tenere ferma la sessione: oltre, si va avanti senza biglietto.
export const TEMPO_MASSIMO_MS = 8000;
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const FP_RE = /^[0-9a-f]{64}$/;

/** La radice del repo della cartella `cwd`, '' fuori da un repo. */
export function radiceRepo(cwd = process.cwd()) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (_) {
    return '';
  }
}

export function cartellaBiglietti(radice) {
  return resolve(radice, CARTELLA);
}

/** Il nome del file: il session_id quando c'è, altrimenti `manuale-<ms>`. PURA. */
export function idDelFile(sessionId, nowMs = Date.now()) {
  const s = String(sessionId || '').trim();
  return ID_RE.test(s) ? s : `manuale-${Math.round(Number(nowMs) || Date.now())}`;
}

/** { ticket, fp, natoIl, path } o null se il file non c'è o non ha la forma giusta. */
export function leggiFile(path) {
  try {
    const d = JSON.parse(readFileSync(path, 'utf8'));
    if (!d || typeof d.ticket !== 'string' || d.ticket.length < 32 || !FP_RE.test(String(d.fp || ''))) return null;
    return { ticket: d.ticket, fp: d.fp, natoIl: Number(d.natoIl) || 0, path };
  } catch (_) {
    return null;
  }
}

export function scriviFile(path, { ticket, fp, natoIl }) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ ticket, fp, natoIl }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

/**
 * I biglietti di questa sessione: quello di FILO_BIGLIETTO_FILE se vale, altrimenti tutti quelli della cartella della
 * radice del repo (più d'uno: chi chiede la fiducia prende il più sporco). Nessuno = nessun biglietto, non fidato.
 */
export function trovaBiglietti({ env = process.env, cwd = process.cwd() } = {}) {
  const daEnv = String(env[ENV_FILE] || '').trim();
  if (daEnv) {
    const b = leggiFile(daEnv);
    if (b) return [b];
  }
  const radice = radiceRepo(cwd);
  if (!radice) return [];
  const dir = cartellaBiglietti(radice);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const nome of readdirSync(dir)) {
    if (!nome.endsWith('.json')) continue;
    const b = leggiFile(join(dir, nome));
    if (b) out.push(b);
  }
  return out;
}

// I marcatori dei turni della conversazione (gemelli di USER_TURN_RE e MODEL_TURN_RE in src/shared/feedbackThread.js).
const TURNO_OWNER_RE = /^---\s*(?:Riaperto il|La tua risposta del)\s*.*?\s*---\s*$/;
const TURNO_ALTRI_RE = /^---\s*(?:Aggiornamento dell'agente del|Filo ha risposto il)\s*.*?\s*---\s*$/;

/**
 * La conversazione contiene testo scritto da altri che dall'owner (routine, sessioni, Filo)? PURA. Il server sa se
 * l'ha scritto un biglietto sporco (`scrittoSporco`), da qui no: nel dubbio, chi la stampa si sporca.
 */
export function noteConScrittiDiAltri(notes) {
  let altri = true;
  for (const riga of String(notes || '').split(/\r?\n/)) {
    if (TURNO_OWNER_RE.test(riga)) { altri = false; continue; }
    if (TURNO_ALTRI_RE.test(riga)) { altri = true; continue; }
    if (riga.startsWith('@@filo-attachment ')) continue;
    if (altri && riga.trim()) return true;
  }
  return false;
}

/** Perché chi stampa questo feedback si sporca (§1.2): testo non fidato, o una conversazione scritta anche da altri. PURA. */
export function motiviDiLettura({ fiducia, notes } = {}) {
  const out = [];
  if (fiducia !== 'fidato') out.push('testo di un feedback non fidato');
  if (noteConScrittiDiAltri(notes)) out.push('conversazione con scritti di routine o sessioni');
  return out;
}

/** Il motivo di un rifiuto della callable, per l'owner. PURA. */
export function messaggioErrore(status, body) {
  const err = (body && body.error) || {};
  const res = body && body.result && body.result.ok === false ? body.result : null;
  if (status === 404) return 'la funzione localTicket non è ancora pubblicata sul server';
  if (status === 403 || err.status === 'PERMISSION_DENIED') return 'il server non riconosce questa credenziale come proprietario';
  if (res) return `${res.reason || 'rifiuto'}${res.detail ? `: ${res.detail}` : ''}`;
  return err.message || `errore ${status}`;
}

/**
 * Una op della callable con il token dell'owner. deps: { fetchImpl, idToken() → Promise<string>, url, tempoMs }.
 * → il risultato del server; lancia un Error col motivo (anche «non ancora pubblicata») se non va.
 */
export async function chiama(op, data = {}, deps = {}) {
  // Dentro una prova (node --test) il server vero non si tocca mai: un ramo di prova finirebbe nel registro vero.
  if (!deps.fetchImpl && process.env.NODE_TEST_CONTEXT) throw new Error('niente server vero dentro una prova');
  const fetchImpl = deps.fetchImpl || fetch;
  const idToken = deps.idToken ? await deps.idToken() : await tokenOwner();
  if (!idToken) throw new Error('nessuna credenziale admin su questa macchina');
  const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(deps.tempoMs || TEMPO_MASSIMO_MS) : undefined;
  const res = await fetchImpl(deps.url || LOCAL_TICKET_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data: Object.assign({ op }, data) }),
    ...(signal ? { signal } : {}),
  });
  let body = {};
  try { body = await res.json(); } catch (_) { body = {}; }
  if (!res.ok || (body.result && body.result.ok === false)) throw new Error(messaggioErrore(res.status, body));
  return body.result || {};
}

async function tokenOwner() {
  const { findAdminRefreshToken, mintIdToken } = await import('./firestore-auth.mjs');
  const refresh = findAdminRefreshToken();
  return refresh ? mintIdToken(refresh) : '';
}

/** C'è una credenziale dell'owner su questa macchina? Senza, niente biglietto (e niente chiamate). */
export async function haCredenzialeOwner() {
  try {
    const { findAdminRefreshToken } = await import('./firestore-auth.mjs');
    return !!findAdminRefreshToken();
  } catch (_) {
    return false;
  }
}

/** Lo stato di ogni biglietto trovato, letto dal server. Un biglietto illeggibile vale sporco. */
async function statiDi(biglietti, deps) {
  const out = [];
  for (const b of biglietti) {
    try {
      const s = await chiama('stato', { ticket: b.ticket }, deps);
      out.push(Object.assign({}, b, { fiducia: s.fiducia === 'fidato' && s.chiuso !== true ? 'fidato' : 'non_fidato', stato: s }));
    } catch (e) {
      out.push(Object.assign({}, b, { fiducia: 'non_fidato', errore: String((e && e.message) || e) }));
    }
  }
  return out;
}

/** Il biglietto che vale per questa sessione: il più sporco fra quelli trovati. null = nessuno. */
export async function trovaBiglietto({ env, cwd, deps = {} } = {}) {
  const trovati = trovaBiglietti({ env, cwd });
  if (!trovati.length) return null;
  const stati = await statiDi(trovati, deps);
  return stati.find((b) => b.fiducia !== 'fidato') || stati[0];
}

/**
 * Per gli strumenti che stampano testo esterno: sporca la sessione col motivo e dice in una riga com'è andata. Va
 * chiamata PRIMA di stampare. `cosa` = cosa si sta leggendo («letto #813»), `motivi` = motiviDiLettura.
 */
export async function rigaSporco(cosa, motivi, opts = {}) {
  const testo = `${cosa}: ${motivi.join('; ')}`;
  const r = await sporca(testo, opts);
  if (r.senzaBiglietto) return 'Nessun biglietto della sessione: era già non fidata.';
  if (r.sporcati) return `Biglietto della sessione sporcato (${motivi.join('; ')}): da qui ciò che scrivi nasce non fidato.`;
  return `Biglietto NON sporcato (${r.errori.join('; ')}): dichiaralo con node scripts/biglietto.mjs sporca "${cosa}".`;
}

/** 'fidato' solo con un biglietto pulito: senza biglietto, o con un guasto, 'non_fidato'. */
export async function fiduciaLocale(opts = {}) {
  try {
    const b = await trovaBiglietto(opts);
    return b && b.fiducia === 'fidato' ? 'fidato' : 'non_fidato';
  } catch (_) {
    return 'non_fidato';
  }
}

/**
 * Sporca tutti i biglietti di questa sessione (§1.2: la sessione dichiara da sé). Mai un'eccezione: chi stampa testo
 * esterno non deve fermarsi per un guasto del server, e senza biglietto la sessione è già non fidata.
 * @returns {Promise<{ sporcati: number, senzaBiglietto?: true, errori: string[] }>}
 */
export async function sporca(motivo, { env, cwd, deps = {} } = {}) {
  const m = String(motivo || '').trim().slice(0, 300);
  const out = { sporcati: 0, errori: [] };
  if (!m) { out.errori.push('il motivo è obbligatorio'); return out; }
  const trovati = trovaBiglietti({ env, cwd });
  if (!trovati.length) return Object.assign(out, { senzaBiglietto: true });
  for (const b of trovati) {
    try {
      await chiama('sporca', { ticket: b.ticket, motivo: m }, deps);
      out.sporcati += 1;
    } catch (e) {
      out.errori.push(String((e && e.message) || e));
    }
  }
  return out;
}

/** Prende un biglietto e scrive il suo file. → { path, fp, fiducia }. */
export async function prendi({ sporco = false, motivo = '', sessionId = '', cwd = process.cwd(), nowMs = Date.now(), deps = {} } = {}) {
  const radice = radiceRepo(cwd);
  if (!radice) throw new Error('fuori da un repo: il biglietto vive nella cartella .claude della radice');
  const r = await chiama('prendi', Object.assign({ sessione: String(sessionId || '').slice(0, 8) }, sporco ? { sporco: true, motivo: String(motivo || 'nato sporco') } : {}), deps);
  if (!r.ticket || !FP_RE.test(String(r.fp || ''))) throw new Error('risposta del server senza biglietto');
  const path = join(cartellaBiglietti(radice), `${idDelFile(sessionId, nowMs)}.json`);
  scriviFile(path, { ticket: r.ticket, fp: r.fp, natoIl: nowMs });
  return { path, fp: r.fp, fiducia: r.fiducia === 'fidato' ? 'fidato' : 'non_fidato' };
}

/**
 * Registra nel registro dei rami la punta che questa sessione ha scritto (verify-local start, finish). Mai
 * un'eccezione: senza biglietto o con un guasto il ramo resta senza la voce, cioè non fidato.
 * @returns {Promise<{ ok: boolean, ramoFidato?: boolean, senzaBiglietto?: true, errore?: string }>}
 */
export async function registraRamo({ repo, ramo, sha, feedbackId = '', env, cwd, deps = {} } = {}) {
  try {
    const b = await trovaBiglietto({ env, cwd, deps });
    if (!b) return { ok: false, senzaBiglietto: true };
    const r = await chiama('ramo', Object.assign({ ticket: b.ticket, repo, ramo, sha }, feedbackId ? { feedbackId } : {}), deps);
    return { ok: true, ramoFidato: r.ramoFidato === true, fiducia: b.fiducia };
  } catch (e) {
    return { ok: false, errore: String((e && e.message) || e) };
  }
}

/** Chiude i biglietti di questa sessione e ne toglie i file. */
export async function chiudi({ env, cwd, deps = {} } = {}) {
  const out = { chiusi: 0, errori: [] };
  for (const b of trovaBiglietti({ env, cwd })) {
    try {
      await chiama('chiudi', { ticket: b.ticket }, deps);
      out.chiusi += 1;
    } catch (e) {
      out.errori.push(String((e && e.message) || e));
    }
    try { rmSync(b.path, { force: true }); } catch (_) { /* resta, chiuso sul server */ }
  }
  return out;
}

/**
 * L'hook di avvio (contratto #1148 §1.3). `input` = lo stdin dell'hook ({ session_id, source }). Solo con la
 * credenziale dell'owner e fuori dalle routine. Eredita un biglietto vivo; alla ripresa riusa il suo, o ne prende
 * uno nato sporco; altrimenti uno pulito. Scrive FILO_BIGLIETTO_FILE in CLAUDE_ENV_FILE. Mai un'eccezione.
 * @returns {Promise<{ riga: string, path?: string }>} la riga da stampare ('' = niente)
 */
export async function avvio({ input = {}, env = process.env, cwd = process.cwd(), nowMs = Date.now(), deps = {}, haCredenziale = haCredenzialeOwner } = {}) {
  try {
    if (env.FILO_ROUTINE) return { riga: '' };
    if (!(await haCredenziale())) return { riga: '' };
    const sessionId = String((input && input.session_id) || '').trim();
    const source = String((input && input.source) || '').trim();
    let path = '';
    let fiducia = '';
    const ereditato = String(env[ENV_FILE] || '').trim() ? leggiFile(String(env[ENV_FILE]).trim()) : null;
    if (ereditato) {
      // Un figlio dell'orchestratore locale: eredita la fiducia del padre adesso (§12.2).
      const s = await chiama('stato', { ticket: ereditato.ticket }, deps).catch(() => null);
      if (s && s.chiuso !== true) {
        path = ereditato.path;
        fiducia = s.fiducia === 'fidato' ? 'fidato' : 'non_fidato';
      }
    }
    if (!path && (source === 'resume' || source === 'compact')) {
      const radice = radiceRepo(cwd);
      const suo = radice && ID_RE.test(sessionId) ? leggiFile(join(cartellaBiglietti(radice), `${sessionId}.json`)) : null;
      if (suo) {
        path = suo.path;
        const s = await chiama('stato', { ticket: suo.ticket }, deps).catch(() => null);
        fiducia = s && s.fiducia === 'fidato' && s.chiuso !== true ? 'fidato' : 'non_fidato';
      } else {
        const p = await prendi({ sporco: true, motivo: 'ripresa senza biglietto', sessionId, cwd, nowMs, deps });
        path = p.path;
        fiducia = p.fiducia;
      }
    }
    if (!path) {
      const p = await prendi({ sessionId, cwd, nowMs, deps });
      path = p.path;
      fiducia = p.fiducia;
    }
    const envFile = String(env.CLAUDE_ENV_FILE || '').trim();
    if (envFile) {
      try { writeFileSync(envFile, `export ${ENV_FILE}='${path.replace(/'/g, "'\\''")}'\n`, { flag: 'a', encoding: 'utf8' }); } catch (_) { /* resta la ricerca nella cartella */ }
    }
    return { riga: `Biglietto della sessione: ${fiducia === 'fidato' ? 'pulito' : 'sporco'}${envFile ? '' : ' (CLAUDE_ENV_FILE assente: vale la cartella .claude/biglietti)'}.`, path };
  } catch (e) {
    // Una riga sola: l'hook stampa solo la prima, e un errore di rete porta con sé il corpo JSON della risposta.
    return { riga: `Biglietto della sessione non preso: ${String((e && e.message) || e).replace(/\s+/g, ' ').trim().slice(0, 160)}.` };
  }
}
