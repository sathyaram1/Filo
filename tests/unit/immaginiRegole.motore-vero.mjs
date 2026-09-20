// #597 — Le regole Firestore sugli ALLEGATI di un feedback, provate col MOTORE
// VERO: in `images` e in `files` entrano solo indirizzi del deposito di Filo.
//
// NON è un unit test: il nome non finisce in `.test.mjs` apposta, così
// `npm run test:unit` non prova a lanciarlo (né Playwright, che guarda i
// `.spec.mjs`). Per girare ha bisogno di due cose che nella suite non ci sono
// e non ci devono essere — l'emulatore Firestore ufficiale (un .jar da
// centinaia di MB) e Java. La sentinella sempre accesa è il file accanto,
// `firestoreRulesImmaginiDeposito.test.mjs`, che rilegge le regole in
// millisecondi; questo è l'altra metà: la prova che quel file, dato in pasto al
// motore vero, si comporta come dice.
//
// COME SI LANCIA (fuori dal repo, in una cartella usa-e-getta):
//
//   mkdir /tmp/emu && cd /tmp/emu && npm init -y
//   npm i firebase-tools @firebase/rules-unit-testing firebase
//   cp <repo>/firestore.rules .
//   cat > firebase.json <<'FINE'
//   { "firestore": { "rules": "firestore.rules" },
//     "emulators": { "firestore": { "port": 8097, "host": "127.0.0.1" },
//                    "ui": { "enabled": false } } }
//   FINE
//   cp <repo>/tests/unit/immaginiRegole.motore-vero.mjs .
//   RULES_FILE=<repo>/firestore.rules npx firebase emulators:exec \
//     --only firestore --project filo-prova-597 "node /tmp/emu/immaginiRegole.motore-vero.mjs"
//
// (si copia il file nella cartella usa-e-getta perché stando nel repo Node
// cerca i pacchetti nel node_modules del repo, dove l'emulatore non c'è — ed è
// giusto che non ci sia).
//
// CONTROPROVA, fatta al primo passaggio: con le regole di `main`
// (`git show main:firestore.rules`) tutte le righe del blocco «quello che NON
// si deve poter fare» diventano verdi al contrario — cioè un anonimo scrive in
// `images` l'indirizzo che vuole, `http://169.254.169.254/` compreso, e il
// server dei giudici va a prenderlo. Una prova che passa su entrambe le
// versioni non prova niente.

import {
  initializeTestEnvironment, assertFails, assertSucceeds,
} from '@firebase/rules-unit-testing';
import { addDoc, collection, Timestamp } from 'firebase/firestore';
import { readFileSync } from 'node:fs';

const REGOLE = process.env.RULES_FILE || 'firestore.rules';

const env = await initializeTestEnvironment({
  projectId: 'filo-prova-597',
  firestore: { host: '127.0.0.1', port: 8097, rules: readFileSync(REGOLE, 'utf8') },
});
await env.clearFirestore();

let ok = 0; let ko = 0;
async function prova(nome, fn) {
  try { await fn(); console.log(`  ok   ${nome}`); ok += 1; }
  catch (e) { console.log(`  FAIL ${nome}\n       ${e.message}`); ko += 1; }
}

const anon = env.unauthenticatedContext().firestore();

// Un indirizzo come quello che scrive davvero `SN_FEEDBACK.uploadImage`.
const BUONO = 'https://firebasestorage.googleapis.com/v0/b/filo-8b9cb.firebasestorage.app/o/feedback%2F1757000000000_4f1c2e3a-1111-4222-8333-444455556666.png?alt=media&token=8e2f0c1a-2222-4333-8444-555566667777';
// Lo stesso deposito col nome storico: gli allegati del 2025 ce l'hanno dentro.
const BUONO_STORICO = 'https://firebasestorage.googleapis.com/v0/b/filo-8b9cb.appspot.com/o/feedback%2F1730000000000_4f1c2e3a-1111-4222-8333-444455556666.png?alt=media&token=aaaa';
// La forma diretta di Google Storage, l'altra che l'app riconosce.
const BUONO_DIRETTO = 'https://storage.googleapis.com/filo-8b9cb.firebasestorage.app/feedback/1757000000000_4f1c2e3a-1111-4222-8333-444455556666.png';

function feedback(extra) {
  return {
    text: 'una segnalazione qualunque',
    url: 'https://esempio.invalid/pagina',
    title: 'Pagina',
    name: 'Titolo breve',
    userAgent: 'Filo/33',
    clientId: 'abc-123',
    clientIdHash: '0123456789abcdef0123456789abcdef',
    statusPublic: 'open',
    createdAt: Timestamp.now(),
    ...extra,
  };
}
const crea = (extra) => addDoc(collection(anon, 'feedback'), feedback(extra));

console.log('\n— quello che NON si deve poter fare (images) —');
await prova('un indirizzo esterno qualunque',
  () => assertFails(crea({ images: ['https://esempio.invalid/x.png'] })));
await prova('i metadati della macchina su cui gira la funzione',
  () => assertFails(crea({ images: ['http://169.254.169.254/latest/meta-data/'] })));
await prova('un servizio raggiungibile solo dall’interno',
  () => assertFails(crea({ images: ['http://127.0.0.1:8080/admin'] })));
await prova('un deposito di Google che non è il nostro',
  () => assertFails(crea({ images: ['https://storage.googleapis.com/deposito-di-un-altro/x.png'] })));
await prova('un deposito altrui sulla strada REST di Firebase',
  () => assertFails(crea({ images: ['https://firebasestorage.googleapis.com/v0/b/deposito-di-un-altro.appspot.com/o/x.png?alt=media'] })));
await prova('il nostro host messo davanti con la chiocciola',
  () => assertFails(crea({ images: ['https://firebasestorage.googleapis.com@esempio.invalid/v0/b/filo-8b9cb.firebasestorage.app/o/x.png'] })));
await prova('il nostro nome di deposito come PREFISSO di un altro',
  () => assertFails(crea({ images: ['https://storage.googleapis.com/filo-8b9cb.firebasestorage.app.esempio.invalid/x.png'] })));
await prova('senza cifratura del trasporto (http)',
  () => assertFails(crea({ images: ['http://firebasestorage.googleapis.com/v0/b/filo-8b9cb.firebasestorage.app/o/x.png'] })));
await prova('un indirizzo con un a capo dentro',
  () => assertFails(crea({ images: [`${BUONO}\nhttps://esempio.invalid/x.png`] })));
await prova('non una stringa: un numero',
  () => assertFails(crea({ images: [42] })));
await prova('non una stringa: una mappa',
  () => assertFails(crea({ images: [{ url: BUONO }] })));
await prova('non una stringa: null',
  () => assertFails(crea({ images: [null] })));
await prova('la stringa vuota',
  () => assertFails(crea({ images: [''] })));
await prova('un indirizzo lunghissimo (oltre 2000 caratteri)',
  () => assertFails(crea({ images: [`${BUONO}${'a'.repeat(2100)}`] })));
await prova('images che non è nemmeno una lista',
  () => assertFails(crea({ images: BUONO })));
await prova('sei allegati invece di cinque',
  () => assertFails(crea({ images: [BUONO, BUONO, BUONO, BUONO, BUONO, BUONO] })));
await prova('quattro buoni e il quinto esterno (l’ultimo indice è guardato)',
  () => assertFails(crea({ images: [BUONO, BUONO, BUONO, BUONO, 'https://esempio.invalid/x.png'] })));
await prova('il terzo esterno, gli altri buoni',
  () => assertFails(crea({ images: [BUONO, BUONO, 'https://esempio.invalid/x.png', BUONO, BUONO] })));

console.log('\n— quello che NON si deve poter fare (files) —');
await prova('un allegato non-immagine con indirizzo esterno',
  () => assertFails(crea({ files: [{ url: 'https://esempio.invalid/x.pdf', name: 'x.pdf', type: 'application/pdf' }] })));
await prova('un allegato non-immagine senza indirizzo',
  () => assertFails(crea({ files: [{ name: 'x.pdf', type: 'application/pdf' }] })));
await prova('un allegato non-immagine con un campo di troppo',
  () => assertFails(crea({ files: [{ url: BUONO, name: 'x.pdf', type: 'application/pdf', extra: 'x' }] })));
await prova('una stringa al posto della mappa',
  () => assertFails(crea({ files: [BUONO] })));
await prova('il quinto allegato esterno, i primi quattro buoni',
  () => assertFails(crea({
    files: [1, 2, 3, 4].map(() => ({ url: BUONO, name: 'x.pdf', type: 'application/pdf' }))
      .concat([{ url: 'https://esempio.invalid/x.pdf', name: 'x.pdf', type: 'application/pdf' }]),
  })));

console.log('\n— quello che deve continuare a funzionare —');
await prova('un feedback senza allegati',
  () => assertSucceeds(crea({})));
await prova('un feedback con la lista degli allegati vuota',
  () => assertSucceeds(crea({ images: [], files: [] })));
await prova('uno screenshot vero, come lo scrive l’app',
  () => assertSucceeds(crea({ images: [BUONO] })));
await prova('cinque screenshot veri',
  () => assertSucceeds(crea({ images: [BUONO, BUONO, BUONO, BUONO, BUONO] })));
await prova('un allegato col nome storico del deposito',
  () => assertSucceeds(crea({ images: [BUONO_STORICO] })));
await prova('un allegato nella forma diretta di Google Storage',
  () => assertSucceeds(crea({ images: [BUONO_DIRETTO] })));
await prova('un allegato non-immagine, come lo scrive l’app',
  () => assertSucceeds(crea({ files: [{ url: BUONO, name: 'spec.pdf', type: 'application/pdf' }] })));
await prova('un allegato non-immagine senza nome né tipo',
  () => assertSucceeds(crea({ files: [{ url: BUONO }] })));
await prova('immagini e allegati insieme',
  () => assertSucceeds(crea({ images: [BUONO, BUONO], files: [{ url: BUONO_STORICO, name: 'note.txt', type: 'text/plain' }] })));

console.log(`\n${ok} ok, ${ko} FAIL`);
await env.cleanup();
process.exit(ko === 0 ? 0 : 1);
