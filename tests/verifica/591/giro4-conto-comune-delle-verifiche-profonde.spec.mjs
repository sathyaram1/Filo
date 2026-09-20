// Verifica #591 — giro 4. Il conto delle verifiche profonde ha, accanto a
// quello di chi possiede il sito, un conto COMUNE a tutti i siti: sessanta
// verifiche per finestra di tempo. Quel conto è una risorsa condivisa, e chi
// attacca può consumarla tutta con i propri siti per spegnere la verifica
// profonda sul sito di qualcun altro.
//
// È la terza strada dei due giri precedenti, salita di un piano: allora
// bastava un vicino pulito (giro 2), poi quattro sotto-indirizzi della stessa
// piattaforma (giro 3); adesso servono sessanta indirizzi, che sulle
// piattaforme dove ogni utente riceve un sotto-indirizzo gratuito sono
// sessanta «proprietari» diversi — proprio la distinzione introdotta dal giro
// scorso rende il consumo più facile, perché ogni sotto-indirizzo ha il suo
// gettone da spendere sul conto comune.
//
// Non serve nessun clic dell'utente: una pagina si porta da sola su sessanta
// indirizzi di seguito, e Filo li analizza a ogni navigazione.
//
// Niente Electron: il rilevatore è logica pura, il giudizio del modello e la
// finestra nascosta sono finti.

import { test, expect } from '@playwright/test';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require_ = createRequire(join(REPO, 'package.json'));
const SB = require_(join(REPO, 'src/main/services/safebrowse/index.js'));
const { installSafebrowse } = require_(join(REPO, 'src/main/tabs/tabSafebrowse.js'));

// La scheda dove l'utente è rimasto: i metodi sono quelli veri di Filo.
function schedaSu(url) {
  class FintoTabManager {
    constructor() {
      this.tabs = [{ id: 1, view: { webContents: { getURL: () => url, send() {} } } }];
    }
  }
  installSafebrowse(FintoTabManager);
  return new FintoTabManager();
}

const attendi = (ms) => new Promise((r) => setTimeout(r, ms));
const DA_EMAIL = { linkOrigin: 'email', hasPassword: true };

function pulisci() {
  for (const c of Object.values(SB._caches)) if (typeof c.clear === 'function') c.clear();
  for (const s of Object.values(SB._inFlight)) s.clear();
}

// Un banco che registra ogni verifica profonda avviata.
function banco() {
  const profonde = [];
  SB.setProviders({
    gsb: null,
    rdap: null,
    ct: null,
    llm: async (meta) => { profonde.push('giudizio:' + meta.host); await attendi(2); return { suspicious: false }; },
    sandbox: async (url) => { profonde.push('finestra:' + url); await attendi(2); return { verdict: 'clean' }; },
  });
  return profonde;
}

// La pagina ostile si porta da sola su un indirizzo dopo l'altro: ogni
// navigazione è un'analisi, e ogni analisi vorrebbe un gettone del conto comune.
async function raffica(quanti) {
  for (let i = 1; i <= quanti; i++) {
    SB.analyze(`http://accesso-sicuro-${i}.pages.dev/login`, DA_EMAIL, () => {});
    await attendi(8);
  }
}

const TRUFFA = 'http://paypa1-verifica-conto.esempio-591-g4.tk/login';

test('la raffica di chi attacca non spegne la verifica del sito di un altro', async () => {
  pulisci();
  const profonde = banco();

  // Sessanta navigazioni di fila: quello che chi attacca può fare senza un
  // solo clic dell'utente.
  await raffica(60);
  expect(profonde.length, 'le esche devono far partire qualche verifica').toBeGreaterThan(0);
  expect(profonde.length,
    'la raffica va strozzata mentre avviene, non lasciata correre per sessanta indirizzi')
    .toBeLessThan(60);

  // Adesso la truffa vera, su un dominio che non c'entra niente con le esche:
  // primo incontro, nessun ricordo, nessun gettone suo già speso. È qui che
  // l'utente resta.
  profonde.length = 0;
  schedaSu(TRUFFA).safebrowseGet(1, TRUFFA, { hasPassword: true });
  await attendi(SB.RAFFICA_MS + 900);

  expect(profonde,
    'il sito di truffa deve ricevere il suo controllo profondo: il conto di chi attacca non è il suo')
    .not.toEqual([]);
});

test('caso di riscontro: col conto intatto la stessa truffa riceve subito il controllo profondo', async () => {
  pulisci();
  const profonde = banco();
  schedaSu(TRUFFA).safebrowseGet(1, TRUFFA, { hasPassword: true });
  await attendi(300);
  expect(profonde.length, 'senza raffica il controllo profondo parte subito').toBeGreaterThan(0);
});
