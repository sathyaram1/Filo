// Cronologia appunti (#256.2): una voce tolta mentre è ancora negli appunti non rientra dal primo «Incolla», anche
// dopo una riapertura e anche se è un'immagine (riconosciuta dai pixel, non dal PNG); su disco niente di leggibile.
// Appunti e impronta dei pixel sono finti, il disco è vero.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const { crea } = require('../../src/main/services/appuntiTolti.js');

// Un «PNG» finto: `data:<codifica>;px=<pixel>`. Due codifiche dello stesso disegno hanno gli stessi pixel.
const png = (px, codifica = 'a') => `data:image/png;${codifica};px=${px}`;
const pixel = (s) => {
  const m = /;px=(.*)$/.exec(Buffer.isBuffer(s) ? s.toString('utf8') : String(s));
  return m && m[1] ? `impronta-di-${m[1]}` : '';
};

function ambiente() {
  const file = join(cartellaTemporanea('filo-appunti-tolti-'), 'appunti-tolti.json');
  const appunti = { t: '', i: null };
  const apri = () => crea({
    file,
    pixel,
    appunti: { testo: async () => appunti.t, immagine: async () => (appunti.i ? Buffer.from(appunti.i) : null) },
  });
  return { file, appunti, apri };
}

const testo = (t) => ({ type: 'text', text: t });
const immagine = (dataUrl) => ({ type: 'image', dataUrl, description: 'schermata' });

test('la segnalazione, riapertura: tolta la password ancora negli appunti, dopo la riapertura l\'«Incolla» non la rimette', async () => {
  const a = ambiente();
  a.appunti.t = 'password-segretissima';
  await a.apri().voceTolta(testo('password-segretissima'));

  const dopo = a.apri();
  assert.equal(await dopo.daTenere(testo('password-segretissima'), 'paste'), false);
  assert.equal(await dopo.daTenere(testo('  password-segretissima \n'), 'paste'), false, 'gli spazi non la fanno rientrare');
  assert.equal(await dopo.daTenere(testo('altro'), 'paste'), true);
  assert.equal(await dopo.daTenere(testo('password-segretissima'), 'paste'), true, 'incollato altro, la sospensione finisce');
  assert.equal(await a.apri().daTenere(testo('password-segretissima'), 'paste'), true, 'e finisce anche su disco');
});

test('la segnalazione, immagine: la schermata tolta non rientra, anche se gli appunti la ridanno in un PNG diverso', async () => {
  const a = ambiente();
  a.appunti.i = png('rosso-blu', 'dagli-appunti');
  await a.apri().voceTolta(immagine(png('rosso-blu', 'dalla-pagina')));

  const t = a.apri();
  assert.equal(await t.daTenere(immagine(png('rosso-blu', 'dalla-pagina')), 'paste'), false);
  assert.equal(await t.daTenere(immagine(png('rosso-blu', 'un-altro-png')), 'paste'), false);
  assert.equal(await t.daTenere(testo('una parola'), 'paste'), true);
  assert.equal(await t.daTenere(immagine(png('rosso-blu')), 'paste'), false, 'incollare un testo non libera l\'immagine');
  assert.equal(await t.daTenere(immagine(png('verde')), 'paste'), true);
  assert.equal(await t.daTenere(immagine(png('rosso-blu')), 'paste'), true);
});

test('un «Incolla» subito dopo il clic che toglie aspetta la rimozione, non la scavalca', async () => {
  const a = ambiente();
  a.appunti.t = 'password';
  const t = a.apri();
  const tolta = t.voceTolta(testo('password'));
  const tenuta = t.daTenere(testo('password'), 'paste');
  await tolta;
  assert.equal(await tenuta, false);
});

test('tolta quando negli appunti c\'è altro: niente sospensione', async () => {
  const a = ambiente();
  a.appunti.t = 'altro';
  a.appunti.i = png('verde');
  const t = a.apri();
  await t.voceTolta(testo('password'));
  await t.voceTolta(immagine(png('rosso')));
  assert.equal(await t.daTenere(testo('password'), 'paste'), true);
  assert.equal(await t.daTenere(immagine(png('rosso')), 'paste'), true);
});

test('ricopiata apposta torna in cronologia; copiare altro (o incollarla dalla cronologia) non la libera', async () => {
  const a = ambiente();
  a.appunti.t = 'password';
  const t = a.apri();
  await t.voceTolta(testo('password'));
  assert.equal(await t.daTenere(testo('nota')), true);
  assert.equal(await t.daTenere(testo('password'), 'paste'), false);
  assert.equal(await t.daTenere(testo('password')), true);
  assert.equal(await t.daTenere(testo('password'), 'paste'), true);
});

test('svuotata: resta fuori ciò che era in cronologia ed è ancora negli appunti, testo e immagine', async () => {
  const a = ambiente();
  a.appunti.t = 'password';
  a.appunti.i = png('schermata', 'dagli-appunti');
  await a.apri().cronologiaSvuotata([testo('password '), testo('nota'), immagine(png('schermata', 'dalla-pagina'))]);
  const t = a.apri();
  assert.equal(await t.daTenere(testo('password'), 'paste'), false);
  assert.equal(await t.daTenere(immagine(png('schermata')), 'paste'), false);

  const b = ambiente();
  b.appunti.t = 'mai copiata con Filo';
  b.appunti.i = png('mai vista');
  await b.apri().cronologiaSvuotata([testo('nota'), immagine(png('schermata'))]);
  assert.equal(await b.apri().daTenere(testo('mai copiata con Filo'), 'paste'), true);
  assert.equal(await b.apri().daTenere(immagine(png('mai vista')), 'paste'), true);
});

test('su disco non c\'è la password né l\'immagine; un file rovinato non ferma niente', async () => {
  const a = ambiente();
  a.appunti.t = 'password-segretissima';
  a.appunti.i = png('pixel-privati');
  const t = a.apri();
  await t.voceTolta(testo('password-segretissima'));
  await t.voceTolta(immagine(png('pixel-privati')));
  const disco = readFileSync(a.file, 'utf8');
  assert.doesNotMatch(disco, /password|segretissima|pixel|privati/);
  const j = JSON.parse(disco);
  assert.match(j.t, /^[0-9a-f]{32}$/);
  assert.match(j.i, /^[0-9a-f]{32}$/);

  writeFileSync(a.file, '{ non è json', 'utf8');
  const rovinato = a.apri();
  assert.equal(await rovinato.daTenere(testo('password-segretissima'), 'paste'), true);
  await rovinato.voceTolta(testo('password-segretissima'));
  assert.equal(await a.apri().daTenere(testo('password-segretissima'), 'paste'), false);
});

test('appunti che non rispondono o immagini che non si decodificano: nessun errore, nessuna sospensione', async () => {
  const a = ambiente();
  const t = crea({
    file: a.file,
    pixel: () => { throw new Error('rotta'); },
    appunti: { testo: async () => { throw new Error('giù'); }, immagine: async () => { throw new Error('giù'); } },
  });
  await t.voceTolta(testo('password'));
  await t.voceTolta(immagine(png('x')));
  await t.cronologiaSvuotata([testo('password'), immagine(png('x'))]);
  assert.equal(await t.daTenere(testo('password'), 'paste'), true);
  assert.equal(await t.daTenere(immagine(png('x')), 'paste'), true);
  assert.equal(await t.daTenere(null, 'paste'), true);
});
