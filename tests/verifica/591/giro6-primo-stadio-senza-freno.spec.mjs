// Verifica #591 — giro 6. Il PRIMO stadio della verifica dei siti pericolosi
// non ha nessun freno.
//
// La segnalazione descrive così il caso peggiore: «qualunque indirizzo http
// fuori dai fidati fa partire [una chiamata] … l'unico freno è una cache per
// host, che si aggira con sottodomini sempre nuovi». I giri passati hanno messo
// un freno ai due stadi PROFONDI (il giudizio del modello e la finestra
// nascosta). Lo stadio che parte PRIMA di loro — la ricerca dell'indirizzo
// nella blacklist di Google, sulla chiave condivisa dell'owner, più le due
// domande sull'età del dominio a due servizi pubblici — è rimasto come lo
// descrive la segnalazione: nessun gettone, nessun conto, nessun tetto.
//
// Tre porte, tutte sulla stessa causa — queste prove erano rosse quando il giro
// è cominciato:
//   1. sottodomini sempre nuovi → una chiamata a testa, all'infinito;
//   2. le due domande sull'età partono per lo STESSO dominio a ogni
//      sottodomino, perché non c'è né un segno «già in volo» né un ricordo
//      scritto prima che la risposta torni;
//   3. la stessa pagina paga due volte: i due cammini che partono a ogni
//      navigazione (la scheda che ha finito di navigare e lo script della
//      pagina) chiedono tutti e due, e nessuno dei due sa dell'altro.
//
// Logica pura: le chiamate di rete sono finte.

import { test, expect } from '@playwright/test';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require_ = createRequire(join(REPO, 'package.json'));
const SB = require_(join(REPO, 'src/main/services/safebrowse/index.js'));

const attendi = (ms) => new Promise((r) => setTimeout(r, ms));

// Banco: registra ogni chiamata di rete che parte, e azzera le cache fra un
// caso e l'altro così ogni prova parte da Filo appena aperto.
function banco({ lento = 0 } = {}) {
  const b = { gsb: [], rdap: [], ct: [], llm: [], sandbox: [] };
  for (const c of Object.values(SB._caches)) c.clear();
  for (const v of Object.values(SB._inFlight)) v.clear();
  SB.setProviders({
    gsb: async (url) => { if (lento) await attendi(lento); b.gsb.push(url); return { listed: false }; },
    rdap: async (reg) => { if (lento) await attendi(lento); b.rdap.push(reg); return 400; },
    ct: async (reg) => { if (lento) await attendi(lento); b.ct.push(reg); return { firstSeenDays: 400 }; },
    llm: async (meta) => { b.llm.push(meta); return null; },
    sandbox: async (url) => { b.sandbox.push(url); return null; },
  });
  return b;
}

test('sottodomini sempre nuovi non fanno partire una richiesta a testa', async () => {
  const b = banco();
  for (let i = 0; i < 200; i++) {
    SB.analyze(`http://s${i}.esca-di-chi-attacca.com/pagina?u=${i}`, {});
  }
  await attendi(200);
  // Gli stadi profondi il freno ce l'hanno: uno solo su duecento.
  expect(b.llm.length + b.sandbox.length,
    'gli stadi profondi hanno il loro freno').toBeLessThanOrEqual(2);
  // E adesso ce l'ha anche il primo.
  expect(b.gsb.length,
    'duecento sottodomini non devono fare duecento richieste sulla chiave dell\'owner').toBeLessThan(200);
});

test('le domande sull\'età non ripartono per lo stesso dominio a ogni sottodominio', async () => {
  const b = banco({ lento: 30 });
  for (let i = 0; i < 50; i++) {
    SB.analyze(`http://n${i}.un-solo-dominio-xyz.com/`, {});
  }
  await attendi(400);
  const dominiChiesti = new Set(b.rdap);
  expect(dominiChiesti.size, 'il dominio è uno solo').toBe(1);
  expect(b.rdap.length,
    'lo stesso dominio non deve essere chiesto cinquanta volte a un servizio pubblico').toBeLessThan(10);
  expect(b.ct.length,
    'idem per la seconda domanda sull\'età').toBeLessThan(10);
});

test('la stessa pagina non si paga due volte: i due cammini della navigazione si vedono', async () => {
  const b = banco({ lento: 60 });
  // Quello che succede a ogni navigazione: la scheda ha finito di navigare e
  // lo script della pagina chiede il verdetto. Stesso indirizzo, stesso istante.
  SB.analyze('http://sito-qualunque-xyz.com/pagina', {});
  SB.analyze('http://sito-qualunque-xyz.com/pagina', {});
  await attendi(400);
  expect(b.gsb.length, 'una pagina, una richiesta').toBe(1);
  expect(b.rdap.length, 'una pagina, una domanda sull\'età').toBe(1);
});

test('caso di riscontro: la seconda visita allo stesso indirizzo non richiede niente', async () => {
  const b = banco();
  SB.analyze('http://sito-ricordato-xyz.com/a', {});
  await attendi(150);
  const dopoLaPrima = b.gsb.length;
  SB.analyze('http://sito-ricordato-xyz.com/a', {});
  await attendi(150);
  expect(b.gsb.length, 'il ricordo per indirizzo funziona').toBe(dopoLaPrima);
});
