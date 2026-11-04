// routine-domanda.mjs — la domanda di fine sessione delle routine, dalla parte dell'owner.
// Imposta le domande per slot e legge le risposte, stampate coi caratteri di controllo resi
// visibili; le sessioni la chiedono con routine-channel.mjs domanda/risposta, solo alla fine.

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rigaSporco } from './lib/biglietto-locale.mjs';
import '../src/shared/routineChiusura.js';

// Slot, testo reso visibile e risposte in un elenco solo: le stesse regole di Gestione → Automazioni.
const CH = globalThis.SN_ROUTINE_CHIUSURA;
export const visibile = CH.visibile;

const INDIRIZZO = 'https://europe-west1-filo-8b9cb.cloudfunctions.net/routineClosingAdmin';
const SLOT = `${CH.SLOT.join(', ')}, compito:<ricorrente> (per esempio compito:riordino)`;
const USO = 'Uso: node scripts/routine-domanda.mjs [mostra | imposta <slot> "<testo>" (o il testo da stdin) | togli <slot> | risposte [--n N]]'
  + `\nslot: ${SLOT}`;

/** Il motivo di un errore della callable, con l'elenco quando il server lo manda (`bad_slot`). PURA. */
export function messaggioErrore(status, body) {
  const b = body || {};
  const err = b.error || {};
  const res = b.result && b.result.ok === false ? b.result : null;
  let msg = err.message || (res && (res.detail || res.message || res.reason))
    || (status === 404 ? 'la funzione routineClosingAdmin non esiste sul server (non ancora pubblicata?)' : `errore ${status}`);
  if (res && res.reason && !String(msg).includes(res.reason)) msg = `${res.reason}: ${msg}`;
  const det = (err.details && typeof err.details === 'object') ? err.details : (res || {});
  const elenco = det.allowed || det.slots || det.valid;
  if (Array.isArray(elenco) && elenco.length && !elenco.every((x) => String(msg).includes(String(x)))) {
    msg += ` (ammessi: ${elenco.join(', ')})`;
  }
  return visibile(msg);
}

/** Le parole della riga di comando. PURA. @returns {{ cmd, slot?, testo?, n? } | { errore }} */
export function leggiArgomenti(argv) {
  const a = (Array.isArray(argv) ? argv : []).map(String);
  const cmd = a[0] || 'mostra';
  if (cmd === 'mostra') return a.length <= 1 ? { cmd } : { errore: `"${a[1]}" non vale qui. ${USO}` };
  if (cmd === 'imposta') {
    if (!a[1] || a[1].startsWith('-')) return { errore: `imposta vuole lo slot. ${USO}` };
    // Il testo intero come l'ha scritto: più parole senza virgolette restano una frase.
    return { cmd, slot: a[1], testo: a.slice(2).join(' ') };
  }
  if (cmd === 'togli') return a.length === 2 && !a[1].startsWith('-') ? { cmd, slot: a[1] } : { errore: `togli vuole lo slot e basta. ${USO}` };
  if (cmd === 'risposte') {
    let n;
    for (let i = 1; i < a.length; i++) {
      const m = /^--n(?:=(.*))?$/.exec(a[i]);
      if (!m) return { errore: `"${a[i]}" non vale qui. ${USO}` };
      const v = m[1] !== undefined ? m[1] : a[++i];
      n = Number(v);
      if (!Number.isInteger(n) || n < 1) return { errore: `--n vuole un numero intero da 1 in su, non "${v ?? ''}".` };
    }
    return n === undefined ? { cmd } : { cmd, n };
  }
  return { errore: USO };
}

function dataOra(ms) {
  if (!Number.isFinite(ms)) return '?';
  return new Date(ms).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * Le risposte di orchestratori e worker in un elenco solo, dal più recente, al
 * massimo `n` voci. Domanda e risposta sempre intere. PURA (`quando` formatta l'ora).
 */
export function formattaRisposte(result, { n = 50, quando = dataOra } = {}) {
  const voci = CH.vociRisposte(result).map((v) => ({ ...v, testa: v.durata ? v.chi.replace(' · ', ` · ${v.durata} · `) : v.chi }));
  const scelte = voci.slice(0, n);
  if (!scelte.length) return 'Nessuna risposta.';
  const righe = scelte.map((v) => [
    `${quando(v.t)}  ${v.testa}`,
    `  D: ${visibile(v.domanda || '').replace(/\n/g, '\n     ')}`,
    `  R: ${v.answered ? visibile(v.risposta || '').replace(/\n/g, '\n     ') : '(nessuna risposta)'}`,
  ].join('\n'));
  // Più voci di quelle mostrate: si dice, non si tace.
  const altre = voci.length - scelte.length;
  return righe.join('\n\n') + (altre > 0 ? `\n\n(altre ${altre} più vecchie fra quelle arrivate: alza --n per vederle)` : '');
}

/** Le domande impostate e il ripiego, come le risolve il server. PURA. */
export function formattaDomande(result) {
  const r = result || {};
  const slots = r.slots && typeof r.slots === 'object' ? r.slots : {};
  const nomi = Object.keys(slots).sort();
  const righe = nomi.map((s) => `${visibile(s)}\n  ${visibile((slots[s] && slots[s].text) || '').replace(/\n/g, '\n  ')}`);
  if (!nomi.length) righe.push('Nessuna domanda impostata: vale per tutti il ripiego.');
  righe.push(`ripiego (orchestratore senza slot suo; worker senza slot del ricorrente, del ruolo, «worker»; poi «tutti»)\n  ${visibile(r.default || '?').replace(/\n/g, '\n  ')}`);
  return righe.join('\n\n');
}

async function chiama(data) {
  const { findAdminRefreshToken, mintIdToken } = await import('./lib/firestore-auth.mjs');
  const refresh = findAdminRefreshToken();
  if (!refresh) {
    console.error('Non trovo le tue credenziali di proprietario (FILO_ADMIN_REFRESH_TOKEN).');
    process.exit(1);
  }
  const idToken = await mintIdToken(refresh);
  const res = await fetch(INDIRIZZO, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || (body.result && body.result.ok === false)) {
    console.error(`Non riuscito: ${messaggioErrore(res.status, body)}`);
    process.exit(1);
  }
  return body.result || {};
}

async function leggiStdin() {
  if (process.stdin.isTTY) return '';
  const pezzi = [];
  for await (const p of process.stdin) pezzi.push(p);
  return Buffer.concat(pezzi).toString('utf8');
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.some((x) => x === '--help' || x === '-h')) { console.log(USO); return; }
  const a = leggiArgomenti(argv);
  if (a.errore) { console.error(`RIFIUTATO: ${a.errore}`); process.exit(1); }

  if (a.cmd === 'mostra') { console.log(formattaDomande(await chiama({ op: 'get' }))); return; }
  if (a.cmd === 'imposta') {
    const testo = (a.testo || await leggiStdin()).trim();
    if (!testo) { console.error('Manca il testo della domanda: dopo lo slot, o da stdin.'); process.exit(1); }
    await chiama({ op: 'set', slot: a.slot, text: testo });
    console.log(`Domanda per "${a.slot}" impostata.`);
    return;
  }
  if (a.cmd === 'togli') {
    await chiama({ op: 'clear', slot: a.slot });
    console.log(`Domanda per "${a.slot}" tolta: vale il ripiego.`);
    return;
  }
  const n = a.n || 50;
  const risposte = await chiama({ op: 'answers', limit: n });
  // Le risposte le scrivono le routine, che leggono testo d'utente: chi le stampa si sporca prima (#1148).
  console.error(await rigaSporco('risposte delle routine alla domanda di fine sessione', ['testo scritto dalle routine']));
  console.log(formattaRisposte(risposte, { n }));
}

const isMain = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMain) main().catch((e) => { console.error(e?.message || e); process.exit(1); });
