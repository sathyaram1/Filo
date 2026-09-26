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

const { PIATTAFORME, PASSI, passoFallito, leggiEsiti, componiAllarme, mancantiNoti, casella } =
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
    const esiti = { bersaglio: { outcome: 'success' }, build: { outcome: 'failure' } };
    const { titolo, testo } = componiAllarme({ ...dati, piattaforma: 'Mac', passo: 'pippo', mancanti: '', esiti });
    assert.match(titolo, /Mac/);
    assert.match(titolo, /pippo/);
    assert.match(testo, /pippo/, 'un id fuori tabella si scrive com\'è: si cerca nel registro');
    assert.match(testo, /releases\/latest\/download\/Filo-Mac\.dmg/);
  });

  // #733 giro 1: il feedback diceva SEMPRE che il download rispondeva 404 e che
  // l'aggiornamento automatico era muto, anche quando mancava il solo foglietto
  // del primo avvio. Chi lo prendeva in mano leggeva due cose che si
  // contraddicevano, e cercava un guasto più grosso di quello vero.
  describe('dichiara rotto solo quello che è rotto davvero', () => {
    const riuscito = { outcome: 'success' };
    const perso = (o) => componiAllarme({ ...dati, mancanti: '', esiti: o });

    test('il controllo finale ha guardato la release: il suo elenco vince', () => {
      const { titolo, testo } = componiAllarme({
        ...dati, passo: 'controllo', mancanti: 'Se-Filo-non-si-apre-Linux.txt',
        esiti: { build: riuscito, istruzioni: riuscito, controllo: { outcome: 'failure' } },
      });
      assert.doesNotMatch(testo, /404/, 'il pacchetto è nella release: il download non risponde 404');
      assert.doesNotMatch(testo, /aggiornamento automatico legge/, 'il manifesto è nella release: l\'aggiornamento funziona');
      assert.match(testo, /mancano: Se-Filo-non-si-apre-Linux\.txt/);
      assert.doesNotMatch(titolo, /non è nella release/, 'la release è incompleta, non vuota');
    });

    test('fermo dopo la costruzione: c\'è già tutto tranne quello che manca da caricare', () => {
      const { testo } = perso({ bersaglio: riuscito, checkout: riuscito, build: riuscito, istruzioni: { outcome: 'failure' } });
      assert.match(testo, /mancano: Se-Filo-non-si-apre-Linux\.txt/);
      assert.doesNotMatch(testo, /404/);
    });

    test('fermo prima della costruzione: nella release non c\'è niente, e si dice', () => {
      const { titolo, testo } = perso({ bersaglio: riuscito, checkout: riuscito, build: { outcome: 'failure' } });
      for (const file of PIATTAFORME.Linux.attesi) assert.ok(testo.includes(file), `manca ${file} dall'elenco`);
      assert.match(testo, /404/, 'qui il download è davvero rotto e va detto');
      assert.match(testo, /aggiornamento automatico legge/);
      assert.match(titolo, /non è nella release/);
    });

    test('esiti illeggibili: non si indovina, si manda a guardare la release', () => {
      const { testo } = componiAllarme({ ...dati, mancanti: '', esiti: null });
      assert.doesNotMatch(testo, /404/, 'senza esiti non si può affermare che il download sia rotto');
      assert.match(testo, /non si sa da qui/);
      assert.match(testo, /Filo-Linux\.AppImage/, 'va comunque detto cosa deve esserci');
    });

    test('ogni file atteso sa da quale passo arriva, o non si può sapere cosa manca', () => {
      for (const [nome, conf] of Object.entries(PIATTAFORME)) {
        for (const file of conf.attesi) {
          assert.ok(conf.attaccaDa[file], `${nome}: nessuno dice quale passo attacca ${file}`);
          assert.ok(PASSI[conf.attaccaDa[file]], `${nome}: il passo che attacca ${file} non è fra quelli del workflow`);
        }
      }
    });
  });

  test('senza niente in mano spedisce lo stesso, senza scrivere «undefined»', () => {
    const { titolo, testo } = componiAllarme();
    assert.ok(titolo.length > 0);
    assert.doesNotMatch(titolo + testo, /undefined|null|\[object/);
    assert.match(titolo, /piattaforma non indicata/);
    // Senza versione il lavoro non ha ancora toccato nessuna release: il testo
    // dice quello, e NON che dei file sono andati persi (#733, secondo giro).
    assert.match(testo, /nessuna release è stata toccata/);
    assert.doesNotMatch(testo, /404|aggiornamento automatico/);
  });

  // L'avviso racconta solo quello che ha guardato. Quando il controllo finale
  // non riesce a leggere la pagina della versione, dedurre dai passi che i file
  // ci sono tutti faceva uscire un titolo che annunciava i mancanti senza
  // nominarne nessuno, contro un testo che diceva il contrario (#733, giro 2).
  test('il titolo non annuncia mai un elenco vuoto, e non contraddice il testo', () => {
    const S = (o) => ({ outcome: o });
    for (const nome of Object.keys(PIATTAFORME)) {
      const { titolo, testo } = componiAllarme({
        piattaforma: nome,
        versione: 'v0.2.229',
        repo: 'sathyaram1/Filo',
        passo: 'controllo',
        mancanti: '',
        esiti: { build: S('success'), istruzioni: S('success'), controllo: S('failure') },
      });
      assert.doesNotMatch(titolo, /manca\s*$|manca\s+\(/, `il titolo annuncia i file mancanti e non ne nomina nessuno: «${titolo}»`);
      assert.ok(!(/incompleta/.test(titolo) && /dovrebbero esserci tutti/.test(testo)),
        `il titolo dice incompleta e il testo dice che i file ci sono: «${titolo}»`);
      for (const f of PIATTAFORME[nome].attesi) {
        assert.ok(!titolo.includes(f), `il titolo dà per perso ${f}, che nessuno è andato a guardare`);
      }
    }
  });

  // Il workflow lancia una COPIA dello script fuori dalla copia di lavoro. Se
  // quel percorso passa da un collegamento e lo script non si riconosce come
  // avviato, non fa niente ed esce 0: l'allarme resta muto e il controllo
  // finale riceve un elenco vuoto, cioè passa verde senza guardare un file.
  test('avviato da una copia, dietro un collegamento, lo script lavora lo stesso', () => {
    const base = mkdtempSync(join(tmpdir(), 'filo-allarme-'));
    const vero = join(base, 'vero', 'scripts');
    mkdirSync(vero, { recursive: true });
    for (const f of ['release-platform-alarm.mjs', 'build-alarm.mjs']) {
      copyFileSync(join(RADICE, 'scripts', f), join(vero, f));
    }
    symlinkSync(join(base, 'vero'), join(base, 'link'), 'dir');
    const uscita = execFileSync(process.execPath,
      [join(base, 'link', 'scripts', 'release-platform-alarm.mjs'), '--attesi', 'Linux'], { encoding: 'utf8' });
    assert.deepEqual(uscita.trim().split('\n'), PIATTAFORME.Linux.attesi,
      'lo script non si riconosce come avviato: esce verde senza fare niente, e chi lo chiama non se ne accorge');
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
