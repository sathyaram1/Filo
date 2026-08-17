// Applicatore sottile dell'archiviazione automatica a punteggio (DC3).
//
// COSA FA
//   Legge i feedback da Firestore (FB.list, pubblica), calcola con la logica
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const require = createRequire(import.meta.url);

// Carica i moduli IIFE su globalThis: feedback.js (FB.list/tallyVotes),
// manageReview.js (isShipped, DB3), boardArchive.js (la decisione, DC3).
require(resolve(ROOT, 'src', 'shared', 'feedback.js'));
require(resolve(ROOT, 'src', 'shared', 'manageReview.js'));
require(resolve(ROOT, 'src', 'shared', 'boardArchive.js'));

const FB = globalThis.SN_FEEDBACK;
const BA = globalThis.SN_BOARD_ARCHIVE;

function packageVersion() {
  try {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
    return pkg.version || '';
  } catch (_) {
    return '';
  }
}

export async function runAutoArchive({ dryRun = false, now = Date.now(), releasedVersion } = {}) {
  const ver = releasedVersion || packageVersion();
  const feedbacks = await FB.list({ pageSize: 500 });
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

  return { releasedVersion: ver, toArchive: archivedDetails, toFlag, dryRun };
}

const isMain = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMain) {
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
}
