// Ponte main → editor per gli appunti.
//
// La collezione dei file dell'editor vive nel renderer (localStorage, per
// l'autosalvataggio sincrono) MA viene rispecchiata sull'archivio dell'app
// (storage.json, via chrome.storage.local — lo stesso archivio che il main usa).
// Lo storico versioni ci vive già da sempre. Grazie a questo mirror il MAIN può
// leggere la collezione, scriverci dentro un appunto (con punti di ripristino) e
// avvisare l'editor aperto, che ricarica e mostra il nuovo testo.
//
// Le chiavi sono le stesse usate da src/pages/editor/editor.js.

const COLLECTION_KEY = 'filo.editor.collection';
const VERSIONS_KEY = 'filo.editor.versions';
const POINTER_KEY = 'filo.editor.notesPointer';
const MIGRATED_KEY = 'filo.editor.notesMigrated';

function NOTES() { return globalThis.SN_EDITOR_NOTES; }
function STORE() { return globalThis.SN_EDITOR_STORE; }

async function getKey(key, fallback) {
  try {
    const r = await chrome.storage.local.get(key);
    const v = r && r[key];
    return (v === undefined || v === null) ? fallback : v;
  } catch (_) { return fallback; }
}

async function setKeys(obj) {
  try { await chrome.storage.local.set(obj); } catch (_) { /* archivio non disponibile */ }
}

// Carica la collezione dall'archivio, migrandola/normalizzandola se serve così
// che ci sia SEMPRE almeno un file valido su cui scrivere.
async function loadCollection() {
  const Store = STORE();
  const raw = await getKey(COLLECTION_KEY, null);
  return Store.migrateToCollection({ collection: raw });
}

// Scrive un appunto in un file dell'editor (crea/append secondo l'argomento).
// opts: { text, topic, forceNew }. Ritorna { wrote, fileId, createdFile, title }.
async function writeNote(opts) {
  const Notes = NOTES();
  const Store = STORE();
  if (!Notes || !Store) return { wrote: false };
  const o = opts || {};
  const text = String(o.text == null ? '' : o.text);
  if (!text.trim()) return { wrote: false };

  // Prima di ogni scrittura assicura che i vecchi appunti siano già migrati,
  // così non si sdoppiano su file diversi.
  await migrateNotesToEditor();

  const collection = await loadCollection();
  const versions = await getKey(VERSIONS_KEY, {});
  const pointer = await getKey(POINTER_KEY, {});

  const res = Notes.writeNote({
    collection,
    versions,
    pointer,
    text,
    topic: o.topic || '',
    forceNew: !!o.forceNew,
  });
  if (!res.wrote) return { wrote: false };

  await setKeys({
    [COLLECTION_KEY]: res.collection,
    [VERSIONS_KEY]: res.versions,
    [POINTER_KEY]: res.pointer,
  });
  return { wrote: true, fileId: res.fileId, createdFile: res.createdFile, title: res.title };
}

// MIGRAZIONE una-tantum: sposta i vecchi appunti dell'archivio (SN_FILO_MEMORY
// notes) in un file "Appunti" dell'editor, poi svuota l'archivio. Idempotente
// grazie al flag MIGRATED_KEY. Non lancia mai.
async function migrateNotesToEditor() {
  try {
    if (await getKey(MIGRATED_KEY, false)) return { migrated: false, already: true };
    const Notes = NOTES();
    const Store = STORE();
    const FiloMem = globalThis.SN_FILO_MEMORY;
    if (!Notes || !Store) return { migrated: false };

    const oldNotes = (FiloMem && typeof FiloMem.listNotes === 'function')
      ? await FiloMem.listNotes() : [];

    if (Array.isArray(oldNotes) && oldNotes.length) {
      const collection = await loadCollection();
      const file = Notes.buildNotesFile(oldNotes);
      if (file) {
        Store.addFile(collection, file);
        const versions = await getKey(VERSIONS_KEY, {});
        const pointer = { fileId: file.id, topic: '' };
        await setKeys({
          [COLLECTION_KEY]: collection,
          [VERSIONS_KEY]: versions,
          [POINTER_KEY]: pointer,
          [MIGRATED_KEY]: true,
        });
        if (FiloMem && typeof FiloMem.clearNotes === 'function') {
          try { await FiloMem.clearNotes(); } catch (_) {}
        }
        return { migrated: true, count: oldNotes.length, fileId: file.id };
      }
    }
    // Niente da migrare: marca comunque così non riproviamo a ogni appunto.
    await setKeys({ [MIGRATED_KEY]: true });
    return { migrated: false, count: 0 };
  } catch (_) {
    return { migrated: false };
  }
}

module.exports = { writeNote, migrateNotesToEditor };
