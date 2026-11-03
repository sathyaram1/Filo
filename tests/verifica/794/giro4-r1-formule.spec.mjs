// #794 giro 4: la sentinella deve prendere le frasi che dicono chi corregge anche col verbo davanti,
// senza il pronome, e con un inciso fra due virgole. Ogni frase è spezzata su due righe, perché la
// camminata dei file di prova legge riga per riga: a formule curate, la frase intera la prenderebbe qui.
import { test, expect } from '@playwright/test';
import { OVUNQUE } from '../../helpers/formule-vietate.mjs';

const FRASI = [
  ['corregge',
    'chi ha scritto la critica'],
  ['a correggere è',
    'chi ha verificato'],
  ['i rilievi li corregge',
    'chi ha verificato'],
  ['chi ha registrato la critica',
    'poi corregge i rilievi'],
  ['la correzione la fa',
    'chi ha verificato'],
  ['poi tocca a te',
    'correggere i rilievi della tua critica'],
  ['la correzione, dopo la critica,',
    'la fa il verificatore'],
  ['il verificatore, a critica registrata,',
    'passa alla correzione'],
].map((pezzi) => pezzi.join(' '));

test('r1 le frasi che dicono chi corregge accendono la sentinella in ogni ordine', () => {
  const passate = FRASI.filter((f) => !OVUNQUE.some((r) => r.test(f)));
  expect(passate).toEqual([]);
});
