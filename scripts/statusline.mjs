// Barra di stato di Claude Code: l'unico posto dove arriva la percentuale vera del piano (SPEC-DOMANDE.md §8.1).
// Salva la lettura per sessione in ~/.claude/filo-quota.json, stampa una riga corta, non lancia mai e non aspetta la rete:
// l'invio a ownerCrediti (account A, solo col token admin) parte staccato al massimo ogni cinque minuti (`--invia`).

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const QUI = fileURLToPath(import.meta.url);
const BASE = process.env.FILO_ROUTINE_API || 'https://europe-west1-filo-8b9cb.cloudfunctions.net';
export const INVIO_OGNI_MS = 5 * 60 * 1000;
// Le sessioni tenute nel file: una per sessione viva, le più vecchie escono.
const SESSIONI_MAX = 20;

export function quotaFile(home = os.homedir()) { return join(home, '.claude', 'filo-quota.json'); }
export function invioFile(home = os.homedir()) { return join(home, '.claude', 'filo-quota-invio.json'); }

function numero(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }

/** La lettura dallo stdin della barra; `null` se mancano i limiti (non abbonati, o prima della prima risposta). PURA. */
export function letturaDa(input, nowMs = Date.now()) {
  const rl = input && typeof input === 'object' ? input.rate_limits : null;
  const s = rl && typeof rl === 'object' ? rl.seven_day : null;
  const pct7d = numero(s && s.used_percentage);
  const reset7dAtS = numero(s && s.resets_at);
  if (pct7d === null || reset7dAtS === null) return null;
  const l = { pct7d, reset7dAtS, letturaAtMs: nowMs };
  const f = rl.five_hour;
  const pct5h = numero(f && f.used_percentage);
  const reset5hAtS = numero(f && f.resets_at);
  if (pct5h !== null && reset5hAtS !== null) Object.assign(l, { pct5h, reset5hAtS });
  return l;
}

/** La riga stampata. PURA. */
export function riga(lettura) {
  const p = (v) => (v === null || v === undefined ? '–' : `${Math.round(v)}%`);
  return `5h ${p(lettura && lettura.pct5h)} · 7g ${p(lettura && lettura.pct7d)}`;
}

function leggiJson(file) {
  try { const v = JSON.parse(readFileSync(file, 'utf8')); return v && typeof v === 'object' ? v : null; } catch (_) { return null; }
}

function scriviAtomico(file, valore) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(valore), 'utf8');
  renameSync(tmp, file);
}

/**
 * Aggiorna il file delle letture: la sessione che ha girato la barra ci compare sempre (il battito ne deduce
 * `barra:'presente'`), la lettura solo se c'è. Torna il contenuto scritto.
 */
export function registra(file, { sessionId, lettura, nowMs = Date.now() }) {
  const cur = leggiJson(file) || {};
  const sessioni = cur.sessioni && typeof cur.sessioni === 'object' ? Object.assign({}, cur.sessioni) : {};
  if (sessionId) {
    const prima = sessioni[sessionId] || {};
    sessioni[sessionId] = Object.assign({}, prima, { vistaAtMs: nowMs }, lettura ? { lettura } : {});
  }
  const tenute = Object.entries(sessioni).sort((a, b) => (b[1].vistaAtMs || 0) - (a[1].vistaAtMs || 0)).slice(0, SESSIONI_MAX);
  const ultima = lettura ? Object.assign({ sessionId }, lettura) : cur.ultima || null;
  const out = { sessioni: Object.fromEntries(tenute), ultima };
  scriviAtomico(file, out);
  return out;
}

/** Ora di inviare? Al massimo ogni cinque minuti, contando anche i tentativi. PURA a meno della lettura. */
export function daInviare(fileInvio, nowMs = Date.now()) {
  const v = leggiJson(fileInvio) || {};
  const ultimo = Math.max(Number(v.tentatoAtMs) || 0, Number(v.atMs) || 0);
  return nowMs - ultimo >= INVIO_OGNI_MS;
}

/** Il giro della barra: legge, registra, stampa, e se è ora lancia l'invio staccato. Non lancia mai. */
export function barra(testo, { home = os.homedir(), nowMs = Date.now(), lancia = lanciaInvio, scrivi = (s) => process.stdout.write(s) } = {}) {
  let lettura = null;
  try {
    const input = JSON.parse(String(testo || '{}'));
    lettura = letturaDa(input, nowMs);
    const sessionId = typeof input.session_id === 'string' ? input.session_id : '';
    registra(quotaFile(home), { sessionId, lettura, nowMs });
    if (lettura && daInviare(invioFile(home), nowMs)) {
      const prima = leggiJson(invioFile(home)) || {};
      scriviAtomico(invioFile(home), Object.assign({}, prima, { tentatoAtMs: nowMs }));
      lancia(home);
    }
  } catch (_) {
    // La barra non deve mai rompere la sessione: al peggio una riga senza numeri.
  }
  scrivi(`${riga(lettura)}\n`);
}

function lanciaInvio(home) {
  const figlio = spawn(process.execPath, [QUI, '--invia'], {
    detached: true, stdio: 'ignore', windowsHide: true, env: Object.assign({}, process.env, { FILO_QUOTA_HOME: home }),
  });
  figlio.unref();
}

/** L'invio dell'ultima lettura a `ownerCrediti op:lettura`. L'esito (anche «non ancora pubblicata») resta in filo-quota-invio.json. */
export async function invia({ home = os.homedir(), nowMs = Date.now(), fetchImpl = fetch, token } = {}) {
  const fileInvio = invioFile(home);
  const esito = (o) => {
    try { scriviAtomico(fileInvio, Object.assign({}, leggiJson(fileInvio) || {}, o, { atMs: nowMs })); } catch (_) { /* resta il tentativo */ }
    return o;
  };
  const ultima = (leggiJson(quotaFile(home)) || {}).ultima;
  if (!ultima || numero(ultima.pct7d) === null) return esito({ ok: false, errore: 'nessuna lettura' });
  let idToken;
  try {
    const t = token || (await tokenAdmin());
    if (!t) return esito({ ok: false, errore: 'senza token admin' });
    idToken = t;
  } catch (e) {
    return esito({ ok: false, errore: `token: ${String((e && e.message) || e).slice(0, 200)}` });
  }
  const { sessionId: _s, ...dati } = ultima;
  try {
    const res = await fetchImpl(`${BASE}/ownerCrediti`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ data: Object.assign({ op: 'lettura' }, dati) }),
    });
    if (res.status === 404) return esito({ ok: false, errore: 'ownerCrediti non ancora pubblicata' });
    const corpo = await res.json().catch(() => ({}));
    if (!res.ok || corpo.error) return esito({ ok: false, errore: String((corpo.error && corpo.error.message) || `HTTP ${res.status}`).slice(0, 300) });
    return esito({ ok: true, errore: '' });
  } catch (e) {
    return esito({ ok: false, errore: `rete: ${String((e && e.message) || e).slice(0, 200)}` });
  }
}

async function tokenAdmin() {
  const { findAdminRefreshToken, mintIdToken } = await import('./lib/firestore-auth.mjs');
  const r = findAdminRefreshToken();
  return r ? mintIdToken(r) : null;
}

if (resolve(process.argv[1] || '') === resolve(QUI)) {
  if (process.argv.includes('--invia')) {
    try { await invia({ home: process.env.FILO_QUOTA_HOME || os.homedir() }); } catch (_) { /* staccato: nessuno legge */ }
  } else {
    let testo = '';
    let fatto = false;
    // Uno stdin che non si chiude non deve appendere la barra: dopo due secondi si stampa con quello che c'è.
    const una = () => { if (fatto) return; fatto = true; barra(testo); process.exit(0); };
    setTimeout(una, 2000).unref();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { testo += c; });
    process.stdin.on('end', una);
    process.stdin.on('error', una);
  }
}
