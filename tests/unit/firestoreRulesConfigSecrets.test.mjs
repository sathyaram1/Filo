// Sentinella sulle regole Firestore: nessun documento di configurazione che
// contiene SEGRETI può essere letto da chi non è admin.
//
// Il caso che l'ha fatta nascere (audit pre-alpha, #581). `config/secrets` —
// dentro ci sono le chiavi OpenRouter e Tavily che pagano le chiamate di tutti,
// più la chiave Google Safe Browsing — si leggeva con la sola condizione
// «utente autenticato con email verificata». Ma il login di Filo accetta
// qualunque account Google e la chiave web di Firebase sta in un repo pubblico:
// chiunque, senza nemmeno scaricare Filo, si autenticava e con una GET REST si
// portava via il documento intero. Il documento gemello `config/judgeSecrets`
// era già protetto con isAdmin(): l'asimmetria era la spia.
//
// Perché una sentinella e non un test sulle regole vere. Farle girare
// davvero vuol dire emulatore Firestore (Java, centinaia di MB, un servizio da
// avviare) per asserire una riga: qui il rischio non è che il motore delle
// regole sbagli, è che qualcuno riapra la porta scrivendo un'altra riga. Questo
// test legge il file che si deploya e diventa rosso in millisecondi.
//
// Senza il fix è ROSSO: la condizione di lettura di config/secrets era
// `request.auth != null && request.auth.token.email_verified == true`.
//
// La regola è scritta una volta per TUTTI i documenti `config/*`, non solo per
// quello segnalato: un documento nuovo o è nell'elenco dei pubblici dichiarati
// (e allora non ci vanno segreti dentro) o è admin-only. Così la prossima
// chiave condivisa non può nascere con la porta aperta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const RULES = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');

// Documenti di config a lettura PUBBLICA, ognuno con il motivo per cui può
// esserlo. Non contengono segreti: nomi di modelli e interruttori delle
// routine. Aggiungerne uno qui è una scelta da fare in coscienza — è l'unico
// modo di far passare questo test con una lettura non-admin.
const PUBBLICI_DICHIARATI = {
  models: 'solo nomi di modelli: serve anche a chi non ha fatto login',
  routines: 'interruttori delle routine, lette da macchine senza credenziali',
};

// Estrae i blocchi `match /config/<doc> { … }` con le condizioni di lettura.
function blocchiConfig(testo) {
  const out = [];
  const re = /match\s+\/config\/(\w+)\s*\{([\s\S]*?)\n\s*\}/g;
  let m;
  while ((m = re.exec(testo)) !== null) {
    const [, doc, corpo] = m;
    const letture = [];
    const reAllow = /allow\s+([a-z,\s]+?)\s*:\s*if\s+([\s\S]*?);/g;
    let a;
    while ((a = reAllow.exec(corpo)) !== null) {
      const verbi = a[1].split(',').map((v) => v.trim()).filter(Boolean);
      if (!verbi.includes('read') && !verbi.includes('get') && !verbi.includes('list')) continue;
      letture.push(a[2].replace(/\/\/[^\n]*/g, ' ').replace(/\s+/g, ' ').trim());
    }
    out.push({ doc, letture });
  }
  return out;
}

const BLOCCHI = blocchiConfig(RULES);

test('le regole contengono i documenti di config attesi (il parser vede davvero il file)', () => {
  const nomi = BLOCCHI.map((b) => b.doc);
  for (const atteso of ['models', 'secrets', 'judgeSecrets', 'automation', 'supportModels']) {
    assert.ok(nomi.includes(atteso), `manca il blocco match /config/${atteso}`);
  }
  // Ogni blocco trovato deve avere almeno una regola di lettura: se il parser
  // non ne trova nessuna sta leggendo male, e un test che non vede niente
  // passerebbe sempre.
  for (const b of BLOCCHI) {
    assert.ok(b.letture.length >= 1, `nessuna regola di lettura letta per config/${b.doc}`);
  }
});

test('config/secrets si legge SOLO da admin, come config/judgeSecrets', () => {
  const secrets = BLOCCHI.find((b) => b.doc === 'secrets');
  assert.ok(secrets, 'manca il blocco match /config/secrets');
  assert.deepEqual(secrets.letture, ['isAdmin()'],
    'la lettura di config/secrets deve essere la sola isAdmin(): dentro ci sono le chiavi che pagano le chiamate di tutti');

  const judge = BLOCCHI.find((b) => b.doc === 'judgeSecrets');
  assert.deepEqual(secrets.letture, judge.letture,
    'i due documenti di segreti devono avere la stessa protezione: l’asimmetria è stata il bug');
});

test('nessun documento di config si apre sulla sola condizione "sei loggato"', () => {
  for (const b of BLOCCHI) {
    for (const cond of b.letture) {
      if (cond === 'true') continue; // pubblico: controllato dal test dopo
      const soloLoggato = /^request\.auth\s*!=\s*null/.test(cond)
        && !/isAdmin\(\)/.test(cond)
        && !/request\.auth\.uid\s*==/.test(cond);
      assert.ok(!soloLoggato,
        `config/${b.doc}: "${cond}" apre a qualunque account Google. Iscriversi non costa niente e la chiave web di Firebase sta nel repo pubblico: non è una barriera.`);
    }
  }
});

test('un documento di config o è admin-only o è un pubblico DICHIARATO', () => {
  for (const b of BLOCCHI) {
    const pubblico = b.letture.some((c) => c === 'true');
    if (!pubblico) {
      for (const cond of b.letture) {
        assert.match(cond, /isAdmin\(\)/,
          `config/${b.doc}: la lettura "${cond}" non passa da isAdmin()`);
      }
      continue;
    }
    assert.ok(Object.prototype.hasOwnProperty.call(PUBBLICI_DICHIARATI, b.doc),
      `config/${b.doc} è leggibile da chiunque ma non è fra i pubblici dichiarati: se non contiene segreti aggiungilo all'elenco col perché, altrimenti chiudi la lettura a isAdmin().`);
  }
});

test('i pubblici dichiarati esistono davvero (l’elenco non invecchia in silenzio)', () => {
  const nomi = BLOCCHI.map((b) => b.doc);
  for (const doc of Object.keys(PUBBLICI_DICHIARATI)) {
    assert.ok(nomi.includes(doc), `config/${doc} è dichiarato pubblico ma non esiste più nelle regole`);
  }
});

test('un documento il cui nome parla di segreti non può mai essere pubblico', () => {
  for (const b of BLOCCHI) {
    if (!/secret|key|chiav/i.test(b.doc)) continue;
    for (const cond of b.letture) {
      assert.equal(cond, 'isAdmin()',
        `config/${b.doc} ha "segreto" nel nome: la lettura deve essere isAdmin(), trovata "${cond}"`);
    }
  }
});
