// Ponte main → editor: la collezione vive nel renderer (localStorage) ed è rispecchiata
// su chrome.storage.local, ed è quel mirror a renderla leggibile e scrivibile dal main.
// Le chiavi sono le stesse di src/pages/editor/editor.js.

const COLLECTION_KEY = 'filo.editor.collection';
const VERSIONS_KEY = 'filo.editor.versions';
const POINTER_KEY = 'filo.editor.notesPointer';
const MIGRATED_KEY = 'filo.editor.notesMigrated';
// Archivio appunti pre-editor: lo tocca solo la migrazione qui sotto, che lo svuota una
// volta sola, quindi la chiave si legge direttamente invece di tenere in piedi un CRUD.
function legacyNotesKey() {
  try { return globalThis.SN_CONST.STORAGE_KEYS.FILO_NOTES; } catch (_) { return 'filo_notes'; }
}

function NOTES() { return globalThis.SN_EDITOR_NOTES; }
function STORE() { return globalThis.SN_EDITOR_STORE; }

async function getKey(key, fallback) {
  try {
    const r = await chrome.storage.local.get(key);
    const v = r && r[key];
    return (v === undefined || v === null) ? fallback : v;
  } catch (_) { return fallback; }
}

// true solo se la scrittura è riuscita: chi sta per buttare i dati sorgente (la migrazione)
// deve distinguere «salvato» da «archivio non disponibile», o li perde.
async function setKeys(obj) {
  try { await chrome.storage.local.set(obj); return true; } catch (_) { return false; }
}

// Collezione assente: si torna vuoto e NON si sintetizza un file bianco, che dopo il merge
// comparirebbe come file fantasma accanto ai documenti veri. Lo crea l'editor all'apertura.
async function loadCollection() {
  const Store = STORE();
  const raw = await getKey(COLLECTION_KEY, null);
  if (raw && Array.isArray(raw.files)) return Store.migrateToCollection({ collection: raw });
  return { version: Store.COLLECTION_VERSION, activeId: null, files: [] };
}

async function writeNote(opts) {
  const Notes = NOTES();
  const Store = STORE();
  if (!Notes || !Store) return { wrote: false };
  const o = opts || {};
  const text = String(o.text == null ? '' : o.text);
  if (!text.trim()) return { wrote: false };

  // I vecchi appunti vanno migrati prima di ogni scrittura, o si sdoppiano su file diversi.
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

// Migrazione una-tantum, idempotente e che non lancia mai: è l'ULTIMO punto del codice
// che conosce la vecchia chiave.
async function migrateNotesToEditor() {
  try {
    if (await getKey(MIGRATED_KEY, false)) return { migrated: false, already: true };
    const Notes = NOTES();
    const Store = STORE();
    if (!Notes || !Store) return { migrated: false };

    const oldNotes = await getKey(legacyNotesKey(), []);

    if (Array.isArray(oldNotes) && oldNotes.length) {
      const collection = await loadCollection();
      const file = Notes.buildNotesFile(oldNotes);
      if (file) {
        Store.addFile(collection, file);
        const versions = await getKey(VERSIONS_KEY, {});
        const pointer = { fileId: file.id, topic: '' };
        // Si svuota (e si marca la migrazione) SOLO dopo che il file Appunti è stato scritto:
        // se la scrittura non riesce gli appunti restano dove sono e si riprova al prossimo avvio.
        const saved = await setKeys({
          [COLLECTION_KEY]: collection,
          [VERSIONS_KEY]: versions,
          [POINTER_KEY]: pointer,
        });
        if (!saved) return { migrated: false, count: oldNotes.length };
        await setKeys({ [legacyNotesKey()]: [], [MIGRATED_KEY]: true });
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

// Riassunti per il contesto (#379.5): il riassunto AI se c'è, altrimenti un estratto grezzo.
// È questo a entrare nel contesto al posto del testo integrale.
async function listFileSummaries() {
  const Summary = globalThis.SN_EDITOR_SUMMARY;
  if (!Summary) return [];
  try {
    const collection = await loadCollection();
    return Summary.buildContextFiles(collection);
  } catch (_) { return []; }
}

// Corpus anti-esfiltrazione (#379.10): il materiale personale da proteggere quando Filo
// apre un URL forgiato è il contenuto di questi file. Best-effort: non lancia mai.
async function notesCorpusText() {
  const Summary = globalThis.SN_EDITOR_SUMMARY;
  const Store = STORE();
  if (!Summary || !Store) return '';
  try {
    const collection = await loadCollection();
    const files = (collection && Array.isArray(collection.files)) ? collection.files : [];
    return files.map((f) => Summary.fileText(f)).filter(Boolean).join('\n');
  } catch (_) { return ''; }
}

// Filo vede solo i riassunti e chiede il testo intero (LEGGI_FILE) quando vale la pena.
async function readFile(fileId) {
  const Summary = globalThis.SN_EDITOR_SUMMARY;
  const Store = STORE();
  if (!Summary || !Store) return { ok: false };
  const id = String(fileId == null ? '' : fileId).trim();
  if (!id) return { ok: false };
  try {
    const collection = await loadCollection();
    const file = Store.findFile(collection, id);
    if (!file) return { ok: false, id };
    const title = (file.meta && file.meta.title) || 'Documento senza titolo';
    return { ok: true, id, title, text: Summary.fileText(file) };
  } catch (_) { return { ok: false, id }; }
}

module.exports = { writeNote, migrateNotesToEditor, listFileSummaries, readFile, notesCorpusText };
