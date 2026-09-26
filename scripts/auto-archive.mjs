// Applicatore sottile dell'archiviazione automatica a punteggio (DC3).
//
// COSA FA
//   Legge i feedback da Firestore con le credenziali dell'owner (#583: la
//   collezione non è più pubblica) e ci riunisce i voti, che vivono sulle
//   schede pubbliche; calcola con la logica
//   PURA di src/shared/boardArchive.js (SN_BOARD_ARCHIVE.applyAutoArchive)
//   chi va archiviato e chi va solo segnalato come "gli utenti dicono che non
//   va", e per ognuno da archiviare scrive `archived` DIRETTAMENTE, con le
//   credenziali dell'owner: è una sua decisione delegata a un punteggio, non
//   una consegna di routine, e la coda su git non esiste più.
//
//   La decisione PURA (chi archiviare, chi segnalare) è in boardArchive.js ed
//   è interamente unit-testata in tests/unit/boardArchive.test.mjs. Questo
//   script è solo il "filo" che la collega a: 1) la lettura rete dei feedback
//   con voti, 2) `releasedVersion` (versione corrente di package.json, stessa
//   fonte del numero di versione), 3) la scrittura diretta sul feedback.
//
// USO:
//   node scripts/auto-archive.mjs              archivia e stampa il riepilogo
//   node scripts/auto-archive.mjs --dry-run    mostra solo cosa farebbe, non scrive nulla
//
// COSA NON FA (di proposito, fuori scope DC3):
//   - non costruisce/renderizza il badge owner "gli utenti dicono che non va"
//     in dashboard (manage.js) — espone solo `toFlag` qui e
//     SN_BOARD_ARCHIVE.usersSayBroken come substrato pronto all'uso;
//   - non implementa l'azione owner che imposta `archiveOverride` (quella vive
//     in manage.js, toggleArchive — già wired in questo stesso lavoro DC3).

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
// L'auto-archiviazione è una decisione dell'OWNER delegata a un punteggio, non
// una consegna di routine: scrive con le sue credenziali, direttamente.
import { scrivi } from './owner-feedback.mjs';
// #583: leggere i feedback vuole le credenziali dell'owner (le stesse con cui
// questo script scrive), e i voti stanno sulle schede pubbliche.
import { acquireBearer } from './lib/firestore-auth.mjs';
import { contatoreLetture } from './lib/letture.mjs';
import { scansione, dopoApplicazione } from './lib/scansione-secco.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const require = createRequire(import.meta.url);

// Carica i moduli IIFE su globalThis: feedback.js (FB.list/tallyVotes),
// manageReview.js (isShipped, DB3), boardArchive.js (la decisione, DC3).
require(resolve(ROOT, 'src', 'shared', 'feedback.js'));
require(resolve(ROOT, 'src', 'shared', 'manageReview.js'));
require(resolve(ROOT, 'src', 'shared', 'boardArchive.js'));
require(resolve(ROOT, 'src', 'shared', 'feedbackPublicView.js'));

const FB = globalThis.SN_FEEDBACK;
const BA = globalThis.SN_BOARD_ARCHIVE;
const PV = globalThis.SN_FEEDBACK_PUBLIC_VIEW;

function packageVersion() {
  try {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
    return pkg.version || '';
  } catch (_) {
    return '';
  }
}

// ── Cosa si scarica per DECIDERE ─────────────────────────────────────────────
// La decisione guarda cinque campi (SN_BOARD_ARCHIVE.CAMPI_DECISIONE) e il
// numero leggibile serve solo alla riga che si stampa. Un feedback pesa qualche
// KB per testo cifrato, note e allegati: scaricarlo intero per guardarne sette
// campi è il conto di Firestore di settembre 2026 (#680).
const CAMPI_SEGNALAZIONI = [...BA.CAMPI_DECISIONE, 'seq', 'subSeq'];

// Il nome con cui la lettura di questo giro si mette da parte (lib/scansione-secco).
const COPIA = 'auto-archive/segnalazioni';

// `bearer`: il token, se chi chiama ce l'ha già. Serve solo alla lettura, quindi
// quando le righe arrivano dalla copia non si chiede a nessuno.
export async function runAutoArchive({
  dryRun = false, now = Date.now(), releasedVersion, copiaDir = null, usaCopia = true, bearer = '',
} = {}) {
  const ver = releasedVersion || packageVersion();
  const letture = contatoreLetture();

  const { dati } = await scansione({
    nome: COPIA, dry: dryRun, now, dir: copiaDir, usaCopia,
    scansiona: async () => {
      const token = bearer || await acquireBearer();
      // TUTTE le segnalazioni, paginate. Una finestra sulle 500 più recenti per
      // data d'invio lasciava fuori le più vecchie, che sono esattamente quelle che
      // questo giro dovrebbe archiviare per prime: i loro fix non uscivano mai
      // dalla bacheca, restavano votabili e riapribili a pagamento, e per loro non
      // si accendeva nemmeno «gli utenti dicono che non va». Con 711 segnalazioni
      // ne restavano fuori 211, e il numero cresceva da solo.
      const r = typeof FB.listAllPaged === 'function'
        ? await FB.listAllPaged({ idToken: token, fields: CAMPI_SEGNALAZIONI })
        : { rows: await FB.list({ pageSize: 500, idToken: token, fields: CAMPI_SEGNALAZIONI }), complete: false };
      const grezzi = r.rows;
      const complete = r.complete;
      letture.aggiungi(grezzi.length, 'segnalazioni');
      // I voti (DB4) si scrivono sulla scheda pubblica: senza riunirli, il
      // punteggio sarebbe quello dei soli voti storici e non archivierebbe più
      // niente. Della scheda servono SOLO i campi degli utenti (voti e richieste
      // di riapertura): è l'unica cosa che `mergeUserFields` guarda.
      // TUTTE le schede, paginate: i voti stanno lì, e una finestra sulle 500 più
      // recenti per data d'invio lascerebbe senza voti proprio le segnalazioni più
      // vecchie — quelle che questo giro dovrebbe archiviare per prime.
      const cards = typeof FB.listAllPublic === 'function'
        ? await FB.listAllPublic({ fields: [...PV.USER_FIELDS] })
        : await FB.listPublic({ pageSize: 500, fields: [...PV.USER_FIELDS] });
      letture.aggiungi(cards.length, 'schede');
      return { righe: PV.mergeUserFields(grezzi, cards), complete };
    },
  });
  const feedbacks = Array.isArray(dati && dati.righe) ? dati.righe : [];
  const complete = !(dati && dati.complete === false);
  // L'avviso sta FUORI dalla scansione: vale anche quando le righe arrivano
  // dalla copia, o un giro riusato deciderebbe su un elenco parziale in silenzio.
  if (!complete) {
    console.warn('AVVISO: non sono riuscito a leggere TUTTE le segnalazioni: '
      + `questo giro decide su ${feedbacks.length}, le più vecchie restano fuori.`);
  }
  const { toArchive, toFlag } = BA.applyAutoArchive(feedbacks, { now, releasedVersion: ver });

  const archivedDetails = [];
  for (const id of toArchive) {
    const fb = feedbacks.find((f) => f._id === id);
    const { score } = FB.tallyVotes(fb && fb.votes);
    const note = `auto-archiviato (DC3): punteggio ${score} dopo 24h+ dalla messa in produzione (${ver || 'n/d'}).`;
    archivedDetails.push({ id, num: fb ? FB.formatNum(fb.seq, fb.subSeq) : '', score, note });
    if (!dryRun) {
      const r = await scrivi(id, 'archived', note, { attore: 'owner' });
      if (!r.ok) console.warn(`  ! ${id} non archiviato: ${r.motivo}`);
    }
  }

  // Tenere la copia dopo un'applicazione vorrebbe dire far ripartire un secondo
  // giro sui feedback già archiviati.
  dopoApplicazione(COPIA, { dry: dryRun, usaCopia, dir: copiaDir });

  return {
    releasedVersion: ver, toArchive: archivedDetails, toFlag, dryRun, complete,
    letture: letture.totale, rigaLetture: letture.riga(),
  };
}

const isMain = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  // Un'opzione che non riconosciamo non deve far partire il giro VERO: basta
  // un trattino o una lettera sbagliati in «--dry-run» perché quello che
  // doveva essere un giro a vuoto scriva davvero (feedback #565).
  if (process.argv.slice(2).some((a) => a === '--help' || a === '-h')) {
    console.log('Uso: node scripts/auto-archive.mjs [--dry-run]\n  archivia i feedback risolti oltre la soglia; --dry-run mostra solo cosa farebbe');
    process.exit(0);
  }
  const { controllaArgomenti, argomentiDaNpm, opzioneStorpiata } = await import('./lib/argomenti.mjs');
  // npm si mangia le opzioni scritte prima dei due trattini (e su PowerShell
  // anche quelle scritte dopo): le riprendiamo dall'ambiente, invece di fare
  // la cosa vera a chi aveva chiesto un giro a vuoto (feedback #565).
  const storpiata = opzioneStorpiata(process.env, ['--dry-run']);
if (storpiata) { console.error(`RIFIUTATO: ${storpiata}`); process.exit(1); }
const daNpm = argomentiDaNpm(process.env, { opzioni: ['--dry-run'] });
  if (daNpm.nota) { console.error(daNpm.nota); process.argv.push(...daNpm.args); }
  const male = controllaArgomenti(process.argv.slice(2), { opzioni: ['--dry-run'], senzaParoleLibere: true });
  if (male) {
    console.error(`RIFIUTATO: ${male}`);
    process.exit(1);
  }
  const dryRun = process.argv.includes('--dry-run');
  const result = await runAutoArchive({ dryRun });
  console.log(`Versione rilasciata di riferimento: ${result.releasedVersion || '(nessuna — gate DB3 inattivo, nessuna archiviazione)'}`);
  if (!result.toArchive.length) {
    console.log('Nessun feedback raggiunge la soglia di auto-archiviazione.');
  } else {
    console.log(`${dryRun ? '[dry-run] ' : ''}Da archiviare (${result.toArchive.length}):`);
    for (const a of result.toArchive) console.log(`  - ${a.num || a.id} (score ${a.score})${dryRun ? '' : ' → accodato'}`);
  }
  if (result.toFlag.length) {
    console.log(`Segnalati come "gli utenti dicono che non va" (${result.toFlag.length}, NON archiviati né riaperti): ${result.toFlag.join(', ')}`);
  }
  // Il costo del giro sullo schermo, non in fattura.
  console.log(result.rigaLetture);
}
