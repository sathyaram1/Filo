// Verifica #584 giro 4 — il codice VERO di Filo contro il motore VERO delle
// regole.
//
// I tre giri passati hanno provato le regole con richieste costruite a mano, e
// il cammino del client con la rete finta. In mezzo resta una domanda che
// nessuno dei due risponde: la lettura che Filo fa davvero — la sua richiesta,
// la sua forma, il suo tetto, il suo filtro — passa attraverso quelle regole e
// torna coi percorsi? Se la query filtrata fosse rifiutata e il ripiego pure,
// la funzione «percorsi già riusciti» resterebbe muta senza rompere niente.
//
// Qui si carica il modulo di Filo così com'è e si dirotta solo il fetch verso
// l'emulatore: nessun mock della risposta.
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
//   cp <repo>/tests/verifica/584/giro4-cammino-vero-motore-vero.mjs .
//   npx firebase emulators:exec --only firestore --project filo-attacco-584 \
//     "FILO_REPO=<repo> node ./giro4-cammino-vero-motore-vero.mjs"

// ── NOTA DEL RIALLINEAMENTO (ramo #584 ribasato su main, che nel frattempo ha
// portato #585) ─────────────────────────────────────────────────────────────
// La SCRITTURA dei percorsi non passa più dal client: le regole la negano a
// chiunque (`allow create, update, delete: if false` su
// `paths/{domain}/entries/{doc}`) e un percorso entra solo dalla callable
// `pathSubmit`, che scrive con l'Admin SDK e bypassa le regole.
//
// La nota c'era gia' dal quinto giro, ma il file non era stato cambiato: si
// riempiva ancora la raccolta scrivendo col client, quindi non riusciva
// nemmeno a prepararsi il terreno e le sue nove domande sulla LETTURA, che
// erano il cuore del giro, restavano senza risposta (#584, sesto giro).
// Adesso la raccolta si riempie con l'Admin SDK, cioe' come la riempira' il
// server, e le prove di lettura girano di nuovo. La SCRITTURA del client la
// prova la parte finale: si aspetta un rifiuto, perche' e' il comportamento
// voluto.

import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = process.env.FILO_REPO || '/home/user/Filo';
const PROGETTO = 'filo-attacco-584';
const PORTA = Number(process.env.FIRESTORE_PORT || 8089);
const BASE_EMU = `http://127.0.0.1:${PORTA}/v1/projects/${PROGETTO}/databases/(default)/documents`;

const require = createRequire(import.meta.url);
require(join(REPO, 'src', 'shared', 'constants.js'));
// La pulizia condivisa col server (#585): pathsCollector la pretende su
// globalThis, e senza questa riga il modulo non si carica nemmeno.
require(join(REPO, 'src', 'shared', 'pathsSafety.js'));
require(join(REPO, 'src', 'shared', 'paths.js'));
require(join(REPO, 'src', 'main', 'services', 'pathsCollector.js'));

const Paths = globalThis.SN_PATHS;
const Collector = globalThis.SN_PATHS_COLLECTOR;
const { ACTIONS } = globalThis.SN_CONST;
const BASE_VERA = Paths.rest.FIRESTORE_BASE;

// Unica deviazione: la rete va all'emulatore invece che a Google. La richiesta
// — verbo, corpo, filtro, tetto — è quella che scrive Filo.
const fetchVero = globalThis.fetch;
globalThis.fetch = (url, opts) => fetchVero(String(url).replace(BASE_VERA, BASE_EMU), opts);

// Il deposito su disco che la coda usa, in memoria.
const disco = new Map();
globalThis.SN_STORAGE = {
  getRaw: async (k, d) => (disco.has(k) ? disco.get(k) : d),
  setRaw: async (k, v) => { disco.set(k, v); },
};

let verdi = 0; let rossi = 0;
function esito(ok, cosa) {
  if (ok) { verdi++; console.log(`  ok    ${cosa}`); }
  else { rossi++; console.log(`  ROSSO ${cosa}`); }
}

const DOMINIO = 'sito-di-prova.it';
const REGOLE = process.env.RULES_FILE || join(REPO, 'firestore.rules');
const OGGI = new Date(Math.floor(Date.now() / 86400000) * 86400000);

// La raccolta si riempie COME LA RIEMPIRA' IL SERVER: Admin SDK, sotto il
// dominio, `createdAt` arrotondato al giorno, e nel documento niente del
// mittente. Col client non si puo' piu', ed e' il punto.
const env = await initializeTestEnvironment({
  projectId: PROGETTO,
  firestore: { host: '127.0.0.1', port: PORTA, rules: readFileSync(REGOLE, 'utf8') },
});
await env.clearFirestore();
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, `paths/${DOMINIO}/entries/p1`), {
    initialUrl: '/u/[ID]/ordini', intent: 'vedere gli ordini passati',
    steps: [{ selector: '#ordini', action: 'click', retracted: false }],
    success: true, createdAt: OGGI,
  });
  await setDoc(doc(db, `paths/${DOMINIO}/entries/p2`), {
    initialUrl: '/u/[ID]/resi', intent: 'chiedere un reso',
    steps: [{ selector: '#resi', action: 'click', retracted: false }],
    success: false, createdAt: OGGI,
  });
});

console.log('\n— la scrittura del client, contro le regole vere —');
{
  // Filo non scrive piu': manda alla callable. Qui si prova la porta che le
  // regole devono tenere chiusa, cioe' una POST diretta col client.
  const r = await fetchVero(`${BASE_EMU}/paths/${DOMINIO}/entries?documentId=intruso`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: {
      initialUrl: { stringValue: '/x' }, intent: { stringValue: 'entrare di lato' },
      success: { booleanValue: true }, createdAt: { timestampValue: OGGI.toISOString() },
    } }),
  });
  esito(r.status === 403, `nessun client scrive un percorso, nemmeno ben formato → ${r.status}`);
}

console.log('\n— la lettura di Filo, quella che finisce nel prompt dell’assistente —');
{
  const letti = await Paths.listByDomain(DOMINIO, { pageSize: 50, onlySuccess: true });
  esito(letti.length === 1 && letti[0].intent === 'vedere gli ordini passati',
    `l’assistente chiede i percorsi riusciti del sito e li riceve → ${letti.length} percorso/i`);
  esito(!letti.some((p) => p.success === false),
    'fra quelli che riceve non c’è nessun pollice in giù');
  esito(!JSON.stringify(letti).includes('clientId') && !JSON.stringify(letti).includes('userAgent'),
    'in quello che riceve non c’è nessun identificativo del mittente');
}
{
  const vuoto = await Paths.listByDomain('sito-mai-visto.it', { pageSize: 50 });
  esito(Array.isArray(vuoto) && vuoto.length === 0,
    'un sito senza percorsi torna un elenco vuoto, non un errore');
}
{
  // Il tetto delle regole è 200: chiedere di più non deve farsi rifiutare la
  // richiesta, deve fermarsi da solo.
  let errore = null; let n = -1;
  try { n = (await Paths.listByDomain(DOMINIO, { pageSize: 5000 })).length; }
  catch (e) { errore = String(e.message || e); }
  esito(errore === null && n >= 1, `chiedere più del tetto non rompe la lettura → ${errore || `${n} percorso/i`}`);
}
{
  const prompt = globalThis.SN_PATHS_SAFETY.formatKnownPathsForPrompt(
    await Paths.listByDomain(DOMINIO, { pageSize: 50 }));
  esito(prompt.includes('vedere gli ordini passati') && prompt.includes('#ordini'),
    'il percorso arriva formattato nel prompt dell’assistente');
}

console.log('\n— tutta la pipeline: dalla sessione a quello che parte —');
{
  // Fin dove arriva la prova, adesso che a scrivere e' il server: si guarda
  // cosa la coda CONSEGNA all'invio, cioe' il documento gia' ripulito, che e'
  // esattamente quello che il server riscrive. L'ultimo pezzo, la scrittura
  // vera, non e' provabile senza la callable: sta fuori da questo repo.
  Collector._reset();
  Collector._setAuto(false);
  const r = await Collector.collectAndSave({
    session: {
      rawUrl: `https://${DOMINIO}/u/mario.rossi/ordini/847362`,
      rawSteps: [{ selector: '[aria-label="I miei ordini"]', action: 'click' }],
      rawUserMessages: ['dove sono i miei ordini?'],
      success: true,
    },
    invokeAI: async ({ action }) => {
      if (action === ACTIONS.HELP_INTENT_GUESS) return { text: 'trovare gli ordini passati' };
      return { text: '{"ok":true}' };
    },
  });
  esito(r.saved === true && r.queued === true, `la sessione entra in coda, non parte subito → ${r.reason || 'in coda'}`);

  // La coda si fa maturare e si intercetta l'invio: quello che passa di li' e'
  // il percorso pronto a uscire.
  const attesa = Collector._peek().map((v) => ({ ...v, nonPrimaDi: Date.now() - 1000 }));
  disco.set('pathsOutbox', attesa);
  Collector._reset();
  Collector._setAuto(false);
  const submitVero = Paths.submit;
  let inviato = null;
  Paths.submit = async (arg) => { inviato = arg; return { id: 'finto' }; };
  try { await Collector.flush(); } finally { Paths.submit = submitVero; }

  esito(!!inviato, 'il percorso maturo esce dalla coda e va verso l’invio');
  const pulito = inviato ? globalThis.SN_PATHS_SAFETY.sanitizeSubmission(inviato) : { ok: false };
  esito(pulito.ok, `e passa la pulizia che il server riapplichera' → ${pulito.ok ? 'ok' : pulito.reason}`);
  const doc = pulito.ok ? pulito.doc : {};
  esito(!String(doc.initialUrl || '').includes('mario.rossi') && !String(doc.initialUrl || '').includes('847362'),
    `l’indirizzo che parte non porta il nome ne’ il numero → ${doc.initialUrl || '(assente)'}`);
  esito(!('clientId' in doc) && !('userAgent' in doc) && !('createdAt' in doc),
    'in quello che parte non c’e nessun campo che dica chi e stato, ne un orario');
  esito(doc.domain === DOMINIO,
    `il nome del sito e’ quello, e va sotto il giudice prima di uscire → ${doc.domain || '(assente)'}`);
}

await env.cleanup();

console.log(`\n${verdi} verdi, ${rossi} rossi`);
process.exit(rossi ? 1 : 0);
