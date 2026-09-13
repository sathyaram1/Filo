// Sentinella sulle regole Firestore: la data di creazione di un feedback non è
// un campo libero.
//
// Il caso che l'ha fatta nascere (verifica locale del ramo cornice-routine,
// giro 4). La create anonima di `feedback` ammetteva `createdAt` senza dire di
// che tipo dovesse essere né quanto potesse essere lunga, e il fascicolo delle
// routine la ricopiava al lavoratore così com'era, fuori dalla cornice «dato,
// non istruzione»: una stringa di parole, un oggetto, novecentomila caratteri
// arrivavano come campo del server. Il client scrive un timestamp; lo script
// locale e il server, per i feedback che aprono loro, una stringa ISO. Le
// regole pretendono una di quelle due forme.
//
// Senza il fix questo test è ROSSO: la create non nominava mai `createdAt`
// oltre che nell'elenco delle chiavi ammesse.
//
// Perché una sentinella sul testo e non le regole vere: vedi
// firestoreRulesPaths.test.mjs (l'emulatore costa più del rischio, che qui è
// che qualcuno tolga la riga).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const RULES = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');

/** Il blocco `allow create` anonimo di /feedback (quello con hasOnly). */
function createAnonimaDiFeedback() {
  const inizio = RULES.indexOf('match /feedback/{doc}');
  assert.ok(inizio >= 0, 'manca il match di /feedback');
  const blocco = RULES.slice(inizio, RULES.indexOf('match /', inizio + 1));
  const creates = blocco.split(/allow create:/).slice(1);
  const anonima = creates.find((c) => c.includes("'createdAt'") && c.includes('hasOnly'));
  assert.ok(anonima, 'manca la create anonima di /feedback con createdAt fra le chiavi ammesse');
  return anonima.slice(0, anonima.indexOf(';'));
}

test('feedback: la data di creazione è un timestamp o una stringa corta, mai un campo libero', () => {
  const create = createAnonimaDiFeedback();
  assert.match(create, /createdAt is timestamp/, 'il timestamp scritto dal client deve passare');
  assert.match(create, /createdAt is string\s*&&\s*request\.resource\.data\.createdAt\.size\(\)\s*<=\s*40/, 'una stringa ISO corta deve passare, e niente di più lungo');
  // Il vincolo non ammette un terzo tipo: l'unica forma di "oppure" nel
  // vincolo è quella fra assenza, timestamp e stringa corta.
  const vincolo = create.slice(create.indexOf("'createdAt' in request.resource.data"));
  const pezzo = vincolo.slice(0, vincolo.indexOf('<= 40') + 5);
  assert.equal((pezzo.match(/\|\|/g) || []).length, 2, 'assenza, timestamp o stringa corta: tre alternative, non di più');
});
