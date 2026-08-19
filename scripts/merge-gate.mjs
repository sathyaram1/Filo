// Cancello di merge per le routine cloud — CLIENT del canale autenticato.
//
// PERCHÉ ESISTE (SPEC-RIDISEGNO-MAX.md §10)
//   Tutto ciò che tocca `main` raggiunge TUTTI gli utenti via auto-update: una
//   correzione non verificata — o un branch compromesso da una prompt-injection
//   nel testo di un feedback — non deve MAI arrivarci senza un cancello.
//
//   Fino all'agosto 2026 il cancello girava QUI: questa macchina calcolava il
//   diff, applicava L5 e il verdetto L4 (passato via FILO_L4_VERDICT), fondeva
//   e pushava. Ma su questa stessa macchina vive un LLM che legge testo scritto
//   da sconosciuti: un'istanza catturata poteva saltare tutto e pushare dritta
//   su main. "Difficile" non è una difesa — l'ultimo livello deve essere NON
//   convincibile.
//
//   Ora IL MERGE LO FA IL SERVER. Questo script è solo il citofono: presenta il
//   biglietto del giro e chiede "fondi il mio ramo". È il server che verifica
//   dallo stato VERO (PASS della verifica e del controllo di sicurezza,
//   REGISTRATI da consegne validate — non raccontati), fa girare L5 sul diff
//   che SCARICA lui da GitHub, e fonde via API con la SUA identità. Qui non
//   c'è più niente da convincere: nessun verdetto da passare, nessun git da
//   pilotare, nessun push. Con la ruleset su `main` (passo dell'owner) il push
//   diretto da una sessione diventa fisicamente impossibile.
//
// USO:
//   node scripts/merge-gate.mjs <sourceBranch>
//
//   Il biglietto si ritrova da solo (lo ha depositato dispatch, come per le
//   consegne). Il branch passato può solo CONFERMARE quello legato al
//   biglietto: chiedere di fondere un altro ramo è un rifiuto registrato sul
//   server, non una correzione silenziosa.
//
//   Exit code (contratto invariato):
//     0  → fuso su main (dal server)
//     10 → BLOCCATO dal cancello di sicurezza (L5 sul diff): il feedback va
//          messo in stato `design`, decide l'utente. Nessuna fusione.
//     20 → conflitto di merge: serve risoluzione manuale. Nessuna fusione.
//     1  → errore tecnico (argomenti, biglietto assente, server/GitHub giù) o
//          richiesta RIFIUTATA dal server (verdetti non registrati, ramo che
//          non combacia col biglietto): il server l'ha già messa a registro.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { merge } from './routine-channel.mjs';
import { readTicket } from './lib/routine-ticket.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// FILO_REPO_ROOT: override della root (dove si cerca il biglietto). Esiste SOLO
// per i test, che simulano il giro in cartelle usa-e-getta senza toccare il
// repo reale (stesso pattern degli altri script delle routine).
const ROOT = process.env.FILO_REPO_ROOT ? resolve(process.env.FILO_REPO_ROOT) : resolve(__dirname, '..');

// ─── logica pura (testabile) ────────────────────────────────────────────────

// Un nome di branch valido e non pericoloso da mettere in una richiesta.
export function isValidBranch(name) {
  return typeof name === 'string'
    && name.length > 0
    && !name.startsWith('-')
    && /^[A-Za-z0-9._\/-]+$/.test(name)
    && !name.includes('..');
}

// Parsing degli argomenti CLI: <source> e basta. Un flag sconosciuto (compresi
// i vecchi `--into` e `--dry-run`, che non esistono più) finisce in `unknown`
// e il CLI si rifiuta di partire — meglio un errore chiaro che ignorare in
// silenzio ciò che il chiamante credeva di aver chiesto.
export function parseArgs(argv) {
  const out = { source: '', unknown: [] };
  for (const a of argv) {
    if (typeof a === 'string' && a.startsWith('-')) out.unknown.push(a);
    else if (!out.source) out.source = a;
  }
  return out;
}

/**
 * Dalla risposta del server all'exit code del contratto. PURA.
 *
 *   merged → 0    blocked → 10    conflict → 20    tutto il resto → 1
 *
 * Il 10 è riservato all'esito `blocked`, che arriva solo dal cancello L5: è
 * il caso "decide l'owner". Un RIFIUTO del server (`ok:false`: verdetti non
 * registrati, ramo che non combacia, biglietto morto) vale 1 — non è un
 * blocco di sicurezza da spiegare all'owner, è una richiesta fuori perimetro
 * che il server ha già messo a registro.
 */
export function exitCodeFor(reply) {
  const r = reply || {};
  if (r.ok === true && r.result === 'merged') return 0;
  if (r.ok === true && r.result === 'blocked') return 10;
  if (r.ok === true && r.result === 'conflict') return 20;
  return 1;
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

async function main() {
  const { source, unknown } = parseArgs(process.argv.slice(2));
  if (unknown.length) {
    console.error(`opzioni sconosciute: ${unknown.join(' ')} (il gate non prende più flag: il merge lo fa il server)`);
    process.exit(1);
  }
  if (!source) { console.error('uso: node scripts/merge-gate.mjs <sourceBranch>'); process.exit(1); }
  if (!isValidBranch(source)) { console.error(`branch sorgente non valido: "${source}"`); process.exit(1); }

  // Il biglietto del giro: senza, questa richiesta non ha un lavoro a cui
  // riferirsi e il server non saprebbe (giustamente) di cosa parliamo.
  const ticket = readTicket(ROOT);
  if (!ticket) {
    console.error('[merge-gate] ERROR: nessun biglietto di giro trovato — la fusione passa dal canale e serve il biglietto del lavoro.');
    process.exit(1);
  }

  const reply = await merge(ticket, source);
  const code = exitCodeFor(reply);
  if (code === 0) console.log(`[merge-gate] OK: ${source} fuso su main dal server${reply.sha ? ` (${reply.sha.slice(0, 12)})` : ''}`);
  else if (code === 10) console.error(`[merge-gate] BLOCKED: ${reply.reason || 'cancello di sicurezza'}`);
  else if (code === 20) console.error(`[merge-gate] CONFLICT: ${reply.reason || 'serve risoluzione manuale'}`);
  else console.error(`[merge-gate] ERROR: ${reply.reason || 'guasto'}`);
  process.exit(code);
}

// Esegui solo se invocato come script (non quando importato dai test).
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
