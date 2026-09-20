// Sentinella sulle regole Firestore: gli allegati di un feedback sono
// indirizzi del DEPOSITO di Filo, non indirizzi qualunque (#597).
//
// Il caso che l'ha fatta nascere (audit pre-alpha di agosto 2026, gravità
// alta). La create anonima di `feedback` chiedeva a `images` solo di essere
// «una lista di al più cinque elementi»: non che fossero stringhe, non che
// puntassero da qualche parte in particolare. Quegli indirizzi però il server
// dei giudici li SCARICA, per passare gli screenshot a un modello con ingresso
// visivo. Quindi un estraneo — un feedback lo manda chiunque, senza account —
// scriveva `http://169.254.169.254/...` o l'indirizzo di un servizio interno e
// la funzione andava a prenderlo: l'indirizzo IP del server, il tempo di
// risposta, quello che dall'interno si raggiunge, e la descrizione di ciò che
// era stato scaricato che tornava scritta dentro il feedback.
//
// Senza il fix questo test è ROSSO: le regole non nominavano mai il deposito.
//
// L'ALTRA METÀ sta sul server (filo-security): il controllo si rifà lì prima
// di scaricare, perché un documento scritto con l'Admin SDK, o scritto prima
// del deploy di queste regole, da qui non passa. Le regole da sole non bastano
// mai.
//
// Perché una sentinella sul testo e non le regole vere: vedi
// firestoreRulesPaths.test.mjs (l'emulatore costa più del rischio, che qui è
// che qualcuno tolga la riga). Le regole vere sono provate dal file accanto,
// `immaginiRegole.motore-vero.mjs`, che si lancia a mano con l'emulatore
// ufficiale: al primo passaggio 32 righe verdi, e con le regole di `main` 21 di
// quelle righe rosse.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const RULES = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
const FEEDBACK_JS = readFileSync(join(ROOT, 'src', 'shared', 'feedback.js'), 'utf8');

/** Il corpo di una funzione delle regole, dalla firma alla graffa che chiude. */
function funzione(nome) {
  const inizio = RULES.indexOf(`function ${nome}(`);
  assert.ok(inizio >= 0, `manca la funzione ${nome}() in firestore.rules`);
  const fine = RULES.indexOf('\n    }', inizio);
  assert.ok(fine > inizio, `la funzione ${nome}() non si chiude`);
  return RULES.slice(inizio, fine);
}

/** Il blocco `allow create` anonimo di /feedback (quello con hasOnly). */
function createAnonimaDiFeedback() {
  const inizio = RULES.indexOf('match /feedback/{doc}');
  assert.ok(inizio >= 0, 'manca il match di /feedback');
  const blocco = RULES.slice(inizio, RULES.indexOf('match /', inizio + 1));
  const creates = blocco.split(/allow create:/).slice(1);
  const anonima = creates.find((c) => c.includes("'images'") && c.includes('hasOnly'));
  assert.ok(anonima, 'manca la create anonima di /feedback con images fra le chiavi ammesse');
  return anonima.slice(0, anonima.indexOf(';'));
}

test('feedback: images passa dal vincolo sul deposito, non solo dal conteggio', () => {
  const create = createAnonimaDiFeedback();
  assert.match(
    create,
    /soloAllegatiDelDeposito\(request\.resource\.data\.get\('images', \[\]\)\)/,
    'la create anonima deve passare `images` al vincolo sul deposito',
  );
});

test('feedback: anche gli allegati non-immagine portano un indirizzo del deposito', () => {
  const create = createAnonimaDiFeedback();
  assert.match(
    create,
    /soloAllegatiConUrlDelDeposito\(request\.resource\.data\.get\('files', \[\]\)\)/,
    'la porta accanto a `images` è `files`: stesso vincolo sull’indirizzo',
  );
});

test('un indirizzo del deposito è una stringa https, corta, del nostro deposito', () => {
  const f = funzione('urlDelDeposito');
  assert.match(f, /v is string/, 'prima di tutto deve essere una stringa: un numero o una mappa non sono un indirizzo');
  assert.match(f, /v\.size\(\) > 0/, 'la stringa vuota non è un indirizzo');
  assert.match(f, /v\.size\(\) <= 2000/, 'serve un tetto sulla lunghezza');
  assert.ok(f.includes('^https://'), 'solo https, e ancorato all’inizio: senza àncora l’indirizzo giusto può stare in coda a uno sbagliato');
  assert.ok(!/\^http:\/\//.test(f), 'http in chiaro non è ammesso');
  // Il confronto è sul DEPOSITO, non sull'host: fermarsi a
  // `storage.googleapis.com` lascerebbe entrare il bucket di chiunque.
  for (const pezzo of ['firebasestorage\\.googleapis\\.com', 'storage\\.googleapis\\.com']) {
    assert.ok(f.includes(pezzo), `l’espressione deve nominare l’host ${pezzo}`);
  }
  assert.ok(f.includes('filo-8b9cb\\.'), 'l’espressione deve nominare il nostro deposito, non il solo host');
});

test('la lista è enumerata tutta: il tetto sta dentro la funzione che la guarda', () => {
  for (const [nome, elemento] of [
    ['soloAllegatiDelDeposito', 'urlDelDeposito'],
    ['soloAllegatiConUrlDelDeposito', 'allegatoConUrl'],
  ]) {
    const f = funzione(nome);
    const tetto = f.match(/l\.size\(\) <= (\d+)/);
    assert.ok(tetto, `${nome}() deve mettere un tetto al numero di elementi`);
    const max = Number(tetto[1]);
    // Il linguaggio delle regole non ha cicli: gli indici si scrivono a mano, e
    // l'enumerazione vale solo se sono TANTI QUANTO il tetto. Alzare il tetto
    // senza aggiungere un indice vorrebbe dire che il sesto allegato entra
    // senza che nessuno lo guardi — e nessuno se ne accorgerebbe.
    const indici = new Set(
      [...f.matchAll(new RegExp(`${elemento}\\(l\\[(\\d+)\\]\\)`, 'g'))].map((m) => Number(m[1])),
    );
    for (let i = 0; i < max; i += 1) {
      assert.ok(indici.has(i), `${nome}(): l’elemento ${i} non viene guardato da nessuno (tetto ${max})`);
      assert.match(
        f,
        new RegExp(`l\\.size\\(\\) < ${i + 1} \\|\\| ${elemento}\\(l\\[${i}\\]\\)`),
        `${nome}(): l’elemento ${i} va guardato solo quando esiste, o una lista corta esplode invece di passare`,
      );
    }
  }
});

test('un allegato non-immagine è una mappa { url, name, type } e niente altro', () => {
  const f = funzione('allegatoConUrl');
  assert.match(f, /v is map/);
  assert.match(f, /keys\(\)\.hasOnly\(\['url', 'name', 'type'\]\)/, 'nessun campo oltre i tre che scrive l’app');
  assert.match(f, /urlDelDeposito\(v\.get\('url', ''\)\)/, 'l’indirizzo passa dallo stesso vincolo delle immagini');
});

test('le regole e l’app dicono lo stesso deposito', () => {
  // Il gemello dalla parte dell'app è `SN_FEEDBACK.isAttachmentUrl`
  // (src/shared/feedback.js). Se i due divergono, si apre esattamente il buco
  // che #597 ha chiuso: l'app tratta un indirizzo come "roba nostra" e le
  // regole no, o peggio il contrario.
  const progetto = FEEDBACK_JS.match(/const PROJECT_ID = '([^']+)'/);
  const deposito = FEEDBACK_JS.match(/const BUCKET = '([^']+)'/);
  assert.ok(progetto && deposito, 'src/shared/feedback.js non dichiara più PROJECT_ID / BUCKET come prima');

  const f = funzione('urlDelDeposito');
  const atteso = [deposito[1], `${progetto[1]}.appspot.com`];
  for (const nome of atteso) {
    // Nell'espressione i punti sono protetti (`\\.`): si confronta la forma
    // scritta nelle regole, non il nome nudo.
    const nelleRegole = nome.replace(/\./g, '\\\\.');
    assert.ok(
      f.includes(nelleRegole) || f.includes(nelleRegole.replace(`${progetto[1]}\\\\.`, '')),
      `le regole non nominano il deposito '${nome}' che src/shared/feedback.js considera nostro`,
    );
  }

  const hostApp = [...FEEDBACK_JS.matchAll(/^\s*'([a-z0-9.-]+\.googleapis\.com)':/gm)].map((m) => m[1]);
  assert.ok(hostApp.length >= 2, 'src/shared/feedback.js non elenca più gli host degli allegati come prima');
  for (const host of hostApp) {
    assert.ok(
      f.includes(host.replace(/\./g, '\\\\.')),
      `le regole non nominano l’host '${host}' che src/shared/feedback.js considera nostro`,
    );
  }
});
