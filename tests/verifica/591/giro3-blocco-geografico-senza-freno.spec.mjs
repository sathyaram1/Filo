// Verifica #591 — giro 3. Il riconoscimento del blocco geografico non ha
// nessun freno.
//
// La segnalazione mette in fila quattro chiamate che Filo fa da solo mentre si
// naviga e che nessun tetto fermava, e per una di quelle — il giudizio sui
// siti pericolosi — chiede esplicitamente dei freni (tetto di concorrenza,
// coda, tempo di vita, un conto per dominio). Quei freni ci sono e tengono.
//
// Il riconoscimento del blocco geografico, che sta nella stessa fila e parte
// allo stesso modo (a ogni caricamento di pagina, da sé, sulla chiave
// condivisa), non ne ha ricevuto nessuno: l'unico ricordo è una cache per
// (indirizzo, forma del percorso), e una pagina che si porta da sola su
// percorsi sempre nuovi — o su sottodomini sempre nuovi — fa partire una
// chiamata al modello per ognuno, finché il tetto mensile non si esaurisce.
// Esaurito quello si ferma tutta l'AI di Filo, per il resto del mese.
//
// In più la stessa pagina viene classificata DUE volte: il campione si prende
// appena la pagina ha finito di caricare e di nuovo due secondi dopo, e
// nessuno dei due sa dell'altro (la cache si riempie solo quando la risposta
// arriva, e un modello ci mette più di due secondi).
//
// Logica pura: il classificatore riceve da fuori la funzione che chiama il
// modello, qui contata.

import { test, expect } from '@playwright/test';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require_ = createRequire(join(REPO, 'package.json'));
require_(join(REPO, 'src/shared/contenutoEsterno.js'));
const Geo = require_(join(REPO, 'src/main/services/geoBlockClassifier.js'));

// Quante chiamate al modello un solo sito ostile può far partire prima che
// qualcosa lo fermi. Il giudizio sui siti pericolosi si ferma a quattro per
// dominio: qui si chiede solo che un freno ESISTA, senza dire quale.
const TETTO_RAGIONEVOLE = 20;

test('una sola pagina ostile fa partire una chiamata al modello per ogni percorso nuovo', async () => {
  const cache = Geo.createCache();
  let chiamate = 0;
  const complete = async () => { chiamate++; return 'errore_generico'; };
  // Duecento navigazioni sullo stesso sito, percorsi sempre diversi, ognuna
  // una risposta ambigua (403): è quello che fa una pagina che si sposta da
  // sola con due righe di JavaScript.
  for (let i = 0; i < 200; i++) {
    await Geo.classify(
      { title: 'Errore', text: '', statusCode: 403, host: 'sito-ostile.esempio', url: `https://sito-ostile.esempio/p${i}` },
      { complete, cache },
    );
  }
  expect(chiamate,
    `un solo sito ha fatto partire ${chiamate} chiamate al modello sulla chiave condivisa: manca un freno`)
    .toBeLessThanOrEqual(TETTO_RAGIONEVOLE);
});

test('i sottodomini sempre nuovi funzionano anche qui', async () => {
  const cache = Geo.createCache();
  let chiamate = 0;
  const complete = async () => { chiamate++; return 'errore_generico'; };
  for (let i = 0; i < 100; i++) {
    await Geo.classify(
      { title: 'Errore', text: '', statusCode: 403, host: `s${i}.sito-ostile.esempio`, url: `https://s${i}.sito-ostile.esempio/` },
      { complete, cache },
    );
  }
  expect(chiamate,
    `cento sottodomini dello stesso dominio hanno fatto partire ${chiamate} chiamate al modello`)
    .toBeLessThanOrEqual(TETTO_RAGIONEVOLE);
});

test('la stessa pagina non si paga due volte', async () => {
  // I due campioni che Filo prende della stessa pagina (subito e dopo due
  // secondi) partono entrambi: il secondo non sa che il primo è ancora in
  // viaggio, perché il ricordo si scrive solo quando la risposta arriva.
  const cache = Geo.createCache();
  let chiamate = 0;
  const complete = async () => { chiamate++; await new Promise((r) => setTimeout(r, 50)); return 'errore_generico'; };
  const input = { title: 'Errore', text: '', statusCode: 403, host: 'sito.esempio', url: 'https://sito.esempio/video' };
  await Promise.all([
    Geo.classify(input, { complete, cache }),
    Geo.classify(input, { complete, cache }),
  ]);
  expect(chiamate, 'due campioni della stessa pagina devono costare una chiamata sola').toBe(1);
});

test('caso di riscontro: il ricordo funziona quando la risposta è già arrivata', async () => {
  const cache = Geo.createCache();
  let chiamate = 0;
  const complete = async () => { chiamate++; return 'errore_generico'; };
  const input = { title: 'Errore', text: '', statusCode: 403, host: 'sito.esempio', url: 'https://sito.esempio/video/1' };
  await Geo.classify(input, { complete, cache });
  await Geo.classify({ ...input, url: 'https://sito.esempio/video/2' }, { complete, cache });
  expect(chiamate, 'stessa forma di percorso: una chiamata sola').toBe(1);
});
