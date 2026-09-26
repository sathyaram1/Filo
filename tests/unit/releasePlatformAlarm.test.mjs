// L'allarme delle mezze release di piattaforma (scripts/release-platform-alarm.mjs).
// Non deve fare rete: qui si prova solo il testo che comporrebbe.
// La regola di dove e quando parte sta in tests/unit/releaseSuite.test.mjs.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(resolve(ROOT, 'package.json'));
const PKG = require('./package.json');

const { PIATTAFORME, PASSI, passoFallito, leggiEsiti, componiAllarme } =
  await import('../../scripts/release-platform-alarm.mjs');

const ESITI_ESEMPIO = JSON.stringify({
  checkout: { outcome: 'success', conclusion: 'success' },
  node: { outcome: 'success', conclusion: 'success' },
  build: { outcome: 'failure', conclusion: 'failure' },
  controllo: { outcome: 'skipped', conclusion: 'skipped' },
});

describe('quale passo si è fermato', () => {
  test('è il primo con esito `failure`, nell\'ordine in cui Actions li elenca', () => {
    assert.equal(passoFallito(leggiEsiti(ESITI_ESEMPIO)), 'build');
    assert.equal(passoFallito({
      build: { outcome: 'failure' }, controllo: { outcome: 'failure' },
    }), 'build');
  });

  test('senza esiti leggibili non si inventa un passo, e non si smette di spedire', () => {
    for (const rotto of ['', '{', 'null', undefined, '[]']) {
      assert.equal(passoFallito(leggiEsiti(rotto)), '', `esiti «${rotto}»`);
    }
    assert.equal(passoFallito({ build: { outcome: 'success' } }), '');
    const { titolo, testo } = componiAllarme({ piattaforma: 'Linux', versione: 'v1.2.3', passo: '' });
    assert.match(titolo, /passo non identificato/);
    assert.match(testo, /non identificato/);
  });
});

describe('il feedback che si apre', () => {
  const dati = {
    piattaforma: 'Linux',
    versione: 'v0.2.229',
    passo: passoFallito(leggiEsiti(ESITI_ESEMPIO)),
    esecuzione: 'https://github.com/sathyaram1/Filo/actions/runs/42',
    repo: 'sathyaram1/Filo',
    mancanti: 'Filo-Linux.AppImage latest-linux.yml',
  };

  test('il titolo nomina piattaforma, versione e passo fallito', () => {
    const { titolo } = componiAllarme(dati);
    assert.match(titolo, /Linux/);
    assert.match(titolo, /v0\.2\.229/);
    assert.match(titolo, /build/);
  });

  test('il testo porta il link all\'esecuzione, i file mancanti e il collegamento che risponde 404', () => {
    const { testo } = componiAllarme(dati);
    assert.match(testo, /actions\/runs\/42/, 'senza il registro chi lo prende riparte da zero');
    assert.match(testo, /Filo-Linux\.AppImage, latest-linux\.yml\./);
    assert.match(testo, /releases\/latest\/download\/Filo-Linux\.AppImage/);
    assert.match(testo, /latest-linux\.yml/, 'va detto anche che l\'aggiornamento automatico si ferma');
  });

  test('dice che la release Windows resta, e che rilanciare il lavoro non ripubblica', () => {
    const { testo } = componiAllarme(dati);
    assert.match(testo, /Windows/);
    assert.match(testo, /non va tolta/);
    // Il tranello vero: senza commit nuovi il lavoro non rifà niente, e chi
    // riprova a mano crede di aver sistemato.
    assert.match(testo, /commit dopo l'ultimo tag/);
    assert.match(testo, /STESSA release/);
  });

  test('vale per il Mac con gli stessi pezzi, e un passo sconosciuto si porta dietro il suo nome', () => {
    const { titolo, testo } = componiAllarme({ ...dati, piattaforma: 'Mac', passo: 'pippo', mancanti: '' });
    assert.match(titolo, /Mac/);
    assert.match(titolo, /pippo/);
    assert.match(testo, /pippo/, 'un id fuori tabella si scrive com\'è: si cerca nel registro');
    assert.match(testo, /releases\/latest\/download\/Filo-Mac\.dmg/);
    assert.doesNotMatch(testo, /File attesi e non trovati/, 'senza mancanti non si scrive una riga vuota');
  });

  test('senza niente in mano spedisce lo stesso, senza scrivere «undefined»', () => {
    const { titolo, testo } = componiAllarme();
    assert.ok(titolo.length > 0);
    assert.doesNotMatch(titolo + testo, /undefined|null|\[object/);
    assert.match(titolo, /piattaforma non indicata/);
    assert.match(titolo + testo, /versione non indicata/);
  });

  test('ogni passo del workflow ha una descrizione, e nessuna è vuota', () => {
    for (const [id, descrizione] of Object.entries(PASSI)) {
      assert.ok(descrizione && descrizione.trim().length > 3, `il passo ${id} non dice cosa stava facendo`);
    }
  });
});

// I nomi dei file non si inventano: escono da electron-builder, che li prende
// da package.json. Se qualcuno cambia artifactName, il controllo del workflow
// cercherebbe per sempre un file che non nasce più.
test('i file attesi seguono i nomi che il pacchettizzatore produce davvero', () => {
  const nome = (piatt, ext) => PKG.build[piatt].artifactName.replace('${ext}', ext);
  assert.ok(PIATTAFORME.Linux.attesi.includes(nome('linux', 'AppImage')));
  assert.ok(PIATTAFORME.Mac.attesi.includes(nome('mac', 'dmg')));
  assert.ok(PIATTAFORME.Mac.attesi.includes(nome('mac', 'zip')));
  // Il file che l'aggiornamento automatico legge: senza, chi ha il pacchetto
  // resta fermo a quella versione per sempre.
  assert.ok(PIATTAFORME.Linux.attesi.includes('latest-linux.yml'));
  assert.ok(PIATTAFORME.Mac.attesi.includes('latest-mac.yml'));
  for (const piatt of Object.values(PIATTAFORME)) {
    assert.ok(piatt.attesi.includes(piatt.scarica), 'il file del bottone «Scarica» deve stare fra gli attesi');
    assert.ok(piatt.attesi.includes(piatt.aggiornamento));
  }
});
