// La create anonima di /feedback (#1517) provata col MOTORE VERO: date di Firestore, sotto-numero 0, id non scelto.
// Non è un unit test (vuole Java e l'emulatore ufficiale, fuori dal repo); la sentinella sempre accesa è
// firestoreRulesFeedbackAnonimo.test.mjs. Si lancia come pathsRegole.motore-vero.mjs, senza pacchetti:
//
//   npx firebase emulators:exec --only firestore --project filo-prova-1517 \
//     "node <repo>/tests/unit/feedbackCreateAnonima.motore-vero.mjs"
//
// (firebase.json con l'emulatore sulla 8089; RULES_FILE per provare un altro file di regole.)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8089';
const PROGETTO = process.env.GCLOUD_PROJECT || 'filo-prova-1517';
const RULES = readFileSync(process.env.RULES_FILE || join(__dirname, '..', '..', 'firestore.rules'), 'utf8');
const BASE = `http://${HOST}/v1/projects/${PROGETTO}/databases/(default)/documents`;
const NOME = (id) => `projects/${PROGETTO}/databases/(default)/documents/feedback/${id}`;

let rossi = 0;
function esito(ok, cosa, dettaglio) {
  if (!ok) rossi++;
  console.log(`${ok ? 'ok  ' : 'NO  '} ${cosa}${ok ? '' : ` → ${dettaglio}`}`);
}

function campi(extra = {}) {
  return { text: { stringValue: 'prova' }, statusPublic: { stringValue: 'open' }, seq: { integerValue: '7' }, subSeq: { integerValue: '0' }, ...extra };
}
const ORA = [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }, { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }];

async function commit(id, fields, { trasformazioni = ORA } = {}) {
  const res = await fetch(`${BASE}:commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes: [{ update: { name: NOME(id), fields }, currentDocument: { exists: false }, updateTransforms: trasformazioni }] }),
  });
  return res.status;
}

async function createDocument(id, fields) {
  const res = await fetch(`${BASE}/feedback?documentId=${encodeURIComponent(id)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }),
  });
  return res.status;
}

async function main() {
  const carica = await fetch(`http://${HOST}/emulator/v1/projects/${PROGETTO}:securityRules`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: RULES }] } }),
  });
  if (!carica.ok) throw new Error(`regole non caricate (${carica.status}): ${(await carica.text()).slice(0, 400)}`);

  const id = randomUUID();
  let s = await commit(id, campi());
  esito(s === 200, 'il client di oggi: commit con le due date di Firestore e un id casuale', s);
  s = await commit(id, campi());
  esito(s === 409, 'lo stesso invio una seconda volta: 409, «già scritto da me»', s);

  const ieri = { timestampValue: new Date(Date.now() - 86400000).toISOString() };
  s = await createDocument(randomUUID(), campi({ createdAt: ieri, updatedAt: ieri }));
  esito(s === 403, 'date scelte dal client: rifiutate', s);
  s = await commit(randomUUID(), campi({ updatedAt: ieri }), { trasformazioni: [ORA[0]] });
  esito(s === 403, 'updatedAt nel passato con createdAt di Firestore: rifiutato', s);
  s = await commit(randomUUID(), campi(), { trasformazioni: [ORA[0]] });
  esito(s === 403, 'senza updatedAt: rifiutato (sparirebbe dalle letture a delta)', s);
  s = await commit(randomUUID(), campi({ subSeq: { integerValue: '1' } }));
  esito(s === 403, 'sotto-numero 1 da anonimo: rifiutato', s);
  const senzaSub = campi();
  delete senzaSub.subSeq;
  s = await commit(randomUUID(), senzaSub);
  esito(s === 200, 'sotto-numero assente: ammesso', s);
  s = await commit('corto', campi());
  esito(s === 403, 'id di 5 caratteri: rifiutato', s);
  s = await commit('x'.repeat(129), campi());
  esito(s === 403, 'id di 129 caratteri: rifiutato', s);
  s = await commit('AbCdEfGhIjKlMnOpQrSt', campi());
  esito(s === 200, 'id di 20 caratteri come quelli automatici di Firestore: ammesso', s);

  console.log(rossi ? `\n${rossi} rossi` : '\ntutto verde');
  process.exit(rossi ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
