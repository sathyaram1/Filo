// Verifica #584 giro 6 — la lettura vera di Filo contro il motore vero delle
// regole, con la raccolta riempita come la riempie il server.
//
// Perché ne serve una nuova. La prova del quarto giro faceva la stessa domanda,
// ma si riempiva la raccolta scrivendo col client. Da quando le regole non
// lasciano più scrivere nessun client (la scrittura passa dal server, che
// bypassa le regole), quella prova non riesce più nemmeno a preparare il
// terreno: le sue nove domande sulla LETTURA — che sono il cuore di #584 —
// restano senza risposta. Qui la raccolta si riempie con l'Admin SDK, cioè
// esattamente come farà il server, e poi si guarda la lettura.
//
// Si carica il modulo di lettura di Filo così com'è e si dirotta solo il fetch
// verso l'emulatore: nessuna risposta finta.
//
// NON è un test della suite: il nome non finisce in `.spec.mjs` apposta. Per
// girare vuole Java e l'emulatore ufficiale, che nel repo non stanno.
//
// COME SI LANCIA (in una cartella usa-e-getta, fuori dal repo):
//
//   mkdir /tmp/emu584 && cd /tmp/emu584 && npm init -y
//   npm i firebase-tools @firebase/rules-unit-testing firebase
//   cat > firebase.json <<'FINE'
//   { "firestore": { "rules": "firestore.rules" },
//     "emulators": { "firestore": { "port": 8089, "host": "127.0.0.1" },
//                    "ui": { "enabled": false } } }
//   FINE
//   cp <repo>/firestore.rules .
//   cp <repo>/tests/verifica/584/giro6-lettura-col-motore-vero.mjs .
//   npx firebase emulators:exec --only firestore --project filo-attacco-584 \
//     "FILO_REPO=<repo> node ./giro6-lettura-col-motore-vero.mjs"

import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = process.env.FILO_REPO || '/home/user/Filo';
const REGOLE = process.env.RULES_FILE || join(REPO, 'firestore.rules');
const PROGETTO = 'filo-attacco-584';
const PORTA = Number(process.env.FIRESTORE_PORT || 8089);
const BASE_EMU = `http://127.0.0.1:${PORTA}/v1/projects/${PROGETTO}/databases/(default)/documents`;

const require = createRequire(import.meta.url);
require(join(REPO, 'src', 'shared', 'constants.js'));
require(join(REPO, 'src', 'shared', 'pathsSafety.js'));
require(join(REPO, 'src', 'shared', 'paths.js'));

const Paths = globalThis.SN_PATHS;
const Safety = globalThis.SN_PATHS_SAFETY;
const BASE_VERA = Paths.rest.FIRESTORE_BASE;

// Il fetch di Filo va all'emulatore, e senza chiave: l'emulatore non la vuole.
const fetchVero = globalThis.fetch;
globalThis.fetch = (url, opts) => {
  let u = String(url);
  if (u.startsWith(BASE_VERA)) u = BASE_EMU + u.slice(BASE_VERA.length).replace(/([?&])key=[^&]*/, '$1');
  return fetchVero(u, opts);
};

const verdi = [];
const rossi = [];
function esito(ok, nome, extra = '') {
  (ok ? verdi : rossi).push(nome);
  console.log(`  ${ok ? 'ok   ' : 'ROSSO'} ${nome}${extra ? ` → ${extra}` : ''}`);
}

const env = await initializeTestEnvironment({
  projectId: PROGETTO,
  firestore: { host: '127.0.0.1', port: PORTA, rules: readFileSync(REGOLE, 'utf8') },
});
await env.clearFirestore();

// Il giorno arrotondato: è quello che il server mette nel documento.
const OGGI = new Date(Math.floor(Date.now() / 86400000) * 86400000);
const IERI = new Date(OGGI.getTime() - 86400000);

// La raccolta riempita COME LA RIEMPIE IL SERVER: Admin SDK, sotto il dominio,
// createdAt arrotondato al giorno, e nel documento niente del mittente.
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  const scrivi = (dominio, id, campi) => setDoc(doc(db, `paths/${dominio}/entries/${id}`), campi);
  await scrivi('esempio.it', 'a1', {
    initialUrl: '/account/ordini', intent: 'vedere gli ordini passati',
    steps: [{ selector: '[aria-label="Il mio account"]', action: 'click', retracted: false }],
    success: true, createdAt: OGGI, domain: 'esempio.it',
  });
  await scrivi('esempio.it', 'a2', {
    initialUrl: '/assistenza', intent: 'aprire una segnalazione',
    steps: [{ selector: '#aiuto', action: 'click', retracted: false }],
    success: true, createdAt: IERI, domain: 'esempio.it',
  });
  await scrivi('esempio.it', 'a3', {
    initialUrl: '/carrello', intent: 'svuotare il carrello',
    steps: [{ selector: '#svuota', action: 'click', retracted: false }],
    success: false, createdAt: OGGI, domain: 'esempio.it',
  });
  // Un documento della vecchia forma, col codice del mittente dentro: sta
  // sotto `paths/<dominio>` e non deve essere leggibile da nessuna strada.
  await setDoc(doc(db, 'paths/esempio.it'), { clientId: 'c-vecchio', domain: 'esempio.it' });
  await scrivi('altro.com', 'b1', {
    initialUrl: '/login', intent: 'entrare nel sito',
    steps: [{ selector: '#entra', action: 'click', retracted: false }],
    success: true, createdAt: OGGI, domain: 'altro.com',
  });
});

console.log('\n— la funzione chiesta dal feedback: «percorsi già riusciti» su un sito con percorsi salvati —');

const letti = await Paths.listByDomain('esempio.it', { pageSize: 50, onlySuccess: true });
esito(letti.length === 2, 'l’assistente riceve i percorsi RIUSCITI del sito nominato', `${letti.length} percorso/i`);
esito(letti.every((p) => p.success === true), 'e solo quelli: il pollice in giù non arriva a chi legge');
esito(!JSON.stringify(letti).includes('c-vecchio'), 'e in quello che torna non c’è nessun codice del mittente');
esito(letti.every((p) => !('clientId' in p) && !('userAgent' in p)),
  'nessun campo del mittente nei documenti letti');

const bloccoPrompt = Safety.formatKnownPathsForPrompt(letti);
esito(bloccoPrompt.includes('vedere gli ordini passati') && bloccoPrompt.includes('/account/ordini'),
  'e il percorso arriva formattato nel messaggio di sistema dell’assistente');
esito(bloccoPrompt.startsWith(Safety.FENCE_START) && bloccoPrompt.trimEnd().endsWith(Safety.FENCE_END),
  'dentro le due marcature che lo dichiarano contenuto esterno');
esito(!bloccoPrompt.includes('svuotare il carrello'),
  'il percorso bocciato non entra nel prompt di nessuno');

const vuoto = await Paths.listByDomain('mai-visitato.it', { pageSize: 50, onlySuccess: true });
esito(Array.isArray(vuoto) && vuoto.length === 0, 'un sito senza percorsi torna un elenco vuoto, non un errore');
esito(Safety.formatKnownPathsForPrompt(vuoto) === '', 'e il prompt non apre un blocco vuoto');

const sopraIlTetto = await Paths.listByDomain('esempio.it', { pageSize: 5000, onlySuccess: true });
esito(sopraIlTetto.length === 2, 'chiedere più del tetto non rompe la lettura: il client si ferma prima da sé',
  `${sopraIlTetto.length} percorso/i`);

// Il dominio che non è un nome di host non deve nemmeno toccare la rete.
let toccataLaRete = false;
const fetchPrecedente = globalThis.fetch;
globalThis.fetch = (...a) => { toccataLaRete = true; return fetchPrecedente(...a); };
const storti = await Promise.all(['', '   ', 'a/b', '..', '__x__', 'https://esempio.it/x']
  .map((d) => Paths.listByDomain(d)));
globalThis.fetch = fetchPrecedente;
esito(!toccataLaRete && storti.every((r) => r.length === 0),
  'un nome di sito scritto male torna vuoto senza nemmeno toccare la rete');

console.log('\n— le porte: quello che NON si deve poter chiedere —');

async function post(percorso, corpo) {
  const r = await fetchVero(`${BASE_EMU}${percorso}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
  });
  return { status: r.status, testo: await r.text() };
}
async function get(percorso) {
  const r = await fetchVero(`${BASE_EMU}${percorso}`);
  return { status: r.status, testo: await r.text() };
}

// 1. La raccolta intera, per la strada che Filo usa davvero.
let r = await post(':runQuery', { structuredQuery: { from: [{ collectionId: 'paths' }], limit: 200 } });
esito(r.status === 403, 'la raccolta dei siti non si elenca', String(r.status));

// 2. La query di gruppo su entries: è quella che rimetterebbe insieme tutto.
r = await post(':runQuery', { structuredQuery: { from: [{ collectionId: 'entries', allDescendants: true }], limit: 200 } });
esito(r.status === 403, 'la query di gruppo su tutti i percorsi di tutti i siti è negata', String(r.status));

// 3. La stessa, di gruppo, ma partendo da DENTRO un dominio nominato: il
//    sospetto è che «sono già dentro paths/esempio.it» basti a ereditarne il
//    permesso per tutto quello che c'è sotto. Non basta: senza un match
//    ricorsivo la domanda di gruppo è negata anche da lì.
r = await post('/paths/esempio.it:runQuery', { structuredQuery: { from: [{ collectionId: 'entries', allDescendants: true }], limit: 200 } });
esito(r.status === 403, 'nemmeno da dentro un dominio la domanda di gruppo eredita il permesso', String(r.status));

// 4. Una query di gruppo su `paths` stesso: se un match ricorsivo esistesse,
//    da qui si scaricherebbe tutto.
r = await post(':runQuery', { structuredQuery: { from: [{ collectionId: 'paths', allDescendants: true }], limit: 200 } });
esito(r.status === 403, 'la query di gruppo sui documenti dei siti è negata', String(r.status));

// 5. Il documento del dominio: lì dentro stanno i vecchi percorsi col codice
//    del mittente, e l'elenco dei domini direbbe da solo chi frequenta cosa.
r = await get('/paths/esempio.it');
esito(r.status === 403, 'il documento del sito (dove stanno i vecchi percorsi) non si legge', String(r.status));

// 6. L'elenco dei siti raccolti, per la strada che non è una query.
r = await get('/paths?pageSize=300');
esito(r.status === 403, 'l’elenco dei siti raccolti non si ottiene', String(r.status));

// 7. Saltare il tetto con la paginazione a offset: si resta comunque dentro un
//    solo sito, ed è il progetto. Qui si controlla solo che il tetto della
//    singola richiesta valga anche con l'offset.
r = await post('/paths/esempio.it:runQuery', { structuredQuery: { from: [{ collectionId: 'entries' }], offset: 1, limit: 201 } });
esito(r.status === 403, 'il tetto per richiesta vale anche con l’offset', String(r.status));
r = await post('/paths/esempio.it:runQuery', { structuredQuery: { from: [{ collectionId: 'entries' }], offset: 1, limit: 200 } });
esito(r.status === 200, 'e sotto il tetto la stessa richiesta passa', String(r.status));

// 8. Una lettura senza tetto dichiarato: se `request.query.limit` non ci fosse,
//    il confronto potrebbe non fermare niente.
r = await post('/paths/esempio.it:runQuery', { structuredQuery: { from: [{ collectionId: 'entries' }] } });
esito(r.status === 403, 'una lettura senza tetto dichiarato è negata', String(r.status));

// 9. Scrivere: nessun client scrive più, da nessuna strada.
r = await post('/paths/esempio.it/entries?documentId=nuovo', {
  fields: { domain: { stringValue: 'esempio.it' }, intent: { stringValue: 'x' }, success: { booleanValue: true } },
});
esito(r.status === 403, 'nessun client scrive un percorso, nemmeno ben formato', String(r.status));

console.log(`\n${verdi.length} verdi, ${rossi.length} rossi`);
if (rossi.length) {
  console.log('ROSSI:');
  for (const n of rossi) console.log(' - ' + n);
}
await env.cleanup();
process.exit(rossi.length ? 1 : 0);
