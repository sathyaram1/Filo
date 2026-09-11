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
//   npx firebase emulators:exec --only firestore --project filo-attacco-584 \
//     "FILO_REPO=<repo> node <repo>/tests/verifica/584/giro4-cammino-vero-motore-vero.mjs"

import { createRequire } from 'node:module';
import { join } from 'node:path';

const REPO = process.env.FILO_REPO || '/home/user/Filo';
const PROGETTO = 'filo-attacco-584';
const PORTA = Number(process.env.FIRESTORE_PORT || 8089);
const BASE_EMU = `http://127.0.0.1:${PORTA}/v1/projects/${PROGETTO}/databases/(default)/documents`;

const require = createRequire(import.meta.url);
require(join(REPO, 'src', 'shared', 'constants.js'));
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

const DOMINIO = 'sito-di-prova.example';

console.log('\n— la scrittura di Filo, così com’è, contro le regole vere —');
{
  let errore = null;
  try {
    await Paths.submit({
      domain: DOMINIO,
      initialUrl: '/u/[ID]/ordini',
      intent: 'vedere gli ordini passati',
      steps: [{ selector: '#ordini', action: 'click', retracted: false }],
      success: true,
    });
  } catch (e) { errore = String(e.message || e); }
  esito(errore === null, `Filo scrive un percorso riuscito → ${errore || 'accettato'}`);
}
{
  let errore = null;
  try {
    await Paths.submit({
      domain: DOMINIO,
      initialUrl: '/u/[ID]/resi',
      intent: 'chiedere un reso',
      steps: [{ selector: '#resi', action: 'click', retracted: false }],
      success: false,
    });
  } catch (e) { errore = String(e.message || e); }
  esito(errore === null, `Filo scrive un percorso bocciato → ${errore || 'accettato'}`);
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
  const vuoto = await Paths.listByDomain('sito-mai-visto.example', { pageSize: 50 });
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
  const prompt = Paths.formatForPrompt(await Paths.listByDomain(DOMINIO, { pageSize: 50 }));
  esito(prompt.includes('vedere gli ordini passati') && prompt.includes('#ordini'),
    'il percorso arriva formattato nel prompt dell’assistente');
}

console.log('\n— tutta la pipeline: dalla sessione alla raccolta pubblica —');
{
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

  // Si fa maturare la coda invece di spostare l'orologio in avanti: la data che
  // il percorso si porta dentro è quella dell'istante in cui ESCE, e le regole
  // rifiutano una data nel futuro (giustamente: è la riga che ha chiuso il
  // percorso datato 2099 del terzo giro). Fingere che siano passate ventiquattro
  // ore proverebbe un caso che nella vita non esiste.
  const attesa = Collector._peek().map((v) => ({ ...v, nonPrimaDi: Date.now() - 1000 }));
  disco.set('pathsOutbox', attesa);
  Collector._reset();
  Collector._setAuto(false);
  await Collector.flush();

  const letti = await Paths.listByDomain(DOMINIO, { pageSize: 50, onlySuccess: true });
  const nuovo = letti.find((p) => p.intent === 'trovare gli ordini passati');
  esito(!!nuovo, 'il percorso maturo arriva davvero nella raccolta, passando dalle regole');
  esito(!!nuovo && !String(nuovo.initialUrl).includes('mario.rossi') && !String(nuovo.initialUrl).includes('847362'),
    `l’indirizzo pubblicato non porta il nome né il numero → ${nuovo ? nuovo.initialUrl : '(assente)'}`);
  esito(!!nuovo && String(nuovo.createdAt).endsWith('T00:00:00Z'),
    `la data dentro il percorso è il giorno, senza ora → ${nuovo ? nuovo.createdAt : '(assente)'}`);
  esito(!!nuovo && !('clientId' in nuovo) && !('userAgent' in nuovo) && !('domain' in nuovo),
    'nel documento non c’è nessun campo che dica chi è stato');
}

console.log(`\n${verdi} verdi, ${rossi} rossi`);
process.exit(rossi ? 1 : 0);
