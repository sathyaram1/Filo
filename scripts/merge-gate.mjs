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
//   server, non una correzione silenziosa. E dev'essere anche quello su cui
//   sta la directory, perché è da lì che si leggono i file fuori dai commit,
//   la punta e gli esiti registrati (#485).
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

import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pinnedRepoRoot, absolutizeRecipe, TOOLS_ROOT } from './lib/tools-pin.mjs';
import { merge } from './routine-channel.mjs';
import { readTicket } from './lib/routine-ticket.mjs';
import { headSha, currentBranch, findStateIdByBranch, readBranchState } from './lib/branch-integrity.mjs';
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
 * Il via libera del controllo di sicurezza, se parla di un altro commit (#485). PURA.
 * Quello della verifica lo giudica il server: tollera le sole prove del giro tolte e
 * altrimenti rimanda il verificatore; un rifiuto qui fermava il lavoro per sempre.
 */
export function esitiDecaduti(state, punta) {
  const s = state && typeof state === 'object' ? state : {};
  const p = String(punta || '');
  const sha = String(s.secauditSha || '');
  return p && sha && sha !== p ? [{ quale: 'il controllo di sicurezza', sha }] : [];
}

/** La nota per una verifica data su un commit più vecchio della punta. PURA. '' se non serve. */
export function notaVerificaSuAltroCommit(state, punta) {
  const s = state && typeof state === 'object' ? state : {};
  const v = String(s.verifierSha || '');
  const p = String(punta || '');
  if (!v || !p || v === p) return '';
  return `[merge-gate] nota: la verifica ha dato l'ok su ${v.slice(0, 12)}, la punta è ${p.slice(0, 12)}. Lo giudica il server: `
    + 'se dopo il verdetto sono state solo TOLTE prove del giro, fonde; altrimenti azzera il verdetto e rimanda un '
    + 'verificatore da sé, e qui arriva un rifiuto (not_approved). In quel caso non c\'è altro da registrare: rilascia il biglietto.';
}

/**
 * Il rifiuto per un controllo di sicurezza dato su un altro commit. PURA.
 * Il rimedio è rileggere il pezzo nuovo e registrare di nuovo il verdetto: il ritorno
 * in verifica, al controllo di sicurezza, il server non lo concede.
 */
export function testoEsitiDecaduti(decaduti, punta, ramo = '', id = '') {
  const righe = (Array.isArray(decaduti) ? decaduti : [])
    .map((d) => `  ${d.quale} ha dato l'ok su ${String(d.sha).slice(0, 12)}`);
  const primo = (Array.isArray(decaduti) ? decaduti : [])[0];
  const da = primo ? String(primo.sha).slice(0, 12) : '<commit controllato>';
  const p = String(punta || '').slice(0, 12);
  const r = String(ramo || '<ramo>');
  const i = String(id || '<id>');
  return 'fusione non chiesta: il ramo si è mosso dopo il tuo controllo di sicurezza, che vale per il contenuto esaminato e non per il nome del ramo.\n'
    + `${righe.join('\n')}\n`
    + `  la directory adesso è su ${p} (ramo ${r})\n`
    + 'Quello che verrebbe fuso contiene righe che non hai letto. Leggile adesso, per intero:\n'
    + `  git diff ${da} ${p}\n`
    + 'Poi registra di nuovo il verdetto, che parte timbrato col contenuto nuovo (nella nota scrivi anche cosa hai letto in più):\n'
    + `  node scripts/dispatch.mjs --record-secaudit ${i} <pass|fail> --nota <file.md>\n`
    + 'e, se è pass, rilancia questo comando. La verifica funzionale non la rifai tu: se il pezzo nuovo non è fatto solo di prove del giro tolte, il server la rimette in giro da sé quando chiedi la fusione.';
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
 * Quello che chi fonde troverà in cima al ramo È il contenuto esaminato? PURA
 * rispetto a git (`g` è l'esecutore, iniettabile dai test).
 *
 * Il server non fonde quello che c'è in questa directory: scarica il ramo da
 * GitHub e fonde la sua PUNTA. Quindi la domanda ha una risposta sola, ed è
 * un'uguaglianza. «Il contenuto esaminato è arrivato là» non basta: un commit
 * può essere nella storia del ramo senza essere quello che atterra, e allora
 * ad atterrare è il commit in cima, che nessuno ha guardato (feedback #485,
 * giro 4). È la stessa uguaglianza che il cammino locale pretende da sempre
 * («su origin il ramo è a X, qui siamo a Y: il server fonderebbe una versione
 * diversa da quella controllata»), e che qui era diventata un contenimento.
 *
 * Le due direzioni sono danni diversi e vogliono rimedi opposti:
 *   `indietro` — il contenuto esaminato non è mai arrivato là (il salvataggio
 *     automatico prova a spedire e, quando non ci riesce, per costruzione lo
 *     scrive nei log e prosegue): si spedisce il ramo;
 *   `piu_avanti` — là il ramo è andato oltre il contenuto esaminato: spedire
 *     non c'entra, gli esiti sono decaduti e il giro va rifatto su quel
 *     contenuto.
 *
 * La punta vera la dice `ls-remote`, che parla col posto giusto: il riferimento
 * locale a origin dice dov'ERA il ramo l'ultima volta che si è guardato, e
 * concludere da lì è rispondere a memoria a una domanda sul presente.
 *
 * @returns {{ stato:'pubblicato'|'indietro'|'piu_avanti'|'sconosciuto'|'senza_origine', suOrigin?:string, motivo?:string }}
 */
export function statoPubblicazione(g, branch, punta) {
  const b = String(branch || '');
  const p = String(punta || '');
  if (!b || !p) return { stato: 'sconosciuto', motivo: 'ramo o commit assenti' };
  const remoti = g(['remote']);
  if (!remoti.ok) return { stato: 'sconosciuto', motivo: 'non riesco a farmi dire se c\'è un origin' };
  if (!String(remoti.out || '').split(/\r?\n/).map((r) => r.trim()).includes('origin')) return { stato: 'senza_origine' };
  // La punta vera, chiesta a origin. Se non risponde ci si astiene e lo si
  // dice: un controllo che conclude su un ricordo vecchio è peggio di uno
  // assente, perché chi legge crede di essere protetto.
  const ls = g(['ls-remote', '--heads', 'origin', `refs/heads/${b}`]);
  if (!ls.ok) return { stato: 'sconosciuto', motivo: `non riesco a farmi dire da origin dov'è il ramo ${b} (${String(ls.out || '').split(/\r?\n/)[0] || 'nessuna risposta'})` };
  const riga = String(ls.out || '').split(/\r?\n/).map((r) => r.trim()).filter(Boolean)[0] || '';
  const suOrigin = riga.split(/\s+/)[0] || '';
  // Il ramo su origin non c'è: non è «non lo so», è «là non c'è niente da
  // fondere», e il rimedio è lo stesso del contenuto rimasto qui.
  if (!suOrigin) return { stato: 'indietro', suOrigin: '' };
  if (suOrigin === p) return { stato: 'pubblicato', suOrigin };
  // Le due versioni sono diverse: per dire in che senso serve l'oggetto, e per
  // averlo si aggiorna il riferimento locale (col `+`, o un ramo riportato
  // indietro su origin farebbe fallire l'aggiornamento invece di seguirlo).
  g(['fetch', '--quiet', 'origin', `+refs/heads/${b}:refs/remotes/origin/${b}`]);
  if (!g(['cat-file', '-e', `${suOrigin}^{commit}`]).ok) {
    return { stato: 'sconosciuto', suOrigin, motivo: `su origin il ramo ${b} è su un contenuto che qui non ho, e non riesco a scaricarlo` };
  }
  const dentro = g(['merge-base', '--is-ancestor', p, suOrigin]);
  return dentro.ok ? { stato: 'piu_avanti', suOrigin } : { stato: 'indietro', suOrigin };
}

/**
 * Come `gitIn`, ma con un tetto sul tempo: qui si parla anche con la rete, e
 * un comando appeso all'ultimo passo del giro tiene fermo il lavoro senza
 * dirlo. Scaduto il tetto l'esito è un `ok:false`, che più in su diventa «non
 * l'ho potuto controllare»: una risposta, non un silenzio.
 */
export function gitConTetto(root, ms = 30000) {
  return function git(args) {
    try {
      return { ok: true, out: String(execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: ms }) || '').trim() };
    } catch (e) {
      return { ok: false, out: `${(e && e.stdout) || ''}${(e && e.stderr) || ''}`.trim() || String((e && e.message) || e) };
    }
  };
}

/** Il rifiuto per un contenuto esaminato che su origin non c'è. PURA. */
export function testoNonPubblicato(punta, suOrigin, ramo = '') {
  const p = String(punta || '').slice(0, 12);
  const o = String(suOrigin || '').slice(0, 12);
  const r = String(ramo || '<ramo>');
  return 'fusione non chiesta: il contenuto esaminato non è arrivato su origin, e chi fonde non prende quello che c\'è in questa directory: scarica il ramo da lì.\n'
    + `  qui i via libera valgono per ${p}\n`
    + (o ? `  su origin il ramo ${r} è fermo a ${o}\n` : `  su origin il ramo ${r} non c'è proprio\n`)
    + 'Quello che verrebbe fuso è il contenuto vecchio, che nessuno ha esaminato, e la correzione non ci sarebbe nemmeno.\n'
    // Sorgente E destinazione, come ogni altro push del progetto: `origin <ramo>`
    // lascia scegliere l'arrivo alla configurazione locale di git, che è un file
    // non versionato — e un comando che si copia da un rifiuto vale quanto uno
    // scritto in uno script.
    + `Spedisci il ramo e rilancia lo stesso comando: git push origin ${r}:${r}\n`
    + 'Se il push non riesce, dichiaralo nel rilascio del biglietto con --guasto e la stessa frase: quello che non è registrato non è successo.';
}

/**
 * Il rifiuto per un ramo che su origin è andato OLTRE il contenuto esaminato. PURA.
 * Chi fonde prende la punta di origin (#485): la directory la raggiunge, e il pezzo in più si legge prima di fondere.
 */
export function testoPiuAvanti(punta, suOrigin, ramo = '') {
  const p = String(punta || '').slice(0, 12);
  const o = String(suOrigin || '').slice(0, 12);
  const r = String(ramo || '<ramo>');
  return 'fusione non chiesta: su origin il ramo è più avanti del contenuto esaminato, e chi fonde prende la PUNTA del ramo, non quello che c\'è in questa directory.\n'
    + `  qui i via libera valgono per ${p}\n`
    + `  su origin il ramo ${r} è in cima a ${o}\n`
    + 'Quello che verrebbe fuso è il contenuto in cima, che qui non è stato esaminato. Non spedire niente e non riportare indietro il ramo: là c\'è lavoro che qui non c\'è, e sovrascriverlo lo butterebbe via.\n'
    + 'Porta la directory su quel contenuto e rilancia questo comando, che ti dirà cosa rileggere:\n'
    + `  git merge --ff-only ${o}\n`
    + 'Se il merge non va avanti da solo (le due storie si sono separate), dichiaralo nel rilascio del biglietto con --guasto e questa frase: quello che non è registrato non è successo.';
}

/**
 * Il rifiuto per un ramo nominato che non è quello su cui sta la directory.
 * PURA.
 *
 * Tutto quello che questo strumento controlla lo legge dalla directory: i file
 * fuori dai commit, la punta, i via libera registrati. Se il nome sulla riga di
 * comando è di un altro ramo, quei controlli parlano di una cosa e la richiesta
 * ne nomina un'altra, e la versione dichiarata è di un ramo che non c'entra.
 * Fermarsi qui non è pignoleria: è l'unica posizione da cui i controlli dopo
 * hanno un senso.
 */
export function testoRamoDiverso(nominato, corrente) {
  const n = String(nominato || '<ramo>');
  const c = String(corrente || '');
  return `fusione non chiesta: mi hai nominato il ramo ${n.slice(0, 80)}${n.length > 80 ? '…' : ''}, ma questa directory sta ${c ? `sul ramo ${c}` : 'su nessun ramo (testa staccata)'}.\n`
    + 'Tutto quello che controllo prima di chiedere la fusione lo leggo da qui: i file fuori dai commit, la versione, su quale contenuto sono stati dati i via libera. Con due rami diversi quei controlli parlano di uno e la richiesta nomina l\'altro, e la versione che dichiarerei sarebbe di un ramo che non c\'entra.\n'
    + 'Posizionati sul ramo del lavoro e rilancia, oppure nomina il ramo su cui sei.';
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
  '  <ramo> dev\'essere quello su cui sta la directory: da lì si legge tutto.',
  '  La richiesta dichiara il COMMIT: se il ramo si è mosso dopo i via libera,',
  '  se nella directory c\'è qualcosa fuori dai commit, o se in cima al ramo su',
  '  origin (da dove il server lo prende) non c\'è il contenuto esaminato, non parte.',
  '  Exit: 0 fuso · 10 fermato dal cancello di sicurezza (decide l’owner)',
  '        20 conflitto · 1 uso sbagliato, ramo diverso da quello della directory,',
  '           ramo mosso dopo i via libera, contenuto che non è quello in cima',
  '           su origin, o rifiuto del server',
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

  // Il ramo nominato dev'essere quello su cui sta la directory: tutti i
  // controlli qui sotto la leggono da qui, e con due rami diversi parlerebbero
  // di uno mentre la richiesta nomina l'altro (feedback #485, giro 4).
  const corrente = currentBranch(ROOT);
  if (corrente !== source) {
    console.error(testoRamoDiverso(source, corrente));
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
  const idStato = findStateIdByBranch(ROOT, source);
  const statoRamo = idStato ? readBranchState(ROOT, idStato) : null;
  const decaduti = esitiDecaduti(statoRamo, punta);
  if (decaduti.length) {
    // I comandi del rimedio con gli attrezzi del GIRO, non con quelli che il
    // ramo si porta dietro: `scripts/…` qui dentro è la copia del ramo, che può
    // essere vecchia di giorni e non fare quello che chi legge crede.
    console.error(absolutizeRecipe(testoEsitiDecaduti(decaduti, punta, source, idStato || ''), TOOLS_ROOT, ROOT));
    process.exit(1);
  }
  const notaVerifica = notaVerificaSuAltroCommit(statoRamo, punta);
  if (notaVerifica) console.error(notaVerifica);
  // Astenersi si dice, e si dice PER CIASCUNO dei due: se di uno non risulta il
  // commit, quel via libera non l'ho controllato, e chi legge il registro non
  // deve credere il contrario perché l'altro tornava.
  const senzaCommit = testoEsitiSenzaCommit(esitiSenzaCommit(statoRamo));
  if (senzaCommit) console.error(senzaCommit);

  // In cima al ramo, dove chi fonde va a prendere, dev'esserci il contenuto
  // esaminato: un'uguaglianza, non un «c'è arrivato». Il tetto sul tempo c'è
  // perché qui dentro si parla con la rete, e questo è l'ultimo passo del giro:
  // una rete che non risponde deve diventare «non l'ho potuto controllare» in
  // mezzo minuto, non un comando appeso.
  const pubblicazione = statoPubblicazione(gitConTetto(ROOT), source, punta);
  if (pubblicazione.stato === 'indietro') {
    console.error(testoNonPubblicato(punta, pubblicazione.suOrigin, source));
    process.exit(1);
  }
  if (pubblicazione.stato === 'piu_avanti') {
    // Il rimedio con gli attrezzi del GIRO, come l'altro rifiuto che nomina un
    // comando: `scripts/…` qui dentro è la copia del ramo.
    console.error(absolutizeRecipe(testoPiuAvanti(punta, pubblicazione.suOrigin, source), TOOLS_ROOT, ROOT));
    process.exit(1);
  }
  if (pubblicazione.stato === 'sconosciuto') {
    console.error(`[merge-gate] nota: non ho potuto controllare che in cima al ramo su origin ci sia il contenuto esaminato (${pubblicazione.motivo}), e chi fonde prende da lì la punta del ramo. Decide il server.`);
  }
  if (pubblicazione.stato === 'senza_origine') {
    console.error('[merge-gate] nota: in questa directory non c\'è nessun origin, quindi non ho potuto guardare cosa troverà chi fonde. Decide il server.');
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
