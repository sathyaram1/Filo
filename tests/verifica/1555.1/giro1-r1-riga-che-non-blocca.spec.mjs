// Prova del giro 1 su #1555.1: con un 2 col ? che non blocca e un altro che blocca, il rifiuto prima del verdetto
// non deve dire che il lavoro va avanti né che gli 1 col ? escono. Non apre Filo: logica pura degli strumenti.

import { test, expect } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const lib = () => import(pathToFileURL(resolve(ROOT, 'scripts', 'lib', 'prove-tolte.mjs')).href);

test('r1 con una domanda che blocca nella stessa critica il rifiuto non dice che il lavoro va avanti', async () => {
  const { proveDaToglierePrimaDelVerdetto, testoProvePrimaDelVerdetto } = await lib();
  const findings = [
    { level: 2, sede: 'i', decision: true, text: 'Il riquadro è freddo.', domanda: { titolo: 'Riquadro', blocca: false } },
    { level: 2, sede: 'i', decision: true, text: 'Il bordo è grigio.', domanda: { titolo: 'Bordo' } },
    { level: 1, sede: 'i', decision: true, text: 'Il titolo è piccolo.', domanda: { titolo: 'Titolo', blocca: false } },
    { level: 1, sede: 'e', text: 'Il menu si chiude da solo.' },
  ];
  const prove = ['tests/verifica/901/giro1-r3-titolo.spec.mjs', 'tests/verifica/901/giro1-r4-menu.spec.mjs'];
  const fuori = proveDaToglierePrimaDelVerdetto(prove, findings, {});
  // La decisione è giusta: esce solo la prova dell'esterno, quella del 1 col ? resta a chi riprende.
  expect(fuori.map((x) => x.prova)).toEqual(['tests/verifica/901/giro1-r4-menu.spec.mjs']);
  const testo = testoProvePrimaDelVerdetto(fuori, findings);
  // Il rilievo 2 blocca: il lavoro si ferma, e chi legge non deve togliere anche la prova del rilievo 3.
  expect(testo).not.toMatch(/il lavoro non si ferma/);
  expect(testo).not.toMatch(/escono in un feedback loro/);
});
