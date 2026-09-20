// Verifica #591 — giro 2. Il verdetto del controllo profondo sborda da un sito
// ai suoi vicini.
//
// Il freno del controllo profondo (giudizio del modello + finestra nascosta) è
// stato spostato dall'indirizzo completo al «dominio registrabile», per non
// farsi aggirare da sottodomini sempre nuovi. Su un dominio normale quel
// dominio è il sito. Sulle piattaforme dove ogni utente riceve un sottodominio
// — pages.dev, github.io, vercel.app, blogspot.com… — il dominio registrabile
// è la PIATTAFORMA, e da lì in poi tutti i siti ospitati lì condividono lo
// stesso ricordo: il verdetto di uno vale per tutti gli altri.
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

// Le cache del rilevatore vivono nel modulo: ogni caso parte pulito.
function pulisci() {
  for (const c of Object.values(SB._caches)) {
    if (typeof c.clear === 'function') c.clear();
  }
  for (const s of Object.values(SB._inFlight)) s.clear();
}

test('la finestra nascosta di un sito di truffa marchia i siti vicini che non c\'entrano', async () => {
  pulisci();
  SB.setProviders({
    gsb: null,
    rdap: null,
    ct: null,
    llm: async () => null,
    sandbox: async () => ({ verdict: 'dangerous', finalUrl: 'https://x', redirects: [], download: 'setup.exe' }),
  });
  // Un sito di truffa ospitato su Cloudflare Pages: il controllo profondo lo
  // trova pericoloso. Giusto così.
  SB.analyze('https://paypa1-accedi.pages.dev/login', DA_EMAIL, () => {});
  await attendi(200);
  expect(SB.checkSync('https://paypa1-accedi.pages.dev/login', DA_EMAIL).level).toBe('pericoloso');

  // Tre siti che non c'entrano niente, ospitati sulla stessa piattaforma.
  for (const url of [
    'https://portfolio-di-marco.pages.dev/',
    'https://documentazione-progetto.pages.dev/guida',
    'https://sito-azienda.pages.dev/contatti',
  ]) {
    const v = SB.checkSync(url, {});
    expect(v.level, `${url} non deve ereditare il verdetto di un altro sito`).not.toBe('pericoloso');
  }
});

test('il giudizio del modello su un sito di truffa mette l\'avviso sui siti vicini', async () => {
  pulisci();
  SB.setProviders({
    gsb: null,
    rdap: null,
    ct: null,
    llm: async () => ({ suspicious: true, reason: 'Chiede credenziali o dati personali su un dominio non ufficiale.', confidence: 'high' }),
    sandbox: async () => null,
  });
  SB.analyze('https://paypa1-accedi.pages.dev/login', DA_EMAIL, () => {});
  await attendi(200);

  const vicino = SB.checkSync('https://ricette-della-nonna.pages.dev/torte', {});
  expect(vicino.level, 'un sito di ricette non deve ereditare l\'avviso di un sito di truffa').toBe('safe');
});

test('un vicino già controllato impedisce il controllo profondo di un sito di truffa', async () => {
  pulisci();
  const finestre = [];
  SB.setProviders({
    gsb: null,
    rdap: null,
    ct: null,
    llm: async () => ({ suspicious: false, reason: null }),
    sandbox: async (url) => { finestre.push(url); return { verdict: 'clean' }; },
  });
  // Primo sito sospetto della piattaforma: controllato, risulta pulito.
  SB.analyze('https://ap0le-store.pages.dev/x', DA_EMAIL, () => {});
  await attendi(200);
  expect(finestre.length).toBe(1);

  // Secondo sito, di tutt'altro proprietario e di tutt'altra truffa: non viene
  // controllato affatto, si prende il "pulito" del primo.
  SB.analyze('https://banca-intesa-accesso.pages.dev/login', DA_EMAIL, () => {});
  await attendi(200);
  expect(finestre.length,
    'ogni sito deve avere il suo controllo profondo, non quello del vicino').toBe(2);
});

test('su un dominio normale il freno resta dov\'era: un solo controllo per dominio', async () => {
  // Caso di riscontro: quello che il freno per dominio doveva ottenere — e che
  // deve continuare a valere — è che una spruzzata di sottodomini sullo stesso
  // dominio NON moltiplichi i controlli.
  pulisci();
  let giudizi = 0;
  let finestre = 0;
  SB.setProviders({
    gsb: null,
    rdap: null,
    ct: null,
    llm: async () => { giudizi++; await attendi(10); return { suspicious: false, reason: null }; },
    sandbox: async () => { finestre++; await attendi(10); return { verdict: 'clean' }; },
  });
  for (let i = 0; i < 50; i++) {
    SB.analyze(`http://paypa1-accedi-${i}.esempio-verifica-591-giro2.tk/login`, DA_EMAIL, () => {});
  }
  await attendi(400);
  expect(giudizi).toBe(1);
  expect(finestre).toBe(1);
});
