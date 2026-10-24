// L'elenco dei siti che il modello può scrivere a memoria (#553): home, ricerca interna e voci riconosciute con le loro
// parole; tutto il resto, anche sullo stesso sito, non è dell'elenco.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'sitiComuni.js'));
const S = globalThis.SN_SITI_COMUNI;

test('ogni sito dell\'elenco riconosce la sua home e la ricerca che costruisce', () => {
  for (const sito of S.SITI) {
    assert.equal(S.riconosci(sito.home)?.tipo, 'home', sito.nome);
    if (!sito.cerca) continue;
    const url = S.costruisci(sito.home, 'pasta e fagioli');
    assert.ok(url, sito.nome);
    const r = S.riconosci(url);
    assert.equal(r?.tipo, 'cerca', `${sito.nome}: ${url}`);
    assert.equal(r.parole, 'pasta e fagioli', sito.nome);
  }
});

test('una voce di Wikipedia o di MDN porta le parole del titolo', () => {
  assert.deepEqual(S.riconosci('https://it.wikipedia.org/wiki/Seconda_guerra_mondiale'), { sito: 'Wikipedia', tipo: 'pagina', parole: 'Seconda guerra mondiale' });
  assert.equal(S.riconosci('https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect').parole, 'Web API Element getBoundingClientRect');
});

test('fuori dalla forma dell\'elenco non è dell\'elenco', () => {
  for (const url of [
    'https://www.amazon.it/s?k=cuffie&tag=attaccante',
    'https://www.amazon.it/dp/B0ABC12345',
    'https://www.google.it/url?q=https://attaccante.example/',
    'https://www.youtube.com/redirect?q=https://attaccante.example/',
    'https://utente:segreto@www.amazon.it/',
    'https://www.amazon.it/#Mario_Rossi',
    'https://amazon.it.attaccante.example/',
    'https://it.wikipedia.org/wiki/Bologna?d=x',
    'https://xx-dati-utente.wikipedia.org/wiki/Bologna',
    'http://www.amazon.it:8080/',
  ]) assert.equal(S.riconosci(url), null, url);
});

test('l\'elenco per il modello nomina home e ricerca di ogni sito', () => {
  const t = S.perModello();
  for (const sito of S.SITI) assert.ok(t.includes(sito.home), sito.nome);
  assert.ok(t.includes('https://www.amazon.it/s?k=…'));
});
