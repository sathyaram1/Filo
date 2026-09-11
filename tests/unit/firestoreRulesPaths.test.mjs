// Sentinella sulle regole Firestore: nessun client scrive nelle collezioni che
// un ALTRO utente si ritroverà nel prompt.
//
// Il caso che l'ha fatta nascere (audit pre-alpha, #585). La create di `paths`
// — i percorsi di navigazione che l'agente Aiuto legge e cita come «già
// riusciti ad altri» — chiedeva solo dei vincoli di forma: niente
// autenticazione, niente server in mezzo. Con la chiave web di Firebase, che
// sta in un repo pubblico, chiunque depositava un percorso per il dominio che
// preferiva, saltando i due LLM che nell'app ripuliscono i percorsi prima di
// salvarli. E le regole non potevano accorgersene: quei due LLM girano sulla
// macchina di chi naviga, non lasciano nessuna traccia che una regola sappia
// leggere. L'unica scrittura che vale è quella mediata dal server.
//
// Senza il fix questo test è ROSSO: `allow create` di /paths era una lunga
// condizione di sola forma.
//
// Perché una sentinella sul testo e non le regole vere: farle girare davvero
// vuol dire emulatore Firestore (Java, centinaia di MB, un servizio da avviare)
// per asserire due righe. Il rischio qui non è che il motore sbagli, è che
// qualcuno riapra la porta scrivendo un'altra riga. Questo test legge il file
// che si deploya e diventa rosso in millisecondi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const RULES = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');

// Collezioni in cui un client NON autenticato può creare documenti, ognuna col
// motivo per cui va bene. Aggiungerne una è una scelta da fare in coscienza: è
// l'unico modo di far passare questo test con una create aperta.
const SCRITTURE_ANONIME_DICHIARATE = {
  feedback:
    'una segnalazione si manda senza account, di proposito: la legge l’owner (e le routine), ' +
    'non viene mai rimessa nel prompt di un altro utente come istruzione fidata.',
};

const VERBI_SCRITTURA = ['write', 'create', 'update', 'delete'];

// Estrae i blocchi `match /<collezione>/… { … }` di primo livello (indentati di
// 4 spazi dentro `match /databases/{database}/documents`), con le loro regole.
function blocchi(testo) {
  const righe = testo.split('\n');
  const out = [];
  let corrente = null;
  for (const riga of righe) {
    const apre = riga.match(/^ {4}match\s+\/([A-Za-z0-9_-]+)(?:\/|\s)/);
    if (apre && !corrente) {
      corrente = { nome: apre[1], corpo: [] };
      continue;
    }
    if (corrente) {
      if (/^ {4}\}\s*$/.test(riga)) {
        out.push({ nome: corrente.nome, corpo: corrente.corpo.join('\n') });
        corrente = null;
        continue;
      }
      corrente.corpo.push(riga);
    }
  }
  return out.map((b) => ({ nome: b.nome, regole: regoleDi(b.corpo) }));
}

function regoleDi(corpo) {
  const senzaCommenti = corpo.replace(/\/\/[^\n]*/g, ' ');
  const out = [];
  const re = /allow\s+([a-z,\s]+?)\s*:\s*if\s+([\s\S]*?);/g;
  let m;
  while ((m = re.exec(senzaCommenti)) !== null) {
    const verbi = m[1].split(',').map((v) => v.trim()).filter(Boolean);
    out.push({ verbi, cond: m[2].replace(/\s+/g, ' ').trim() });
  }
  return out;
}

const BLOCCHI = blocchi(RULES);

test('il parser vede davvero il file delle regole', () => {
  const nomi = BLOCCHI.map((b) => b.nome);
  for (const atteso of ['feedback', 'paths', 'credits', 'admins']) {
    assert.ok(nomi.includes(atteso), `manca il blocco match /${atteso}`);
  }
  for (const b of BLOCCHI) {
    assert.ok(b.regole.length >= 1, `nessuna regola letta per /${b.nome}`);
  }
});

test('nessun client scrive in /paths: solo il server, via callable', () => {
  const paths = BLOCCHI.find((b) => b.nome === 'paths');
  assert.ok(paths, 'manca il blocco match /paths');

  const scritture = paths.regole.filter((r) => r.verbi.some((v) => VERBI_SCRITTURA.includes(v)));
  assert.ok(scritture.length >= 1, 'le scritture di /paths devono essere negate esplicitamente, non per assenza di regola');
  for (const r of scritture) {
    assert.equal(r.cond, 'false',
      `/paths ${r.verbi.join(',')}: la condizione è "${r.cond}". Un percorso lo scrive SOLO il server (pathSubmit), che riapplica la pulizia e i limiti di frequenza: nessun vincolo di forma scritto qui può provare che la pulizia dell'app sia passata.`);
  }
});

test('i percorsi restano leggibili da chiunque (l’Aiuto di chi non ha account)', () => {
  const paths = BLOCCHI.find((b) => b.nome === 'paths');
  const letture = paths.regole.filter((r) => r.verbi.some((v) => ['read', 'get', 'list'].includes(v)));
  assert.deepEqual(letture.map((r) => r.cond), ['true'],
    'chiudere la lettura spegnerebbe i percorsi noti per chi non ha fatto login: la difesa in lettura è l’incapsulamento nel prompt, non il divieto.');
});

test('una collezione con scrittura anonima o è dichiarata o non esiste', () => {
  for (const b of BLOCCHI) {
    for (const r of b.regole) {
      if (!r.verbi.some((v) => VERBI_SCRITTURA.includes(v))) continue;
      if (r.cond === 'false') continue;
      const chiedeIdentita = /request\.auth\s*!=\s*null/.test(r.cond)
        || /isAdmin\(\)/.test(r.cond)
        || /isRoutine\(\)/.test(r.cond);
      if (chiedeIdentita) continue;
      assert.ok(Object.prototype.hasOwnProperty.call(SCRITTURE_ANONIME_DICHIARATE, b.nome),
        `/${b.nome} accetta una ${r.verbi.join(',')} da chiunque abbia la chiave web (che sta nel repo pubblico). Se è voluto, dichiaralo qui con il motivo; altrimenti falla passare dal server.`);
    }
  }
});

test('le scritture anonime dichiarate esistono davvero (l’elenco non invecchia in silenzio)', () => {
  const nomi = BLOCCHI.map((b) => b.nome);
  for (const nome of Object.keys(SCRITTURE_ANONIME_DICHIARATE)) {
    assert.ok(nomi.includes(nome), `/${nome} è dichiarata a scrittura anonima ma non esiste più nelle regole`);
  }
});
