// I giri di verifica dei lavori chiusi in una finestra di date (#795), per rileggere i bilanci dei giri: per ogni giro
// livelli trovati, esterni, corretti, bilancio pagato ed esito, poi i totali. Solo numeri, mai il testo dei rilievi.
// Regole: tests/unit/storicoGiri.test.mjs. Uso: node scripts/storico-giri.mjs [--da <data>] [--a <data>] [--json]

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import './lib/freno-letture.mjs';
import '../src/shared/feedback.js';
import '../src/shared/storicoGiri.js';

const INDIRIZZO = 'https://europe-west1-filo-8b9cb.cloudfunctions.net/routineStateAdmin';
// Livelli, esiti e totali sono gli stessi che mostra Gestione → Routine → Log.
const { LIVELLI, ESITI, FINESTRA_PREDEFINITA, totali: totaliGiri, elenco, bilancio } = globalThis.SN_STORICO_GIRI;
const USO = 'Uso: node scripts/storico-giri.mjs [--da <data>] [--a <data>] [--json]\n'
  + '  <data>: AAAA-MM-GG, GG/MM/AAAA o GG/MM (anno in corso). --a comprende tutto quel giorno.\n'
  + '  Senza date: gli ultimi 30 giorni. --json stampa i dati per chi li rielabora.';

/** Mezzanotte locale del giorno scritto, o NaN. PURA. */
export function giornoLocale(testo, ora = Date.now()) {
  const t = String(testo ?? '').trim();
  let a; let m; let g;
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (r) [, a, m, g] = r.map(Number);
  else if ((r = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(t))) {
    g = Number(r[1]); m = Number(r[2]); a = r[3] ? Number(r[3]) : new Date(ora).getFullYear();
  } else return NaN;
  const d = new Date(a, m - 1, g);
  return d.getFullYear() === a && d.getMonth() === m - 1 && d.getDate() === g ? d.getTime() : NaN;
}

/** Le parole della riga di comando. PURA. @returns {{ da, a, json } | { errore } | { aiuto: true }} */
export function leggiArgomenti(argv, ora = Date.now()) {
  const x = (Array.isArray(argv) ? argv : []).map(String);
  let da; let a; let json = false;
  for (let i = 0; i < x.length; i++) {
    const w = x[i];
    if (w === '--help' || w === '-h') return { aiuto: true };
    if (w === '--json') { json = true; continue; }
    const m = /^--(da|a)(?:=(.*))?$/.exec(w);
    if (!m) return { errore: `"${w}" non vale qui.\n${USO}` };
    const v = m[2] !== undefined ? m[2] : x[++i];
    const ms = giornoLocale(v, ora);
    if (!Number.isFinite(ms)) return { errore: `--${m[1]} vuole una data (AAAA-MM-GG, GG/MM/AAAA o GG/MM), non "${v ?? ''}".` };
    if (m[1] === 'da') da = ms;
    // La fine comprende il giorno scritto: si ferma alla mezzanotte dopo, anche col cambio d'ora.
    else { const d = new Date(ms); a = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(); }
  }
  if (a === undefined) a = ora;
  if (da === undefined) da = a - FINESTRA_PREDEFINITA;
  if (a <= da) return { errore: 'La fine della finestra (--a) deve venire dopo l\'inizio (--da).' };
  return { da, a, json };
}

/** «#795», «#22.1» o l'id quando il feedback non ha numero. PURA. */
export function numeroDi(lavoro) {
  const n = globalThis.SN_FEEDBACK.formatNum(lavoro && lavoro.seq, lavoro && lavoro.subSeq);
  return n ? `#${n}` : String((lavoro && lavoro.feedbackId) || '?');
}

/** I totali per livello e per esito (SN_STORICO_GIRI). PURA. */
export const totali = totaliGiri;

function dataOra(ms) {
  if (!Number.isFinite(ms)) return '?';
  return new Date(ms).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
}

function tabella(righe) {
  const larghe = righe[0].map((_, i) => Math.max(...righe.map((r) => String(r[i]).length)));
  return righe.map((r) => `  ${r.map((c, i) => (i === r.length - 1 ? String(c) : String(c).padEnd(larghe[i]))).join('  ')}`.trimEnd());
}

/** Il testo per l'owner: lavoro per lavoro, ogni giro, poi i totali. PURA (`quando` formatta l'ora). */
export function formatta(result, { da, a, quando = dataOra } = {}) {
  const r = result || {};
  const lavori = Array.isArray(r.lavori) ? r.lavori : [];
  const fine = new Date(a - 1);
  const out = [`Lavori chiusi fra ${quando(da)} e ${quando(fine.getTime())}: ${lavori.length}`];
  if (r.troncato) out.push(`Ce ne sono altri oltre questi ${lavori.length}: stringi la finestra per vederli tutti.`);
  for (const l of lavori) {
    const giri = Array.isArray(l.rounds) ? l.rounds : [];
    const persi = Math.max(0, Number(l.roundsDropped) || 0);
    out.push('', `${numeroDi(l)} · chiuso ${quando(Number(l.chiusoMs))} · ${giri.length} ${giri.length === 1 ? 'giro' : 'giri'}`
      + (persi ? ` (più ${persi} vecchi non registrati)` : ''));
    const righe = [['giro', 'quando', 'trovati', 'esterni', 'corretti', 'bilancio', 'esito']];
    giri.forEach((g, i) => righe.push([
      String(persi + i + 1), quando(Date.parse(g.at)), elenco(g.found), elenco(g.external), elenco(g.fixed),
      bilancio(g.consumed), ESITI.includes(g.outcome) ? g.outcome : '?',
    ]));
    if (giri.length) out.push(...tabella(righe));
  }
  const t = totali(lavori);
  out.push('', `Totali: ${t.lavori} ${t.lavori === 1 ? 'lavoro' : 'lavori'}, ${t.giri} giri`
    + (t.nonRegistrati ? ` (più ${t.nonRegistrati} non registrati)` : ''));
  out.push(...tabella([['livello', 'trovati', 'esterni', 'corretti', 'giri pagati'],
    ...LIVELLI.map((n) => [String(n), t.perLivello[n].trovati, t.perLivello[n].esterni, t.perLivello[n].corretti, t.perLivello[n].pagati])]));
  out.push(`  esiti: ${ESITI.map((e) => `${e} ${t.perEsito[e]}`).join(' · ')}${t.senzaEsito ? ` · senza esito ${t.senzaEsito}` : ''}`);
  return out.join('\n');
}

/** I dati per chi rielabora: lavori col numero, totali, finestra. PURA. */
export function comeJson(result, { da, a } = {}) {
  const r = result || {};
  const lavori = (Array.isArray(r.lavori) ? r.lavori : []).map((l) => Object.assign({ num: numeroDi(l) }, l));
  return { da: new Date(da).toISOString(), a: new Date(a).toISOString(), troncato: !!r.troncato, lavori, totali: totali(lavori) };
}

/** Il motivo di un errore della callable, con il rimedio quando il server non conosce ancora lo storico. PURA. */
export function messaggioErrore(status, body) {
  const err = (body && body.error) || {};
  const msg = String(err.message || (status === 404 ? 'la funzione routineStateAdmin non esiste sul server' : `errore ${status}`));
  if (/Operazione sconosciuta/i.test(msg)) return `${msg} Il server non ha ancora lo storico dei giri: vanno pubblicate le functions di filo-security.`;
  return msg;
}

async function chiama(data) {
  const { findAdminRefreshToken, mintIdToken } = await import('./lib/firestore-auth.mjs');
  const refresh = findAdminRefreshToken();
  if (!refresh) throw new Error('Non trovo le tue credenziali di proprietario (FILO_ADMIN_REFRESH_TOKEN): node scripts/admin-login.mjs');
  const idToken = await mintIdToken(refresh);
  const res = await fetch(INDIRIZZO, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Non riuscito: ${messaggioErrore(res.status, body)}`);
  return body.result || {};
}

export async function main(argv, { chiamata = chiama, scrivi = console.log, errore = console.error, ora = Date.now() } = {}) {
  const x = leggiArgomenti(argv, ora);
  if (x.aiuto) { scrivi(USO); return 0; }
  if (x.errore) { errore(`RIFIUTATO: ${x.errore}`); return 1; }
  let result;
  try {
    result = await chiamata({ op: 'giri', da: x.da, a: x.a });
  } catch (e) {
    errore(String((e && e.message) || e));
    return 1;
  }
  scrivi(x.json ? JSON.stringify(comeJson(result, x), null, 2) : formatta(result, x));
  return 0;
}

if (resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url))) {
  process.exit(await main(process.argv.slice(2)));
}
