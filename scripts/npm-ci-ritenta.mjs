// `npm ci` che ritenta con attese crescenti: un 503 di un minuto (il binario di Electron, il registro) non ferma suite e pubblicazione (#952).
// Solo moduli di Node: gira prima che node_modules esista. Sentinella: tests/unit/npmCiRitenta.test.mjs.

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Il guasto visto è durato più dei due tentativi interni di npm e di got: qui si copre un disservizio di minuti.
export const ATTESE_S = [30, 60, 120, 240];

// Un lockfile fuori sincrono non guarisce aspettando: ritentarlo butterebbe minuti e seppellirebbe l'errore vero.
const NON_GUARISCE = /\bEUSAGE\b/;

const CODA_USCITA = 200_000;

/** PURA. */
export function daRitentare(uscita) {
  return !NON_GUARISCE.test(String(uscita || ''));
}

/** Inoltra l'uscita mentre arriva (il registro di Actions resta in diretta) e ne tiene la coda per decidere se ritentare. */
export function esegui(comando, argomenti, { shell = false } = {}) {
  return new Promise((fatto) => {
    let coda = '';
    const tieni = (pezzo) => { coda = (coda + pezzo).slice(-CODA_USCITA); };
    let figlio;
    try {
      figlio = spawn(comando, argomenti, { shell, stdio: ['inherit', 'pipe', 'pipe'] });
    } catch (e) {
      fatto({ codice: 1, uscita: String(e && e.message || e) });
      return;
    }
    figlio.stdout.on('data', (b) => { process.stdout.write(b); tieni(String(b)); });
    figlio.stderr.on('data', (b) => { process.stderr.write(b); tieni(String(b)); });
    figlio.on('error', (e) => { tieni(String(e && e.message || e)); });
    figlio.on('close', (codice) => fatto({ codice: codice === null ? 1 : codice, uscita: coda }));
  });
}

// Su Windows `npm` è un .cmd e Node non lo lancia senza shell; altrove si lancia diretto.
export const npmCi = () => esegui('npm', ['ci'], { shell: process.platform === 'win32' });

export async function installa({ prova = npmCi, aspetta = (ms) => new Promise((r) => setTimeout(r, ms)), attese = ATTESE_S, log = console.log } = {}) {
  const tentativi = attese.length + 1;
  for (let i = 0; ; i++) {
    const { codice, uscita } = await prova();
    if (codice === 0) {
      if (i > 0) log(`::warning::npm ci riuscito al tentativo ${i + 1} di ${tentativi}: prima un download non arrivava.`);
      return 0;
    }
    if (!daRitentare(uscita)) {
      log('::error::npm ci rosso per un errore che non guarisce ritentando (package.json e package-lock.json fuori sincrono): niente altri tentativi.');
      return codice || 1;
    }
    if (i >= attese.length) {
      log(`::error::npm ci rosso a tutti i ${tentativi} tentativi: il guasto non è un singhiozzo di rete (registro o download giù a lungo).`);
      return codice || 1;
    }
    log(`::warning::npm ci rosso (tentativo ${i + 1} di ${tentativi}): riprovo fra ${attese[i]} s.`);
    await aspetta(attese[i] * 1000);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await installa();
}
