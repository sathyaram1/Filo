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
// navigazione è un'analisi, e ogni analisi spende un gettone del conto comune.
async function raffica(profonde, quanti) {
  for (let i = 1; i <= quanti; i++) {
    SB.analyze(`http://accesso-sicuro-${i}.pages.dev/login`, DA_EMAIL, () => {});
    await attendi(8);
  }
  return profonde.length;
}

const TRUFFA = 'http://paypa1-verifica-conto.esempio-591-g4.tk/login';

test('la raffica di chi attacca consuma il conto comune e spegne la verifica del sito di un altro', async () => {
  pulisci();
  const profonde = banco();

  const spese = await raffica(profonde, SB.DEEP_MAX_TOTAL);
  expect(spese, 'le esche devono consumare davvero il conto comune').toBeGreaterThan(0);

  // Adesso la truffa vera, su un dominio che non c'entra niente con le esche:
  // primo incontro, nessun ricordo, nessun gettone suo già speso.
  profonde.length = 0;
  SB.analyze(TRUFFA, DA_EMAIL, () => {});
  await attendi(300);

  expect(profonde,
    'il sito di truffa deve ricevere il suo controllo profondo: il conto di chi attacca non è il suo')
    .not.toEqual([]);
});

test('caso di riscontro: col conto intatto la stessa truffa riceve il controllo profondo', async () => {
  pulisci();
  const profonde = banco();
  SB.analyze(TRUFFA, DA_EMAIL, () => {});
  await attendi(300);
  expect(profonde.length, 'senza raffica il controllo profondo parte').toBeGreaterThan(0);
});
