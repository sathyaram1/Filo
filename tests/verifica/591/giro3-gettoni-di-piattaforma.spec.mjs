// Verifica #591 — giro 3. Il conto delle verifiche profonde è di tutta la
// piattaforma, non del sito.
//
// Il giro scorso aveva trovato che il ricordo del controllo profondo era
// passato dall'indirizzo completo al «dominio registrabile», e che sulle
// piattaforme dove ogni utente riceve un suo sotto-indirizzo (pages.dev,
// github.io, vercel.app, i blog ospitati) quel dominio è la PIATTAFORMA: il
// verdetto di un sito valeva per tutti i vicini. Il VERDETTO è tornato
// dell'indirizzo — quella parte è chiusa e resta chiusa (le prove del giro 2
// lo verificano).
//
// Quello che è rimasto del dominio è il CONTO: quante verifiche profonde un
// dominio registrabile può far partire nella finestra di tempo della sua
// cache. Su una piattaforma di hosting quel conto è di tutti i siti ospitati
// insieme: bastano quattro siti di chi attacca — sottodomini gratuiti e
// illimitati — per esaurirlo, e da lì in poi il sito di truffa vero non
// riceve né il giudizio del modello né la finestra nascosta. È la terza
// strada del giro scorso, più stretta ma aperta.
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

// Un banco che registra ogni verifica profonda avviata, per indirizzo.
function banco() {
  const profonde = [];
  SB.setProviders({
    gsb: null,
    rdap: null,
    ct: null,
    llm: async (meta) => { profonde.push('giudizio:' + meta.host); await attendi(5); return { suspicious: false }; },
    sandbox: async (url) => { profonde.push('finestra:' + url); await attendi(5); return { verdict: 'clean' }; },
  });
  return profonde;
}

// Il presupposto del guasto (non un'asserzione: si può chiudere la porta da
// più parti): l'elenco dei suffissi pubblici che Filo usa non conosce le
// piattaforme dove ogni utente riceve un sotto-indirizzo, quindi il «dominio
// registrabile» di sito-di-tizio.pages.dev è pages.dev — la piattaforma.

test('quattro siti di chi attacca spengono la verifica profonda per tutta la piattaforma', async () => {
  pulisci();
  const profonde = banco();

  // Chi attacca si prende quattro sotto-indirizzi gratuiti sulla stessa
  // piattaforma e li fa visitare (bastano quattro navigazioni di seguito:
  // una pagina può portarcisi da sola).
  for (let i = 1; i <= 4; i++) {
    SB.analyze(`http://accesso-sicuro-${i}.pages.dev/login`, DA_EMAIL, () => {});
    await attendi(60);
  }
  expect(profonde.length, 'i quattro siti-esca consumano il conto del dominio').toBeGreaterThan(0);

  // Ora la truffa vera, su un altro sotto-indirizzo della stessa piattaforma.
  profonde.length = 0;
  SB.analyze('http://paypa1-verifica-conto.pages.dev/login', DA_EMAIL, () => {});
  await attendi(300);

  expect(profonde,
    'il sito di truffa deve ricevere il suo controllo profondo: il conto di chi gli sta accanto non è suo')
    .not.toEqual([]);
});

test('caso di riscontro: su domini diversi ogni sito ha il suo controllo', async () => {
  pulisci();
  const profonde = banco();
  for (let i = 1; i <= 5; i++) {
    SB.analyze(`http://paypa1-accedi.esempio-verifica-591-g3-${i}.tk/login`, DA_EMAIL, () => {});
    await attendi(60);
  }
  const giudizi = profonde.filter((p) => p.startsWith('giudizio:'));
  expect(giudizi.length, 'cinque domini diversi, cinque controlli').toBe(5);
});
