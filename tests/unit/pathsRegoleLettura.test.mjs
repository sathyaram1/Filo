// Sentinella sulle regole Firestore dei percorsi condivisi dell'Aiuto.
//
// Il caso che l'ha fatta nascere (audit pre-alpha, #584). La collezione `paths`
// aveva `allow read: if true`: con la chiave web, che sta nel repo pubblico ed
// è pubblica per design, una query scaricava TUTTI i percorsi di TUTTI. Dentro
// ogni documento c'erano un `clientId` in chiaro e lo user agent, cioè la
// chiave per ricucire i percorsi della stessa persona su domini diversi — con
// sei tester che si conoscono fra loro, un nome sopra ogni percorso.
//
// Il confine nuovo: il dominio è un SEGMENTO del percorso Firestore
// (`paths/<dominio>/entries`), quindi leggere vuol dire nominare un dominio, e
// l'elenco completo non è più una cosa che esista. Regge su tre cose insieme,
// e questa sentinella le tiene ferme tutte e tre:
//   1. `paths/{domain}` chiuso in lettura (vecchi documenti piatti + elenco
//      dei domini raccolti);
//   2. `entries` leggibile solo sotto un dominio nominato, con un tetto sulla
//      `limit`;
//   3. nessun match ricorsivo `/{p=**}/entries/…`, altrimenti il motore
//      accetta le collection group query e la raccolta intera torna
//      scaricabile in un colpo.
// Più il documento: niente campi che dicano chi ha mandato il percorso.
//
// Perché una sentinella di testo e non le regole vere: identico al ragionamento
// di firestoreRulesConfigSecrets.test.mjs — il motore vero vuole l'emulatore
// (Java, centinaia di MB), il rischio qui non è che il motore sbagli ma che
// qualcuno riapra la porta scrivendo una riga. Questo test la vede in
// millisecondi. La prova col motore vero sta nel file accanto,
// `pathsRegole.motore-vero.mjs` (19 righe verdi con queste regole; con quelle
// di `main` un anonimo si portava via tutto).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { leggiTestoRepo } from '../helpers/testo.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const RULES = leggiTestoRepo(join(ROOT, 'firestore.rules'));

// Il file senza commenti: una regola non esiste perché è scritta dentro un
// commento, e un commento che cita `allow read: if true` non deve far passare
// (né fallire) niente.
const CODICE = RULES.replace(/\/\/[^\n]*/g, '');

// La graffa che APRE un blocco, a partire da `da`. Non tutte le graffe lo
// fanno: `match /paths/{domain} {` ne ha una che è un jolly del percorso, e
// contarla porterebbe a leggere come corpo del blocco la parola "domain".
function apreBlocco(testo, da) {
  for (let j = da; j < testo.length; j += 1) {
    if (testo[j] !== '{') continue;
    const chiusa = testo.indexOf('}', j);
    const dentro = chiusa < 0 ? '' : testo.slice(j + 1, chiusa);
    if (chiusa > j && /^[A-Za-z0-9_]+(=\*\*)?$/.test(dentro)) { j = chiusa; continue; }
    return j;
  }
  return -1;
}

// Estrae il corpo di un blocco `match <percorso> {` bilanciando le graffe:
// i blocchi dei percorsi sono annidati, una regex sola non basta.
function corpoMatch(testo, percorso) {
  const i = testo.indexOf(`match ${percorso}`);
  if (i < 0) return null;
  const apre = apreBlocco(testo, i);
  if (apre < 0) return null;
  let livello = 0;
  for (let j = apre; j < testo.length; j += 1) {
    if (testo[j] === '{') livello += 1;
    else if (testo[j] === '}') {
      livello -= 1;
      if (livello === 0) return testo.slice(apre + 1, j);
    }
  }
  return null;
}

// Le condizioni di lettura dichiarate in un corpo, SENZA scendere nei blocchi
// annidati: servono le regole di QUEL livello.
function senzaBlocchiAnnidati(corpo) {
  let out = '';
  let i = 0;
  while (i < corpo.length) {
    const m = corpo.indexOf('match ', i);
    if (m < 0) { out += corpo.slice(i); break; }
    out += corpo.slice(i, m);
    const apre = apreBlocco(corpo, m);
    if (apre < 0) break;
    let livello = 0;
    let j = apre;
    for (; j < corpo.length; j += 1) {
      if (corpo[j] === '{') livello += 1;
      else if (corpo[j] === '}') {
        livello -= 1;
        if (livello === 0) break;
      }
    }
    i = j + 1;
  }
  return out;
}

function lettureDirette(corpo) {
  const senzaAnnidati = senzaBlocchiAnnidati(corpo);
  const out = [];
  const re = /allow\s+([a-z,\s]+?)\s*:\s*if\s+([\s\S]*?);/g;
  let m;
  while ((m = re.exec(senzaAnnidati)) !== null) {
    const verbi = m[1].split(',').map((v) => v.trim()).filter(Boolean);
    if (!verbi.some((v) => v === 'read' || v === 'get' || v === 'list')) continue;
    out.push({ verbi, cond: m[2].replace(/\s+/g, ' ').trim() });
  }
  return out;
}

const PATHS = corpoMatch(CODICE, '/paths/{domain}');
const ENTRIES = PATHS ? corpoMatch(PATHS, '/entries/{doc}') : null;

test('il parser vede davvero i due blocchi dei percorsi', () => {
  assert.ok(PATHS, 'manca il blocco match /paths/{domain}: se il percorso è cambiato, aggiorna questa sentinella insieme alle regole');
  assert.ok(ENTRIES, 'manca il blocco annidato match /entries/{doc} sotto /paths/{domain}');
  assert.ok(lettureDirette(PATHS).length >= 1, 'nessuna regola di lettura letta su /paths/{domain}');
  assert.ok(lettureDirette(ENTRIES).length >= 1, 'nessuna regola di lettura letta su /entries/{doc}');
});

test('la collezione dei percorsi non si legge: né i vecchi documenti piatti, né l’elenco dei domini', () => {
  for (const { cond } of lettureDirette(PATHS)) {
    assert.equal(cond, 'false',
      `/paths/{domain} si legge con "${cond}". Lì sotto ci sono i documenti della vecchia forma piatta (con il clientId in chiaro) e l'elenco dei domini raccolti: entrambi dicono chi frequenta cosa.`);
  }
});

test('i percorsi si leggono un dominio alla volta, e una lista senza tetto è rifiutata', () => {
  const letture = lettureDirette(ENTRIES);
  const list = letture.find((l) => l.verbi.includes('list') || l.verbi.includes('read'));
  assert.ok(list, 'manca la regola di lista su /paths/{domain}/entries/{doc}');
  assert.match(list.cond, /request\.query\.limit\s*<=\s*\d+/,
    'la lista dei percorsi di un dominio deve passare da un tetto su request.query.limit');
  // `allow read` copre anche `list`: una lettura senza tetto rientrerebbe dalla
  // finestra.
  const readAperta = letture.find((l) => l.verbi.includes('read') && !/request\.query\.limit/.test(l.cond));
  assert.ok(!readAperta,
    `su /entries c'è "allow read: if ${readAperta && readAperta.cond}": read comprende list, quindi il tetto sulla limit smette di valere`);
});

test('nessun match ricorsivo: una collection group query rimetterebbe in piedi il download di tutto', () => {
  assert.ok(!/=\*\*/.test(CODICE),
    'c’è un match ricorsivo (`{p=**}`) nelle regole: con uno di quelli il motore accetta le collection group query, e chiedere `entries` di gruppo riporta indietro i percorsi di ogni dominio in un colpo solo');
});

test('nessun client scrive un percorso: la strada è la callable del server', () => {
  // La scrittura l'ha chiusa #585: i due modelli che ripuliscono un percorso
  // girano sulla macchina di chi naviga, e nessuna regola può provare che siano
  // passati. Quindi qui non c'è nessun controllo di forma da verificare: c'è da
  // verificare che non si scriva, punto. Un `allow create` che torna, in
  // qualunque forma, riapre la porta per cui chiunque depositava un «percorso»
  // sul dominio che voleva con la chiave pubblica del repo.
  const compatto = ENTRIES.replace(/\s+/g, ' ');
  assert.match(compatto, /allow create, update, delete: if false;/,
    'create, update e delete sui percorsi devono restare chiusi a ogni client');
  const scritture = /allow\s+([a-z,\s]+?)\s*:\s*if\s+([\s\S]*?);/g;
  let m;
  while ((m = scritture.exec(ENTRIES)) !== null) {
    const verbi = m[1].split(',').map((v) => v.trim());
    if (!verbi.some((v) => ['write', 'create', 'update', 'delete'].includes(v))) continue;
    assert.equal(m[2].replace(/\s+/g, ' ').trim(), 'false',
      `su /entries c'è "allow ${m[1].trim()}: if ${m[2].trim()}": la scrittura dal client è la porta che #585 ha chiuso`);
  }
});

test('nemmeno il documento del dominio si scrive dal client', () => {
  const scritture = /allow\s+([a-z,\s]+?)\s*:\s*if\s+([\s\S]*?);/g;
  const corpo = senzaBlocchiAnnidati(PATHS);
  let m;
  let viste = 0;
  while ((m = scritture.exec(corpo)) !== null) {
    const verbi = m[1].split(',').map((v) => v.trim());
    if (!verbi.some((v) => ['write', 'create', 'update', 'delete'].includes(v))) continue;
    viste += 1;
    assert.equal(m[2].replace(/\s+/g, ' ').trim(), 'false');
  }
  assert.ok(viste >= 1, 'su /paths/{domain} manca una regola di scrittura: senza, il default nega, ma la cosa va detta');
});
