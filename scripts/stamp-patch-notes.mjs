#!/usr/bin/env node
// Timbra il blocco "in lavorazione" del changelog con il numero della versione
// che sta uscendo. Lo chiama la release (.github/workflows/release.yml) subito
// dopo `npm version patch`, PRIMA del commit e del build: così la build che
// esce contiene le note della versione che è, e chi aggiorna le vede.
//
// PERCHÉ ESISTE
//   La versione in package.json è quella dell'ULTIMA release già pubblicata.
//   Una nota scritta a mano sotto quel numero è invisibile: chi ha già quella
//   versione la salta (il recap mostra solo le versioni SUCCESSIVE a quella che
//   aveva), e la build che portava quel numero era stata prodotta prima che la
//   nota esistesse. Quindi le note si accumulano in un blocco senza versione e
//   sono i rilasci a dargliene una — quella giusta.
//
// COSA FA
//   - se il blocco "in lavorazione" ha almeno una voce → gli mette
//     `version`/`date` e rimette in cima un blocco "in lavorazione" vuoto;
//   - se è vuoto (rilascio di sola manutenzione: nessuna modifica visibile
//     all'utente) → NON tocca il file ed esce 0. Il changelog resta indietro
//     rispetto a package.json, ed è corretto: non c'è niente da mostrare.
//
// USO
//   node scripts/stamp-patch-notes.mjs <versione> [--file <path>] [--date <YYYY-MM-DD>]

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = join(__dirname, '..', 'src', 'shared', 'patchNotes.js');

// Il blocco "in lavorazione", riconosciuto dalla riga `unreleased: true,`.
const UNRELEASED_RE = /^([ \t]*)\{\n([ \t]*)unreleased: true,\n/m;

function parseArgs(argv) {
  const out = { version: '', file: DEFAULT_FILE, date: '' };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--file') out.file = argv[++i];
    else if (argv[i] === '--date') out.date = argv[++i];
    else rest.push(argv[i]);
  }
  out.version = String(rest[0] || '').replace(/^v/, '');
  if (!out.date) out.date = new Date().toISOString().slice(0, 10);
  return out;
}

// Quante voci ha il blocco in lavorazione: carichiamo il changelog (è un IIFE
// che si registra su globalThis) e lo chiediamo a lui, invece di indovinarlo
// dal testo.
function pendingEntries(file) {
  const abs = resolve(file);
  delete require.cache[abs];
  require(abs);
  const PN = globalThis.SN_PATCH_NOTES;
  if (!PN || typeof PN.pending !== 'function') {
    throw new Error(`${file} non espone SN_PATCH_NOTES.pending()`);
  }
  const p = PN.pending();
  if (!p) return -1; // nessun blocco "in lavorazione": file da migrare a mano
  return (p.features || []).length + (p.fixes || []).length;
}

export function stamp(src, version, date) {
  const m = UNRELEASED_RE.exec(src);
  if (!m) throw new Error('blocco "in lavorazione" (unreleased: true) non trovato');
  const outer = m[1];
  const inner = m[2];
  const fresh = [
    `${outer}// ↓ IN LAVORAZIONE — scrivi qui le note delle modifiche non ancora`,
    `${outer}// rilasciate. La release le timbra con il numero di versione giusto.`,
    `${outer}{`,
    `${inner}unreleased: true,`,
    `${inner}features: [],`,
    `${inner}fixes: [],`,
    `${outer}},`,
    `${outer}{`,
    `${inner}version: '${version}', date: '${date}',`,
    '',
  ].join('\n');
  // Toglie l'eventuale commento "IN LAVORAZIONE" che precedeva il blocco: la
  // versione fresca se lo riporta dietro.
  const head = src.slice(0, m.index).replace(/(?:[ \t]*\/\/ ?↓ IN LAVORAZIONE[^\n]*\n)(?:[ \t]*\/\/[^\n]*\n)*$/, '');
  return head + fresh + src.slice(m.index + m[0].length);
}

async function main() {
  const { version, file, date } = parseArgs(process.argv.slice(2));
  if (!/^\d+\.\d+\.\d+/.test(version)) {
    console.error('uso: node scripts/stamp-patch-notes.mjs <versione> [--file path] [--date YYYY-MM-DD]');
    process.exit(2);
  }
  const n = await pendingEntries(file);
  if (n < 0) {
    console.error('[patch-notes] nessun blocco "in lavorazione" nel changelog: niente da timbrare.');
    process.exit(1);
  }
  if (n === 0) {
    console.log(`[patch-notes] nessuna nota in lavorazione: ${version} è un rilascio di manutenzione, changelog invariato.`);
    return;
  }
  const src = readFileSync(file, 'utf8');
  writeFileSync(file, stamp(src, version, date), 'utf8');
  console.log(`[patch-notes] ${n} voce/i timbrate come ${version} (${date}).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error('[patch-notes]', e.message); process.exit(1); });
}
