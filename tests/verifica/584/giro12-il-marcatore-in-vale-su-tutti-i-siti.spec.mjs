// #584, dodicesimo giro — RILIEVO: «in» annuncia una persona su un sito solo, e
// la pulizia lo tratta come tale su tutti.
//
// La regola che il quinto giro ha scritto: quello che non dice chi sei resta
// leggibile, perché un punto di partenza ridotto a segnaposti non serve più a
// chi vuole riusare il percorso. Lo stesso giro ha trovato il caso di scuola —
// «/c/», che sui siti di video è il canale di una persona e sui negozi è la
// CATEGORIA — e la correzione l'ha risolto nel modo giusto: «/c/» annuncia una
// persona SOLO sui siti di video, e su tutti gli altri è un pezzo qualunque.
//
// «/in/» è lo stesso caso e non ha avuto la stessa cura. È il prefisso del
// profilo su un solo sito professionale; dappertutto altrove è la preposizione
// più comune della lingua, e il pezzo che segue è proprio quello che dice dove
// si è: «in offerta», «in evidenza», «in vendita», «in programma». Lì il pezzo
// che segue diventa un segnaposto, e di due pagine diverse dello stesso sito
// resta la stessa riga.
//
// Queste prove FISSANO IL COMPORTAMENTO DI OGGI: diventeranno rosse quando la
// pulizia guarderà il sito prima di leggere «in» come un marcatore, ed è giusto
// che sia chi corregge ad aggiornare l'attesa.

import { test, expect } from '../../fixtures/electron.mjs';

async function ripulisci(app, urls) {
  return app.evaluate(async ({ app: _a }, { urls }) => {
    const S = globalThis.SN_PATHS_SAFETY;
    const out = {};
    for (const u of urls) out[u] = S._internal.normalizedPath(u);
    return out;
  }, { urls });
}

test('RILIEVO: fuori dal sito professionale «in» cancella il pezzo che dice dove si è', async ({ app }) => {
  const casi = {
    // negozio: la pagina delle offerte e quella dei nuovi arrivi
    'https://negozio-esempio.it/prodotti/in/offerta': '/prodotti/in/[ID]',
    'https://negozio-esempio.it/prodotti/in/arrivo': '/prodotti/in/[ID]',
    // giornale
    'https://giornale-esempio.it/notizie/in/evidenza': '/notizie/in/[ID]',
    // annunci immobiliari: «in vendita» e «in affitto» sono le due sezioni
    'https://case-esempio.it/case/in/vendita': '/case/in/[ID]',
    'https://case-esempio.it/case/in/affitto': '/case/in/[ID]',
    // eventi, corsi
    'https://eventi-esempio.it/eventi/in/programma': '/eventi/in/[ID]',
    'https://scuola-esempio.it/corsi/in/aula': '/corsi/in/[ID]',
  };
  const r = await ripulisci(app, Object.keys(casi));
  for (const [u, atteso] of Object.entries(casi)) expect(`${u} -> ${r[u]}`).toBe(`${u} -> ${atteso}`);
});

test('RILIEVO: e «in» è anche il pezzo che i siti internazionali usano per l’India', async ({ app }) => {
  const casi = {
    // Su decine di siti internazionali `/in/` è il paese, e quello che segue è
    // la lingua o la categoria: cioè tutto quello che dice dove si è.
    'https://www.samsung.com/in/smartphones': '/in/[ID]',
    'https://www.hp.com/in/en/printers': '/in/[ID]/printers',
    'https://www.nike.com/in/it/scarpe': '/in/[ID]/scarpe',
  };
  const r = await ripulisci(app, Object.keys(casi));
  for (const [u, atteso] of Object.entries(casi)) expect(`${u} -> ${r[u]}`).toBe(`${u} -> ${atteso}`);
});

test('RILIEVO: e due pagine diverse dello stesso sito arrivano scritte nello stesso modo', async ({ app }) => {
  const r = await ripulisci(app, [
    'https://case-esempio.it/case/in/vendita',
    'https://case-esempio.it/case/in/affitto',
  ]);
  // Chi riusa il percorso vede due volte «da /case/in/[ID]» e non ha più
  // niente con cui scegliere fra i due.
  expect(r['https://case-esempio.it/case/in/vendita'])
    .toBe(r['https://case-esempio.it/case/in/affitto']);
});

test('mentre «/c/» — lo stesso caso, risolto al quinto giro — guarda il sito prima di decidere', async ({ app }) => {
  const casi = {
    // negozio: «/c/» è la categoria, ed è il punto di partenza più utile che ci sia
    'https://negozio-esempio.it/c/scarpe-donna': '/c/scarpe-donna',
    // sito di video: lì «/c/» è davvero il canale di una persona
    'https://www.youtube.com/c/mariorossi': '/c/[ID]',
  };
  const r = await ripulisci(app, Object.keys(casi));
  for (const [u, atteso] of Object.entries(casi)) expect(`${u} -> ${r[u]}`).toBe(`${u} -> ${atteso}`);
});

test('e sul sito professionale «in» deve continuare a nascondere il nome', async ({ app }) => {
  const r = await ripulisci(app, ['https://www.linkedin.com/in/mario-rossi']);
  expect(r['https://www.linkedin.com/in/mario-rossi']).toBe('/in/[ID]');
});

test('e sul cammino vero il pezzo perso è quello che finisce in coda', async ({ app }) => {
  const dentro = await app.evaluate(async ({ app: _a }) => {
    const C = globalThis.SN_PATHS_COLLECTOR;
    return {
      vendita: C._internal.normalizedPath('https://case-esempio.it/case/in/vendita'),
      affitto: C._internal.normalizedPath('https://case-esempio.it/case/in/affitto'),
    };
  });
  // Non è una prova sulla pulizia presa da sola: è quello che il percorso porta
  // quando entra nella coda da cui partirà.
  expect(dentro.vendita).toBe('/case/in/[ID]');
  expect(dentro.affitto).toBe('/case/in/[ID]');
});
