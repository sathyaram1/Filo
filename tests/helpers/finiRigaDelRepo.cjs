// Dentro gli unit test un file del repo arriva sempre coi fini riga del repo.
// Le letture in byte restano grezze: chi deve VEDERE un `\r` legge i byte.
// Perché la regola sta qui e non nei singoli test: tests/unit/finiDiRiga.test.mjs.

const fs = require('node:fs');
const { resolve, sep } = require('node:path');
const { fileURLToPath } = require('node:url');

const RADICE = resolve(__dirname, '..', '..');

// Solo i file del repo: quello che un test si scrive da sé in una cartella
// temporanea può contenere i fini riga che vuole, ed è spesso il suo argomento.
function dentroIlRepo(percorso) {
  let testo;
  if (typeof percorso === 'string') testo = percorso;
  else if (Buffer.isBuffer(percorso)) testo = percorso.toString('utf8');
  else if (percorso && percorso.protocol === 'file:') testo = fileURLToPath(percorso);
  else return false; // un descrittore già aperto non dice da quale file viene
  const assoluto = resolve(testo);
  return assoluto === RADICE || assoluto.startsWith(RADICE + sep);
}

/** Il risultato di una lettura è testo di un file del repo? */
function daNormalizzare(percorso, risultato) {
  return typeof risultato === 'string' && dentroIlRepo(percorso);
}

const aLf = (testo) => testo.replace(/\r\n?/g, '\n');

const sincrona = fs.readFileSync;
fs.readFileSync = function (percorso, ...resto) {
  const r = sincrona.call(this, percorso, ...resto);
  return daNormalizzare(percorso, r) ? aLf(r) : r;
};

// `fs.promises.readFile` è lo stesso oggetto che esporta `node:fs/promises`:
// avvolgerlo qui copre tutte e due le porte.
const promessa = fs.promises.readFile;
fs.promises.readFile = async function (percorso, ...resto) {
  const r = await promessa.call(this, percorso, ...resto);
  return daNormalizzare(percorso, r) ? aLf(r) : r;
};

const conRichiamo = fs.readFile;
fs.readFile = function (percorso, ...resto) {
  const richiamo = resto[resto.length - 1];
  if (typeof richiamo !== 'function') return conRichiamo.call(this, percorso, ...resto);
  resto[resto.length - 1] = (errore, dati) => richiamo(errore, daNormalizzare(percorso, dati) ? aLf(dati) : dati);
  return conRichiamo.call(this, percorso, ...resto);
};
