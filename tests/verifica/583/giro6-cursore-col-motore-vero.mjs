// Verifica #583, giro 6 — il cursore della lettura completa, provato contro un
// Firestore vero.
//
// NON è uno spec: il nome finisce in `.mjs` apposta, così la suite non prova a
// lanciarlo. Ha bisogno dell'emulatore Firestore ufficiale e di Java, che nella
// suite non ci sono.
//
// PERCHÉ SERVE
// La correzione del giro 5 fa leggere TUTTE le schede della bacheca paginando
// con un cursore, invece di chiedere le prime cinquecento. La prova sempre
// accesa che accompagna quella correzione mette davanti al codice una sorgente
// finta che si comporta come Firestore. Quello che nessuno aveva ancora provato
// è se Firestore VERO accetta la domanda così com'è costruita: l'ordinamento
// per nome del documento e il cursore scritto per esteso.
//
// Il punto è che non si può scoprire dopo. Se la forma fosse sbagliata, in
// produzione succederebbe una di due cose, e nessuna delle due sarebbe rossa da
// nessuna parte: la bacheca si spegnerebbe con un errore di rete, oppure la
// seconda pagina tornerebbe uguale alla prima e la lettura si fermerebbe a
// cinquecento schede facendo finta di essere tutta. Qui fuori la vetrina non
// esiste ancora, quindi la domanda non si può fare alla produzione: si fa a un
// motore vero in locale.
//
// COME SI LANCIA (fuori dal repo, in una cartella usa-e-getta)
//
//   mkdir /tmp/emu && cd /tmp/emu && npm init -y
//   npm i firebase-tools
//   cp <repo>/firestore.rules .
//   cp <repo>/tests/verifica/583/giro6-cursore-col-motore-vero.mjs .
//   cat > firebase.json <<'FINE'
//   { "firestore": { "rules": "firestore.rules" },
//     "emulators": { "firestore": { "port": 8189, "host": "127.0.0.1" },
//                    "ui": { "enabled": false } } }
//   FINE
//   npx firebase emulators:exec --only firestore --project filo-prova-583 \
//     "node giro6-cursore-col-motore-vero.mjs"
//
// Esito atteso: tutte le righe verdi, uscita 0.

const HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8189';
const PROGETTO = process.env.GCLOUD_PROJECT || 'filo-prova-583';
const RADICE = `projects/${PROGETTO}/databases/(default)/documents`;
const BASE = `http://${HOST}/v1/${RADICE}`;
const COLLEZIONE = 'feedback-public';

// L'emulatore riconosce questo bearer come «proprietario»: salta le regole.
// Serve solo per SEMINARE le schede; le letture qui sotto sono anonime, come
// quelle della bacheca.
const SEMINA = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };

const QUANTE = 552;   // le schede vere del progetto a settembre 2026
const PAGINA = 500;   // il tetto di una pagina, lo stesso del codice

let ok = 0;
let rotte = 0;
function esito(condizione, nome, dettaglio) {
  if (condizione) { ok += 1; console.log(`  ok   ${nome}`); }
  else { rotte += 1; console.log(`  ROTT ${nome}\n       ${dettaglio || ''}`); }
}

// Il nome per esteso del documento, costruito come lo costruisce Filo.
const nomeDocumento = (id) => `${RADICE}/${COLLEZIONE}/${id}`;

// La stessa identica domanda che fa la lettura completa di Filo.
async function pagina(afterName) {
  const structuredQuery = {
    from: [{ collectionId: COLLEZIONE }],
    orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
    limit: PAGINA,
  };
  if (afterName) {
    structuredQuery.startAt = { before: false, values: [{ referenceValue: afterName }] };
  }
  const res = await fetch(`${BASE}:runQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery }),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  const arr = await res.json();
  return arr.filter((r) => r.document).map((r) => r.document);
}

async function main() {
  console.log(`\n— semino ${QUANTE} schede nella vetrina —`);
  const scritture = [];
  for (let i = 0; i < QUANTE; i += 1) {
    const id = `scheda-${String(i).padStart(4, '0')}`;
    scritture.push(fetch(`${BASE}/${COLLEZIONE}?documentId=${id}`, {
      method: 'POST',
      headers: SEMINA,
      body: JSON.stringify({
        fields: {
          name: { stringValue: `Fix numero ${i}` },
          seq: { integerValue: String(i + 1) },
          status: { stringValue: 'done' },
          statusPublic: { stringValue: 'closed' },
        },
      }),
    }));
    if (scritture.length >= 50) { await Promise.all(scritture.splice(0)); }
  }
  await Promise.all(scritture);

  console.log('\n— la prima pagina —');
  const p1 = await pagina('');
  esito(p1.length === PAGINA, `la prima pagina porta ${PAGINA} schede`, `ne ha portate ${p1.length}`);

  console.log('\n— il cursore —');
  const cursore = p1[p1.length - 1].name;
  esito(cursore === nomeDocumento('scheda-0499'),
    'il nome per esteso è quello che Filo si costruisce da sé',
    `il motore dice ${cursore}, Filo scriverebbe ${nomeDocumento('scheda-0499')}`);

  let p2;
  try { p2 = await pagina(cursore); }
  catch (e) {
    esito(false, 'il motore accetta il cursore', String(e.message || e));
    p2 = [];
  }
  if (p2.length) {
    esito(true, 'il motore accetta il cursore');
    esito(p2.length === QUANTE - PAGINA,
      `la seconda pagina porta le ultime ${QUANTE - PAGINA}`,
      `ne ha portate ${p2.length}`);
    esito(p2[0].name === nomeDocumento('scheda-0500'),
      'la seconda pagina riparte DOPO il cursore, non da capo',
      `riparte da ${p2[0].name}`);
  }

  console.log('\n— tutte, una volta sola ciascuna —');
  const tutte = [...p1, ...p2].map((d) => d.name);
  const distinte = new Set(tutte);
  esito(tutte.length === QUANTE, `le schede lette sono ${QUANTE}`, `ne ha lette ${tutte.length}`);
  esito(distinte.size === tutte.length, 'nessuna scheda arriva due volte',
    `${tutte.length} lette, ${distinte.size} distinte`);
  esito(distinte.has(nomeDocumento(`scheda-${String(QUANTE - 1).padStart(4, '0')}`)),
    'c\'è anche l\'ultima, quella che la finestra tagliava');

  console.log(`\n${ok} passate, ${rotte} rotte\n`);
  process.exit(rotte === 0 ? 0 : 1);
}

main().catch((e) => { console.error('ROTTO PRIMA DI FINIRE:', e); process.exit(1); });
