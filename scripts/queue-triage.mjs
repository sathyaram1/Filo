// Accoda una decisione di triage di un feedback nello "spool" su git.
//
// PERCHÉ ESISTE
//   Le routine cloud NON possono più scrivere su Firestore: l'account Google
//   robot usato per autenticarsi è stato bloccato. Invece di scrivere lo stato
//   direttamente, la routine deposita la decisione in una coda su git — un file
//   per feedback in `feedback-triage/<id>.json`. L'hook di auto-commit lo pusha
//   su origin/main come qualsiasi altra modifica. In locale l'owner esegue
//   `npm run feedback:apply`, che applica le decisioni a Firestore con le sue
//   credenziali ADMIN (non bloccate) e svuota la coda.
//
//   Lo spool è una CODA di comandi, non un registro permanente: ogni file viene
//   cancellato appena applicato. Così non resta nessun elenco di ID che possa
//   diventare stantio quando un feedback viene riaperto (era il punto debole
//   dell'idea "file con la lista dei risolti").
//
// USO:
//   node scripts/queue-triage.mjs <id> <status:todo|done|clarify> "testo note"
//
//   In una sessione Claude puoi anche creare il file a mano con l'editor: l'hook
//   di auto-commit lo committa e pusha. Questo script fa lo stesso con la
//   validazione dello schema. NON tocca git: al commit pensa l'hook (in cloud) o
//   l'apply locale.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SPOOL_DIR = resolve(ROOT, 'feedback-triage');
const ALLOWED = ['todo', 'done', 'clarify'];

export function queueTriage(id, status, notes, queuedBy) {
  if (!id) throw new Error('id mancante');
  if (!ALLOWED.includes(status)) {
    throw new Error(`status non valido: "${status}" (ammessi: ${ALLOWED.join(', ')})`);
  }
  // L'id diventa un nome file: rifiuta tutto ciò che non sia un id Firestore.
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error(`id con caratteri non ammessi in un filename: "${id}"`);
  }
  mkdirSync(SPOOL_DIR, { recursive: true });
  const entry = {
    id,
    status,
    notes: typeof notes === 'string' ? notes : '',
    queuedAt: new Date().toISOString(),
    queuedBy: queuedBy || process.env.FILO_ROUTINE_SLUG || 'routine',
  };
  const file = resolve(SPOOL_DIR, `${id}.json`);
  writeFileSync(file, JSON.stringify(entry, null, 2) + '\n', 'utf8');
  return file;
}

const isMain = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const [, , id, status, ...noteParts] = process.argv;
  if (!id || !status) {
    console.error('Uso: node scripts/queue-triage.mjs <id> <status:todo|done|clarify> "testo note"');
    process.exit(1);
  }
  try {
    const file = queueTriage(id, status, noteParts.length ? noteParts.join(' ') : '');
    console.log(`OK: triage accodato → ${file}`);
    console.log('   Verrà committato dall\'hook di auto-commit. In locale applicalo con: npm run feedback:apply');
  } catch (e) {
    console.error('Errore:', e.message);
    process.exit(1);
  }
}
