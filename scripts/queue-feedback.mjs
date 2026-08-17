// Accoda la CREAZIONE di un nuovo feedback nello "spool" su git.
//
// PERCHÉ ESISTE
//   Quando una routine cloud riceve un feedback-spec troppo grosso per una
//   sessione, lo spezza in sub-feedback autoconsistenti che le routine
//   successive lavoreranno per priorità. Le routine non possono scrivere su
//   Firestore (vedi queue-triage.mjs): la creazione viene accodata come file
//   `feedback-triage/new-<ts>-<rand>.json` e applicata dalla GitHub Action
//   (scripts/apply-triage.mjs) col service account.
//
//   Numerazione: ogni feedback ha un numero leggibile (#22). I sub-feedback
//   ereditano il numero del padre con un suffisso (#22.1, #22.2…): il numero
//   concreto viene calcolato dall'applier al momento della creazione, qui si
//   indica solo il padre (--parent <idFirestore>). Senza --parent il feedback
//   creato è top-level e riceve il prossimo numero progressivo libero.
//
// USO:
//   node scripts/queue-feedback.mjs --name "titolo breve" \
//     [--parent <idFeedbackPadre>] [--priority 0-3] [--status new|todo|clarify] \
//     [--notes "note iniziali"] [--image path/to/shot.png ...] [--no-git] \
//     "testo del feedback"
//
//   --image (ripetibile, max 5): carica uno screenshot locale su Firebase
//     Storage al momento dell'accodamento (le storage.rules consentono l'upload
//     senza auth, vedi lib/feedback-storage.mjs) e mette l'URL pubblico nel
//     campo `images` del feedback, così l'utente vede la prova visiva del
//     problema in dashboard. Se l'upload di un'immagine fallisce, il feedback
//     parte comunque senza quell'immagine (warning su stderr).
//
//   Di default committa e pusha il file (come queue-triage.mjs). Con --no-git
//   scrive soltanto il file e lascia il commit all'hook di auto-commit.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { commitAndPush } from './queue-triage.mjs';
import { uploadScreenshotFile } from './lib/feedback-storage.mjs';
// S1.2: cifratura dei campi sensibili nei file di coda (la history git del repo
// pubblico è un canale di leak tanto quanto Firestore).
import { encryptFieldsForQueue } from './lib/encrypt-feedback-fields.mjs';
// #443: chi sta accodando (esplorazione / sviluppo / verifica), scritto dal
// dispatcher al momento della consegna del lavoro.
import { readRole, normalizeRole } from './lib/routine-role.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// S1.F2.2: hash deterministico del clientId (Node crypto — stesso risultato di WebCrypto).
// SHA-256 troncato a 32 char hex (16 byte). Deterministica: stesso input → stesso output.
function hashClientIdSync(clientId) {
  return createHash('sha256').update(String(clientId || '')).digest('hex').slice(0, 32);
}
// FILO_SPOOL_DIR: override per i test (vedi queue-triage.mjs).
const SPOOL_DIR = process.env.FILO_SPOOL_DIR
  ? resolve(process.env.FILO_SPOOL_DIR)
  : resolve(ROOT, 'feedback-triage');
// 'new' = inbox/"Ricevuti": è lo stato usato dalle passate proattive di audit,
// che depositano i ritrovamenti perché l'utente li riveda PRIMA di metterli in
// lavorazione (le routine NON lavorano i 'new'). 'todo'/'clarify' = sub-feedback
// di una spec spezzata.
const ALLOWED_STATUS = ['new', 'todo', 'clarify'];

// Valida i parametri e costruisce l'oggetto-entry per lo spool (logica pura,
// testata in tests/unit). Lancia su input non valido.
export function buildCreateEntry({ text, name, parentId, priority, status, notes, images, queuedBy, uid }) {
  const t = String(text || '').trim();
  if (!t) throw new Error('testo mancante');
  if (t.length > 10000) throw new Error('testo troppo lungo (max 10000)');
  const n = String(name || '').trim();
  if (!n) throw new Error('--name mancante (titolo breve del feedback)');
  if (n.length > 200) throw new Error('--name troppo lungo (max 200)');
  // Default per stato: un RITROVAMENTO nuovo (top-level, nessun padre) nasce in
  // 'new' → Ricevuti, quindi passa dal giudizio e dall'auto-approvazione per
  // mittente scelta dall'owner (#446). Prima il default era 'todo' per tutti: un
  // ruolo che dimenticava `--status new` infilava il suo ritrovamento in coda
  // saltando il cancello, e l'interruttore "Claude (le automazioni)" prometteva
  // un controllo che su quel cammino non aveva.
  //
  // I SOTTO-feedback (`--parent`) restano 'todo': sono i pezzi di una spec che
  // l'owner ha già approvato come famiglia, rimandarli in Ricevuti uno per uno
  // sarebbe farglieli approvare due volte.
  //
  // Chi ha davvero bisogno di scavalcare passa `--status todo` ESPLICITO: è il
  // caso dell'allarme "controlli automatici rossi" della pubblicazione, che deve
  // arrivare in coda senza aspettare un giudizio. Esplicito sì, per distrazione no.
  const st = status || (parentId ? 'todo' : 'new');
  if (!ALLOWED_STATUS.includes(st)) {
    throw new Error(`status non valido: "${st}" (ammessi: ${ALLOWED_STATUS.join(', ')})`);
  }
  if (parentId && !/^[A-Za-z0-9_-]+$/.test(parentId)) {
    throw new Error(`--parent con caratteri non ammessi: "${parentId}"`);
  }
  let prio = 0;
  if (priority !== undefined && priority !== null && priority !== '') {
    prio = Number(priority);
    if (!Number.isInteger(prio) || prio < 0 || prio > 3) {
      throw new Error(`--priority non valida: "${priority}" (intero 0-3)`);
    }
  }
  // images = array di URL pubblici GIÀ caricati su Storage (l'upload avviene nel
  // main, prima di costruire l'entry). Qui validiamo solo che siano URL http(s).
  let imgs = [];
  if (images !== undefined && images !== null) {
    if (!Array.isArray(images)) throw new Error('images deve essere un array di URL');
    imgs = images.map((u) => String(u || '').trim()).filter(Boolean).slice(0, 5);
    for (const u of imgs) {
      if (!/^https?:\/\//i.test(u)) throw new Error(`URL immagine non valido: "${u.slice(0, 60)}"`);
    }
  }
  return {
    op: 'create',
    // uid = chiave di idempotenza E id del documento Firestore. Generata UNA
    // volta qui, al momento dell'accodamento: se la stessa entry venisse
    // applicata due volte (es. due run concorrenti della GitHub Action che
    // leggono lo spool prima che la prima lo svuoti), entrambe creano il doc con
    // QUESTO id → la seconda riceve 409 ALREADY_EXISTS invece di un duplicato.
    // È race-free perché l'unicità è imposta da Firestore sull'id, non da un
    // check-then-create lato applier. Solo cifre/lettere/-/_ così è un id valido.
    uid: typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid) ? uid : randomUUID(),
    text: t,
    name: n,
    parentId: parentId || '',
    status: st,
    priority: prio,
    notes: typeof notes === 'string' ? notes : '',
    images: imgs,
    queuedAt: new Date().toISOString(),
    queuedBy: queuedBy || process.env.FILO_ROUTINE_SLUG || 'routine',
    // S1.F2.2: i feedback accodati dalle routine NON hanno un clientId utente reale
    // (sono sub-feedback di spec o feedback di audit). clientIdHash non è necessario
    // perché il match C5 riguarda solo i feedback inviati dall'utente, non quelli
    // creati dalle routine.
  };
}

// Scrive il file di spool (nessun effetto git). Ritorna il path assoluto.
// Versione sincrona: usata nei test unitari che testano solo la validazione.
export function queueFeedbackCreate(opts) {
  const entry = buildCreateEntry(opts);
  mkdirSync(SPOOL_DIR, { recursive: true });
  // Il nome file inizia con "new-": è ciò che distingue le creazioni dalle
  // decisioni di triage (<idFeedback>.json) dentro la stessa coda.
  const rand = Math.random().toString(36).slice(2, 8);
  const file = resolve(SPOOL_DIR, `new-${Date.now()}-${rand}.json`);
  writeFileSync(file, JSON.stringify(entry, null, 2) + '\n', 'utf8');
  return file;
}

// Versione asincrona con cifratura S1.2: cifra text/name/notes prima di
// scrivere il file di spool. Stessa logica di queueFeedbackCreate ma con
// i campi sensibili opachi nella history git (repo pubblico).
// S1.F2.2: se l'entry ha un `clientId`, calcola `clientIdHash` e cifra `clientId`.
export async function queueFeedbackCreateEncrypted(opts) {
  const entry = buildCreateEntry(opts);
  // S1.F2.2: calcola clientIdHash PRIMA di cifrare il clientId (se presente).
  // Le entry delle routine di norma NON hanno clientId (è un campo utente), ma
  // se venisse passato (es. feedback di audit con clientId 'auto:...'), lo gestiamo.
  if (entry.clientId) {
    entry.clientIdHash = hashClientIdSync(entry.clientId);
  }
  // S1.2 (Fase 1): cifra SOLO `text` (contenuto inviato, non mostrato ad altri
  // utenti). NON `name` (titolo, mostrato all'utente da C5) né `notes`
  // (spiegazione user-facing) → Fase 2. Guard + gate dormiente in
  // encryptFieldsForQueue: senza attivazione i valori restano in chiaro.
  // S1.F2.2: cifra anche `clientId` se presente (il match usa clientIdHash).
  const fieldsToEncrypt = entry.clientId ? ['text', 'clientId'] : ['text'];
  await encryptFieldsForQueue(entry, fieldsToEncrypt);
  // S1.priority: cifra `priority` separatamente perché è un intero, non testo.
  // encryptFieldsForQueue lavora su stringhe; qui convertiamo esplicitamente
  // String(entry.priority) → cifratura → il valore diventa una stringa FENC1:.
  // Con gate dormiente (isEnabled() false): lasciamo il valore intero invariato.
  {
    const C = globalThis.SN_FEEDBACK_CRYPTO;
    if (C && C.isEnabled && C.isEnabled() && entry.priority !== undefined && entry.priority !== null) {
      try {
        entry.priority = await C.encryptForOwner(String(entry.priority));
      } catch (e) {
        console.warn('[queue-feedback] cifratura priority fallita, scrivo in chiaro:', e?.message || e);
      }
    }
  }
  mkdirSync(SPOOL_DIR, { recursive: true });
  const rand = Math.random().toString(36).slice(2, 8);
  const file = resolve(SPOOL_DIR, `new-${Date.now()}-${rand}.json`);
  writeFileSync(file, JSON.stringify(entry, null, 2) + '\n', 'utf8');
  return file;
}

function parseArgs(argv) {
  const out = { _: [], images: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-git') out.noGit = true;
    else if (a === '--parent') out.parentId = argv[++i];
    else if (a === '--name') out.name = argv[++i];
    else if (a === '--priority') out.priority = argv[++i];
    else if (a === '--status') out.status = argv[++i];
    else if (a === '--notes') out.notes = argv[++i];
    else if (a === '--image') out.images.push(argv[++i]);
    // Provenienza esplicita (#443). Serve solo a chi accoda FUORI da un giro di
    // routine: dentro un giro la scrive il dispatcher e viene ritrovata da sola.
    else if (a === '--role') out.role = argv[++i];
    else out._.push(a);
  }
  return out;
}

const isMain = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  try {
    // Carica gli screenshot su Storage PRIMA di costruire l'entry. Degradazione
    // morbida: se un upload fallisce, lo segnaliamo e il feedback parte senza
    // quell'immagine (meglio un feedback senza prova visiva che nessun feedback).
    const imageUrls = [];
    for (const p of args.images) {
      try {
        const u = await uploadScreenshotFile(resolve(p));
        imageUrls.push(u);
        console.log(`   ↑ screenshot caricato: ${p}`);
      } catch (e) {
        console.error(`   ! screenshot "${p}" non allegato: ${e.message}`);
      }
    }
    // ── La strada principale è il canale del server (#477.2) ────────────────
    //
    // Un feedback nuovo è la cosa che di più NON deve passare per il repo
    // pubblico: il testo di un ritrovamento descrive un problema dell'app, e
    // sul cammino su git resta nella storia anche dopo che il fogliettino è
    // stato consumato. Il server lo scrive cifrato e gli assegna il numero
    // dentro una transazione — niente buchi e niente sovrapposizioni quando
    // arrivano più creazioni insieme.
    if (!args.noGit) {
      const ticket = readRoutineTicket(ROOT);
      if (ticket) {
        try {
          const ch = await import('./routine-channel.mjs');
          const sent = await ch.deliver(ticket, 'feedback', {
            name: args.name, text: args._.join(' '),
            priority: args.priority, parentId: args.parentId || '',
          });
          if (sent.outcome === 'ok') {
            console.log(`OK: feedback aperto sul server${sent.num ? ` → ${sent.num}` : ''}.`);
            if (imageUrls.length) console.warn('   ! le immagini non sono ancora supportate dal canale: questo feedback parte senza.');
            process.exit(0);
          }
          if (sent.outcome === 'refused') {
            console.error(`[queue-feedback] RIFIUTATO dal server: ${sent.reason}`);
            process.exit(4);
          }
          console.warn(`  ! canale non raggiungibile (${sent.reason}): ripiego sulla coda su git`);
        } catch (e) {
          console.warn(`  ! canale non utilizzabile (${e?.message || e}): ripiego sulla coda su git`);
        }
      }
    }

    // S1.2: usa la versione cifrata per proteggere la history git pubblica.
    const file = await queueFeedbackCreateEncrypted({
      text: args._.join(' '),
      name: args.name,
      parentId: args.parentId,
      priority: args.priority,
      status: args.status,
      notes: args.notes,
      images: imageUrls,
      // Provenienza (#443): il ruolo lo sa il dispatcher, non il worker. Se non
      // c'è marcatore (accodamento fuori da un giro di routine) resta vuoto e
      // il feedback arriva come "automazione" generica.
      queuedBy: normalizeRole(args.role) || readRole(ROOT) || undefined,
    });
    console.log(`OK: creazione feedback accodata → ${file}`);
    if (args.noGit) console.log('   (--no-git: file scritto ma non committato)');
    else commitAndPush(file);
  } catch (e) {
    console.error('Errore:', e.message);
    console.error('Uso: node scripts/queue-feedback.mjs --name "titolo" [--parent <id>] [--priority 0-3] [--status new|todo|clarify] [--notes "..."] [--image shot.png ...] [--role prober|verifier|secaudit|fixer|new-work] "testo"');
    process.exit(1);
  }
}
