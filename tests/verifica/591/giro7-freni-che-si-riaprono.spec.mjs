// Verifica #591 — giro 7. I freni sono una VELOCITÀ, non un totale.
//
// La segnalazione parte da qui: con le chiavi condivise di fabbrica paga
// l'owner, e «qualunque indirizzo http fuori dai fidati fa partire un giudizio
// del modello più l'apertura della pagina in una finestra nascosta». I giri
// passati hanno messo un conto per chi possiede il sito e, accanto, un conto
// comune corto. Il conto comune si riapre da solo ogni pochi secondi: una
// pagina ostile che si porta da sola su sotto-indirizzi sempre nuovi (su una
// piattaforma che ne regala uno a testa, ogni sotto-indirizzo è un
// proprietario diverso) non veniva fermata, veniva solo rallentata, e poteva
// tenere quella velocità per sempre.
//
// Le prove non fissano un numero «giusto»: fanno durare la raffica due
// finestre uguali e guardano se la seconda aggiunge qualcosa. Un freno che è
// un tetto non aggiunge niente; uno che è una velocità raddoppia.
//
// Logica pura: le chiamate di rete e al modello sono finte.

import { test, expect } from '@playwright/test';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require_ = createRequire(join(REPO, 'package.json'));
const SB = require_(join(REPO, 'src/main/services/safebrowse/index.js'));
const GEO = require_(join(REPO, 'src/main/services/geoBlockClassifier.js'));

const attendi = (ms) => new Promise((r) => setTimeout(r, ms));
const FINESTRA_MS = 12000;
// Una raffica è una catena sola: la pagina non si ferma mai.
const CATENA = 'catena-della-pagina-ostile';

function bancoSafebrowse() {
  const b = { gsb: [], llm: [], sandbox: [] };
  for (const c of Object.values(SB._caches)) c.clear();
  for (const v of Object.values(SB._inFlight)) v.clear();
  SB.setProviders({
    gsb: async (u) => { b.gsb.push(u); return { listed: false }; },
    rdap: async () => 400,
    ct: async () => null,
    llm: async (m) => { b.llm.push(m); return null; },
    sandbox: async (u) => { b.sandbox.push(u); return null; },
  });
  return b;
}

// Una pagina ostile che si porta da sola su indirizzi sempre nuovi, per una
// finestra di tempo. `da` fa continuare la numerazione nella seconda finestra.
async function raffica(passo, da = 0) {
  const t0 = Date.now();
  let i = da;
  while (Date.now() - t0 < FINESTRA_MS) {
    await passo(i);
    i += 1;
    await attendi(15);
  }
  await attendi(300);
  return i;
}

test('il giudizio del modello e le finestre nascoste ripartono a ogni raffica', async () => {
  const b = bancoSafebrowse();
  const passo = (i) => {
    SB.analyze(`http://paypa1-accesso-${i}.pages.dev/login`, { hasPassword: true, catena: CATENA });
  };
  const dopo = await raffica(passo);
  const primaFinestra = b.llm.length;
  const sandboxPrima = b.sandbox.length;
  expect(primaFinestra, 'la raffica deve aver fatto partire qualcosa').toBeGreaterThan(0);
  await raffica(passo, dopo);
  expect(
    b.llm.length,
    'il conto delle chiamate al modello deve essere un tetto, non una velocità: la seconda '
    + 'finestra di raffica non deve aggiungere niente',
  ).toBe(primaFinestra);
  expect(
    b.sandbox.length,
    'lo stesso vale per le finestre nascoste con JavaScript attivo',
  ).toBe(sandboxPrima);
}, { timeout: 90_000 });

test('anche la ricerca nell\'elenco dei siti di truffa riparte a ogni raffica', async () => {
  const b = bancoSafebrowse();
  const passo = (i) => { SB.analyze(`http://vetrina-${i}.pages.dev/p${i}`, { catena: CATENA }); };
  const dopo = await raffica(passo);
  const primaFinestra = b.gsb.length;
  expect(primaFinestra, 'la raffica deve aver fatto partire qualcosa').toBeGreaterThan(0);
  await raffica(passo, dopo);
  expect(
    b.gsb.length,
    'la chiave di fabbrica dell\'owner ha una quota giornaliera: il conto deve essere un tetto, '
    + 'non una velocità che si può tenere per sempre',
  ).toBe(primaFinestra);
}, { timeout: 90_000 });

test('il riconoscimento del blocco geografico riparte a ogni raffica', async () => {
  const cache = GEO.createCache();
  let chiamate = 0;
  const complete = async () => { chiamate += 1; return 'errore_generico'; };
  const passo = (i) => GEO.classify(
    {
      title: 'Forbidden', text: 'Access denied', statusCode: 403,
      host: `bloccato-${i}.pages.dev`, url: `http://bloccato-${i}.pages.dev/p${i}`, catena: CATENA,
    },
    { complete, cache },
  );
  const dopo = await raffica(passo);
  const primaFinestra = chiamate;
  expect(primaFinestra, 'la raffica deve aver fatto partire qualcosa').toBeGreaterThan(0);
  await raffica(passo, dopo);
  expect(chiamate, 'anche qui il conto comune deve essere un tetto, non una velocità').toBe(primaFinestra);
}, { timeout: 90_000 });

test('caso di riscontro: chi naviga da sé riceve il suo controllo anche dopo la raffica', async () => {
  const b = bancoSafebrowse();
  await raffica((i) => {
    SB.analyze(`http://paypa1-accesso-${i}.pages.dev/login`, { hasPassword: true, catena: CATENA });
  });
  const dopoLaRaffica = b.llm.length;
  // L'utente apre la truffa vera: è un'altra catena, col suo conto intero.
  SB.analyze('http://paypa1-verifica-conto.com/login', { hasPassword: true, catena: 'catena-dell-utente' });
  await attendi(300);
  expect(
    b.llm.length,
    'una raffica non deve spegnere il controllo del sito che l\'utente apre da sé',
  ).toBeGreaterThan(dopoLaRaffica);
}, { timeout: 90_000 });
