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
//          messo in stato `design`, decide l'utente. Nessuna fusione — ma il
//          ramo non è perduto: il server apre una richiesta di approvazione
//          che l'owner trova in cima alla dashboard di gestione.
//     20 → conflitto di merge: serve risoluzione manuale. Nessuna fusione.
//     1  → errore tecnico (argomenti, biglietto assente, server/GitHub giù) o
//          richiesta RIFIUTATA dal server (verdetti non registrati, ramo che
//          non combacia col biglietto): il server l'ha già messa a registro.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pinnedRepoRoot, absolutizeRecipe, TOOLS_ROOT } from './lib/tools-pin.mjs';
import { merge } from './routine-channel.mjs';
import { readTicket } from './lib/routine-ticket.mjs';
import { headSha, findStateIdByBranch, readBranchState, gitIn } from './lib/branch-integrity.mjs';
import { dirtyTreeText, statoDirectory, statoIllegibileText } from './lib/dirty-tree.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// FILO_REPO_ROOT: override della root (dove si cerca il biglietto). Esiste SOLO
// per i test, che simulano il giro in cartelle usa-e-getta senza toccare il
// repo reale (stesso pattern degli altri script delle routine).
const ROOT = process.env.FILO_REPO_ROOT
  ? resolve(process.env.FILO_REPO_ROOT)
  : (pinnedRepoRoot() || resolve(__dirname, '..'));

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
/**
 * I via libera registrati che NON parlano del contenuto che si sta per far
 * fondere. PURA.
 *
 * Un esito vale per la versione esaminata. Verifica e controllo di sicurezza
 * lasciano scritto su quale commit sono stati dati; se la punta del ramo si è
 * mossa dopo, quegli esiti parlano di un contenuto diverso da quello che
 * atterrerebbe su main, e il giro va rifatto invece che chiuso (feedback
 * #485). Un esito senza commit scritto accanto non decade: viene da uno
 * strumento vecchio, e a giudicarlo resta il server.
 */
export function esitiDecaduti(state, punta) {
  const s = state && typeof state === 'object' ? state : {};
  const p = String(punta || '');
  if (!p) return [];
  const fuori = [];
  for (const [campo, quale] of [['verifierSha', 'la verifica'], ['secauditSha', 'il controllo di sicurezza']]) {
    const sha = String(s[campo] || '');
    if (sha && sha !== p) fuori.push({ quale, sha });
  }
  return fuori;
}

/**
 * Il rifiuto per un via libera che parla di un altro commit. PURA.
 *
 * Il rifiuto dice anche COSA REGISTRARE. Fermarsi e basta lascia la notizia su
 * questa macchina: sul canale i due via libera continuano a risultare buoni per
 * questo ramo, che è la segnalazione #485 spostata di un passo. Il passo che la
 * registra è il rientro in verifica (`revision_security` → `revision_capability`
 * nella macchina a stati: la stessa strada del riallineamento, dove il
 * contenuto cambia e verifica e controllo di sicurezza si rifanno su quello
 * nuovo). Chi legge non deve inventarsi il comando, né accontentarsi di un
 * guasto, che dice «non riesco a lavorare» e non «gli esiti non parlano più di
 * questo contenuto».
 */
export function testoEsitiDecaduti(decaduti, punta, ramo = '') {
  const righe = (Array.isArray(decaduti) ? decaduti : [])
    .map((d) => `  ${d.quale} ha dato l'ok su ${String(d.sha).slice(0, 12)}`);
  const p = String(punta || '').slice(0, 12);
  const r = String(ramo || '<ramo>');
  return 'fusione non chiesta: il ramo si è mosso dopo i via libera, che valgono per il contenuto esaminato e non per il nome del ramo.\n'
    + `${righe.join('\n')}\n`
    + `  la directory adesso è su ${p}\n`
    + 'Quello che verrebbe fuso contiene righe che nessuno ha letto: il giro va rifatto su questo contenuto, non chiuso.\n'
    + 'Non fermarti qui. Finché la notizia resta su questa macchina, sul canale i due via libera continuano a risultare buoni per questo ramo. Registrala rimettendo il lavoro in verifica sul contenuto nuovo:\n'
    + `  node scripts/routine-channel.mjs deliver status --status revision_capability --branch ${r} --notes "il ramo si è mosso dopo i via libera: verifica e controllo di sicurezza vanno rifatti su ${p}"\n`
    + 'Se il server rifiuta quel passaggio, dichiaralo nel rilascio del biglietto con --guasto e la stessa frase: quello che non è registrato non è successo.';
}

/**
 * Quali dei due via libera NON hanno un commit scritto accanto, su questa
 * macchina. PURA.
 *
 * Serve a dire COSA non si è potuto controllare, non solo che non si è
 * controllato niente: sapere metà è il caso peggiore dei tre, perché sembra
 * controllato più degli altri. Prima la nota usciva solo quando mancavano
 * tutti e due, e il caso «la verifica ha dato l'ok altrove, il controllo di
 * sicurezza qui» passava in silenzio (feedback #485, giro 3).
 */
export function esitiSenzaCommit(state) {
  const s = state && typeof state === 'object' ? state : {};
  const fuori = [];
  for (const [campo, quale] of [['verifierSha', 'la verifica'], ['secauditSha', 'il controllo di sicurezza']]) {
    if (!String(s[campo] || '')) fuori.push(quale);
  }
  return fuori;
}

/** La nota di astensione, per quello che qui non risulta. PURA. '' se risulta tutto. */
export function testoEsitiSenzaCommit(quali) {
  const l = Array.isArray(quali) ? quali.filter(Boolean) : [];
  if (!l.length) return '';
  if (l.length > 1) {
    return '[merge-gate] nota: da questa macchina non risulta su quale commit sono stati dati i via libera, quindi non ho potuto controllare che parlino di questo contenuto. Decide il server.';
  }
  const altro = l[0] === 'la verifica' ? 'il controllo di sicurezza' : 'la verifica';
  return `[merge-gate] nota: da questa macchina non risulta su quale commit ha dato l'ok ${l[0]}, quindi non ho potuto controllare che parli di questo contenuto — ${altro} l'ho controllato, ed è su questo contenuto. Metà controllo non è un controllo: decide il server.`;
}

/**
 * Il contenuto esaminato è arrivato DOVE CHI FONDE ANDRÀ A PRENDERLO? PURA
 * rispetto a git (`g` è l'esecutore, iniettabile dai test).
 *
 * Il server non fonde quello che c'è in questa directory: scarica il ramo da
 * GitHub e fonde quello. Se un commit è rimasto solo qui — il salvataggio
 * automatico prova a spedire e, quando non ci riesce, per costruzione lo scrive
 * nei log e prosegue — i via libera parlano di un contenuto che non atterrerà
 * mai, e ad atterrare sarà quello vecchio, che nessuno ha esaminato. È il
 * gemello del rifiuto per le modifiche non salvate: lì la punta si sposta in
 * avanti dopo l'ok, qui non si è mai mossa dove conta (feedback #485, giro 3).
 *
 * @returns {{ stato:'pubblicato'|'assente'|'sconosciuto'|'senza_origine', suOrigin?:string, motivo?:string }}
 */
export function statoPubblicazione(g, branch, punta) {
  const b = String(branch || '');
  const p = String(punta || '');
  if (!b || !p) return { stato: 'sconosciuto', motivo: 'ramo o commit assenti' };
  const remoti = g(['remote']);
  if (!remoti.ok) return { stato: 'sconosciuto', motivo: 'non riesco a farmi dire se c\'è un origin' };
  if (!String(remoti.out || '').split(/\r?\n/).map((r) => r.trim()).includes('origin')) return { stato: 'senza_origine' };
  // Il riferimento locale a origin può essere vecchio: si aggiorna quello solo,
  // e se la rete non risponde si prosegue con quello che c'è (dirlo, più sotto,
  // è meglio che fermare un giro per una rete lenta).
  g(['fetch', '--quiet', 'origin', `refs/heads/${b}:refs/remotes/origin/${b}`]);
  const ref = g(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${b}`]);
  if (!ref.ok || !ref.out) return { stato: 'sconosciuto', motivo: `su origin il ramo ${b} non si legge` };
  const dentro = g(['merge-base', '--is-ancestor', p, ref.out]);
  return dentro.ok ? { stato: 'pubblicato', suOrigin: ref.out } : { stato: 'assente', suOrigin: ref.out };
}

/** Il rifiuto per un contenuto esaminato che su origin non c'è. PURA. */
export function testoNonPubblicato(punta, suOrigin, ramo = '') {
  const p = String(punta || '').slice(0, 12);
  const o = String(suOrigin || '').slice(0, 12);
  const r = String(ramo || '<ramo>');
  return 'fusione non chiesta: il contenuto esaminato non è arrivato su origin, e chi fonde non prende quello che c\'è in questa directory: scarica il ramo da lì.\n'
    + `  qui i via libera valgono per ${p}\n`
    + `  su origin il ramo ${r} è fermo a ${o}\n`
    + 'Quello che verrebbe fuso è il contenuto vecchio, che nessuno ha esaminato, e la correzione non ci sarebbe nemmeno.\n'
    + `Spedisci il ramo e rilancia lo stesso comando: git push origin ${r}\n`
    + 'Se il push non riesce, dichiaralo nel rilascio del biglietto con --guasto e la stessa frase: quello che non è registrato non è successo.';
}

export function exitCodeFor(reply) {
  const r = reply || {};
  if (r.ok === true && r.result === 'merged') return 0;
  if (r.ok === true && r.result === 'blocked') return 10;
  if (r.ok === true && r.result === 'conflict') return 20;
  return 1;
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const USO = [
  'Uso: node scripts/merge-gate.mjs <ramo>',
  '  Chiede al SERVER di fondere <ramo> su main: lui scarica il diff, fa girare',
  '  i controlli e fonde con la sua identità. Qui non ci sono opzioni.',
  '  Serve il biglietto del giro, che si rilegge da solo dal promemoria.',
  '  La richiesta dichiara il COMMIT: se il ramo si è mosso dopo i via libera,',
  '  o se nella directory c\'è qualcosa fuori dai commit, non parte.',
  '  Exit: 0 fuso · 10 fermato dal cancello di sicurezza (decide l’owner)',
  '        20 conflitto · 1 uso sbagliato, ramo mosso dopo i via libera,',
  '           o rifiuto del server',
].join('\n');

async function main() {
  const { source, unknown } = parseArgs(process.argv.slice(2));
  // Chiedere aiuto a uno strumento è il primo gesto di chi verifica: qui si
  // sentiva rispondere «opzione sconosciuta» e basta, ed era l'ultimo rimasto
  // (feedback #565).
  const argomenti = process.argv.slice(2).map((a) => String(a).toLowerCase());
  // La parola nuda «help» NO: qui il posizionale è un nome di ramo, e uscire 0
  // senza aver fuso è peggio del non stampare l'aiuto.
  if (argomenti.some((a) => ['--help', '-help', '-h', '--h', '/h', '/help', '/?'].includes(a))) {
    console.log(USO);
    console.log('Non ho toccato niente.');
    process.exit(0);
  }
  if (unknown.length) {
    console.error(`opzioni sconosciute: ${unknown.join(' ')} (il gate non prende più flag: il merge lo fa il server)`);
    console.error(USO);
    process.exit(1);
  }
  if (!source) { console.error(USO); process.exit(1); }
  if (!isValidBranch(source)) { console.error(`branch sorgente non valido: "${source}"`); process.exit(1); }

  // Il biglietto del giro: senza, questa richiesta non ha un lavoro a cui
  // riferirsi e il server non saprebbe (giustamente) di cosa parliamo.
  const ticket = readTicket(ROOT);
  if (!ticket) {
    console.error('[merge-gate] ERROR: nessun biglietto di giro trovato — la fusione passa dal canale e serve il biglietto del lavoro.');
    process.exit(1);
  }

  // Il CONTENUTO che si sta per far fondere. Da qui in poi il nome del ramo
  // serve solo a dire quale ramo è: a decidere è il commit (feedback #485).
  // Se git non risponde ci si ferma, come fa la registrazione di un verdetto:
  // il silenzio non vale «va tutto bene».
  const punta = headSha(ROOT);
  if (!punta) {
    console.error('[merge-gate] ERROR: non riesco a farmi dire su quale commit è la directory, e i via libera valgono per un commit. Sistema git e rilancia.');
    process.exit(1);
  }
  // Niente fuori dai commit: quei file il salvataggio automatico li committa e
  // li spedisce subito dopo, il server fonde la punta NUOVA, e righe mai lette
  // arrivano agli utenti. La registrazione del verdetto, un passo prima, lo
  // rifiuta già; questo è lo stesso rifiuto all'ultimo passo.
  const stato = statoDirectory(ROOT);
  if (!stato.ok) {
    console.error(statoIllegibileText(stato.motivo, 'fusione'));
    process.exit(1);
  }
  if (stato.lines.length) {
    console.error(dirtyTreeText(stato.lines, 'fusione'));
    process.exit(1);
  }
  // I via libera già registrati su questa macchina parlano ancora di questo
  // contenuto? Il muro vero resta il server, che risolve la punta da GitHub;
  // questo è il controllo che si può fare qui, e che sul cammino locale
  // (`npm run finish`) c'è da sempre.
  const statoRamo = (() => {
    const id = findStateIdByBranch(ROOT, source);
    return id ? readBranchState(ROOT, id) : null;
  })();
  const decaduti = esitiDecaduti(statoRamo, punta);
  if (decaduti.length) {
    console.error(testoEsitiDecaduti(decaduti, punta, source));
    process.exit(1);
  }
  // Astenersi si dice: se da qui non risulta nessun via libera con il suo
  // commit, il controllo non l'ho fatto, e chi legge il registro non deve
  // credere il contrario.
  const nessunCommitScritto = !String((statoRamo || {}).verifierSha || '') && !String((statoRamo || {}).secauditSha || '');
  if (nessunCommitScritto) {
    console.error('[merge-gate] nota: da questa macchina non risulta su quale commit sono stati dati i via libera, quindi non ho potuto controllare che parlino di questo contenuto. Decide il server.');
  }

  const reply = await merge(ticket, source, { sha: punta });
  const code = exitCodeFor(reply);
  if (code === 0) console.log(`[merge-gate] OK: ${source} fuso su main dal server${reply.sha ? ` (${reply.sha.slice(0, 12)})` : ''}`);
  else if (code === 10) {
    console.error(`[merge-gate] BLOCKED: ${reply.reason || 'cancello di sicurezza'}`);
    // Il blocco non è più un vicolo cieco: il server apre una richiesta che
    // l'owner trova in cima alla dashboard di gestione. Dirlo qui evita che
    // chi legge il registro creda che il ramo sia perduto.
    if (reply.approval) console.error('[merge-gate] il ramo aspetta il via libera dell’owner nella dashboard di gestione');
  }
  else if (code === 20) console.error(`[merge-gate] CONFLICT: ${reply.reason || 'serve risoluzione manuale'}`);
  else console.error(`[merge-gate] ERROR: ${reply.reason || 'guasto'}`);
  process.exit(code);
}

// Esegui solo se invocato come script (non quando importato dai test).
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
