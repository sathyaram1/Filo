// Legge un file di righe un pezzo alla volta, senza tenerlo intero in una stringa: un file che cresce in coda può
// superare il tetto di una stringa di V8, e allora non si leggerebbe più (#1525). Non scrive niente.

'use strict';

const fs = require('node:fs');

// `fn(riga, indice)` per ogni segmento fra due a capo (anche vuoto); se ritorna una promessa la si aspetta.
// Ritorna `aCapo`: se il file finisce con un a capo (o è vuoto), cioè se un'aggiunta non si incolla a una riga a metà.
async function perRiga(file, fn) {
  let resto = '';
  let indice = 0;
  const chiama = async (riga) => {
    const esito = fn(riga, indice++);
    if (esito && typeof esito.then === 'function') await esito;
  };
  for await (const pezzo of fs.createReadStream(file, { encoding: 'utf8', highWaterMark: 1 << 20 })) {
    let da = 0;
    let a = pezzo.indexOf('\n');
    while (a !== -1) {
      await chiama(resto + pezzo.slice(da, a));
      resto = '';
      da = a + 1;
      a = pezzo.indexOf('\n', da);
    }
    resto += pezzo.slice(da);
  }
  const aCapo = !resto;
  if (resto) await chiama(resto);
  return { aCapo };
}

module.exports = { perRiga };
