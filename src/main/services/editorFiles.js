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
// Vecchio archivio appunti (pre-editor). Non esiste più codice che ci scriva:
// l'unico a toccarlo è la migrazione qui sotto, che lo svuota una volta sola.
// Per questo la chiave la leggiamo direttamente invece di tenere in piedi un
// CRUD di cui nessun altro ha più bisogno.
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

// Ritorna true se la scrittura è andata a buon fine: chi sta per BUTTARE via i
// dati sorgente (la migrazione degli appunti) deve poter distinguere "salvato"
// da "archivio non disponibile", altrimenti li perderebbe.
async function setKeys(obj) {
  try { await chrome.storage.local.set(obj); return true; } catch (_) { return false; }
}

// Carica la collezione dall'archivio. Se non esiste ancora (l'editor non è mai
// stato aperto), ritorna una collezione VUOTA — NON sintetizza un file bianco:
// lo farebbe l'editor stesso all'apertura, e un bianco creato qui apparirebbe
// come file fantasma accanto ai documenti reali dell'utente dopo il merge.
async function loadCollection() {
  const Store = STORE();
  const raw = await getKey(COLLECTION_KEY, null);
  if (raw && Array.isArray(raw.files)) return Store.migrateToCollection({ collection: raw });
  return { version: Store.COLLECTION_VERSION, activeId: null, files: [] };
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
    if (!Notes || !Store) return { migrated: false };

    const oldNotes = await getKey(legacyNotesKey(), []);

    if (Array.isArray(oldNotes) && oldNotes.length) {
      const collection = await loadCollection();
      const file = Notes.buildNotesFile(oldNotes);
      if (file) {
        Store.addFile(collection, file);
        const versions = await getKey(VERSIONS_KEY, {});
        const pointer = { fileId: file.id, topic: '' };
        // L'archivio vecchio si svuota (e la migrazione si marca fatta) SOLO
        // dopo che il file "Appunti" è stato scritto davvero: se la scrittura
        // non riesce, gli appunti restano dove sono e ci si riprova al prossimo
        // avvio. Nessun percorso porta a perderli.
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

// Riassunti dei file per il contesto di Filo (#379.5): ritorna
// [{ id, title, summary, source }] per OGNI file della collezione — il riassunto
// AI se c'è, altrimenti un estratto grezzo. È ciò che entra nel contesto di Filo
// al posto del testo integrale.
async function listFileSummaries() {
  const Summary = globalThis.SN_EDITOR_SUMMARY;
  if (!Summary) return [];
  try {
    const collection = await loadCollection();
    return Summary.buildContextFiles(collection);
  } catch (_) { return []; }
}

// Testo dei file dell'editor per il CORPUS anti-esfiltrazione (#379.10). Gli
// appunti non vivono più in un archivio separato: sono file dell'editor come gli
// altri, e Filo li "vede" (via riassunti, e può leggerli per intero on-demand).
// Quindi il materiale personale-persistente da proteggere quando NAVIGA forgia un
// URL è ora il CONTENUTO di questi file — non più il vecchio silo `filo_notes`,
// che dopo la migrazione è vuoto. Ritorna il testo concatenato di TUTTI i file
// (appunti inclusi) o '' se non c'è nulla. Best-effort: non lancia mai.
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

// Lettura ON-DEMAND del contenuto completo di UN file (azione LEGGI_FILE): Filo
// vede solo i riassunti e, quando decide che vale la pena leggere un file per
// intero, ne chiede il testo con l'id. Ritorna { ok, id, title, text }.
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
