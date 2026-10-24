// Le chiavi di un segreto: Argon2id(nome, sale del dispositivo) in un thread a parte, perché tiene la CPU per un secondo
// buono e il processo principale non deve fermarsi. hash-wasm è WASM puro: stesso risultato su Windows, Mac e Linux.
// Parametri fissi (cambiarli rende illeggibili i segreti che esistono): li tiene tests/unit/profiloSegreto.test.mjs.

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const { Worker } = require('node:worker_threads');

// Tarati su circa un secondo su un portatile medio; 256 MB di memoria per tentativo rendono cara la forza bruta.
const ARGON2 = Object.freeze({ passate: 3, memoriaKiB: 256 * 1024, parallelismo: 1 });
const LUNGHEZZA = 32;
const SALE_MIN = 16;
const TEMPO_MAX_MS = 120_000;
// Ognuna tiene 256 MB finché lavora: i nomi dichiarati passano a due a due.
const INSIEME_MAX = 2;

// Cercato al caricamento: se il pacchetto manca, chi importa il modulo cade subito e col motivo.
const ARGON2_JS = require.resolve('hash-wasm/dist/argon2.umd.min.js');

let codice = '';
// Il sorgente passa come testo: un thread che legge un percorso dentro l'archivio dell'app impacchettata non è garantito.
function codiceThread() {
  if (!codice) {
    const lib = fs.readFileSync(ARGON2_JS, 'utf8');
    codice = [
      "const { parentPort, workerData } = require('node:worker_threads');",
      `const hashwasm = (function () { const module = { exports: {} }; const exports = module.exports;\n${lib}\n;return module.exports; })();`,
      "hashwasm.argon2id({ ...workerData, outputType: 'binary' }).then(",
      '  (h) => parentPort.postMessage({ h }, [h.buffer]),',
      '  (e) => parentPort.postMessage({ errore: String((e && e.message) || e) }));',
    ].join('\n');
  }
  return codice;
}

let attivi = 0;
const inAttesa = [];
async function conPosto(fn) {
  if (attivi >= INSIEME_MAX) await new Promise((ok) => inAttesa.push(ok));
  attivi++;
  try {
    return await fn();
  } finally {
    attivi--;
    const prossimo = inAttesa.shift();
    if (prossimo) prossimo();
  }
}

function argon2idNelThread(password, sale, p) {
  return new Promise((resolve, reject) => {
    const w = new Worker(codiceThread(), {
      eval: true,
      workerData: {
        password, salt: sale, iterations: p.passate, memorySize: p.memoriaKiB, parallelism: p.parallelismo, hashLength: LUNGHEZZA,
      },
    });
    let finito = false;
    const chiudi = (errore, valore) => {
      if (finito) return;
      finito = true;
      clearTimeout(timer);
      w.terminate().catch(() => {});
      if (errore) reject(errore);
      else resolve(valore);
    };
    const timer = setTimeout(() => chiudi(new Error(`derivazione della chiave oltre ${TEMPO_MAX_MS / 1000} secondi`)), TEMPO_MAX_MS);
    w.on('message', ({ h, errore }) => (errore ? chiudi(new Error(errore)) : chiudi(null, Buffer.from(h))));
    w.on('error', (e) => chiudi(e instanceof Error ? e : new Error(String(e))));
    w.on('exit', () => chiudi(new Error('derivazione della chiave interrotta')));
    // Dopo gli ascoltatori: aggiungerli riaggancia il thread al ciclo e Filo non uscirebbe più.
    w.unref();
  });
}

function argon2id(password, sale, parametri = ARGON2) {
  return conPosto(() => argon2idNelThread(password, Buffer.from(sale), parametri));
}

// `nome` già normalizzato da chi chiama. Due chiavi separate, per cifrare e per scegliere le posizioni.
async function derivaChiavi(nome, sale, parametri = ARGON2) {
  if (!Buffer.isBuffer(sale) && !(sale instanceof Uint8Array)) throw new TypeError('il sale è una sequenza di byte');
  if (sale.length < SALE_MIN) throw new RangeError(`il sale ha almeno ${SALE_MIN} byte`);
  const password = Buffer.from(String(nome), 'utf8');
  try {
    const radice = await argon2id(password, sale, parametri);
    const sotto = (uso) => Buffer.from(crypto.hkdfSync('sha256', radice, Buffer.alloc(0), `filo/segreto/1/${uso}`, LUNGHEZZA));
    const chiavi = { cifra: sotto('cifra'), posto: sotto('posto') };
    radice.fill(0);
    return chiavi;
  } finally {
    password.fill(0);
  }
}

module.exports = { ARGON2, SALE_MIN, argon2id, derivaChiavi };
