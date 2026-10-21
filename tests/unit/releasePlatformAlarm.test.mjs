// L'allarme delle mezze release di piattaforma (scripts/release-platform-alarm.mjs).
// Niente rete vera: chiavi e testo da release date, e lo script intero contro GitHub e server finti in locale.
// La regola di dove e quando parte sta in tests/unit/releaseSuite.test.mjs.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, copyFileSync } from 'node:fs';
import { execFileSync, execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { cartellaTemporanea, collegaCartella } from '../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(resolve(ROOT, 'package.json'));
const PKG = require('./package.json');

const {
  PIATTAFORME, PASSI, PAGINE_MAX, passoFallito, leggiEsiti, componiAllarme, casella, chiaviAllarme,
  leggiRilasci, paginaDellaVersione, ultimaUscita, ultimaPubblicata, lettoreImpronte,
} = await import('../../scripts/release-platform-alarm.mjs');

// Una release come la legge l'avviso; `con` sono i file attaccati.
const R = (tag, con = [], extra = {}) => ({ tag, bozza: false, anteprima: false, allegati: con, ...extra });
const TUTTI_MAC = PIATTAFORME.Mac.attesi;
const TUTTI_LINUX = PIATTAFORME.Linux.attesi;
const WIN = ['Filo-Setup.exe', 'latest.yml'];

// Senza chiavi il server tornerebbe al «un feedback aperto per mittente», che ha
// inghiottito tre settimane di allarmi dietro a un feedback parcheggiato. Con una
// chiave fissa per piattaforma inghiottiva il guasto NUOVO di una piattaforma
// tornata a uscire dietro al feedback del guasto vecchio (#752).
describe('la chiave dell\'allarme: la piattaforma e l\'ultima versione uscita per lei', () => {
  test('il caso di #752: rotta alla 301, uscita alla 302, rotta di nuovo alla 303 → chiave nuova', () => {
    const storia = [R('v0.2.300', [...WIN, ...TUTTI_MAC]), R('v0.2.301', WIN), R('v0.2.302', [...WIN, ...TUTTI_MAC]), R('v0.2.303', WIN)];
    const alla301 = chiaviAllarme('Mac', { versione: 'v0.2.301', rilasci: storia.slice(0, 2) });
    const alla303 = chiaviAllarme('Mac', { versione: 'v0.2.303', rilasci: storia });
    assert.deepEqual(alla301, ['piattaforma:mac:dopo-v0.2.300']);
    assert.deepEqual(alla303, ['piattaforma:mac:dopo-v0.2.302']);
    assert.notDeepEqual(alla301, alla303, 'il guasto dopo un\'uscita finirebbe nel feedback del guasto vecchio');
  });

  test('finché la piattaforma resta rotta la chiave non cambia: nessun doppione', () => {
    const storia = [R('v0.2.300', [...WIN, ...TUTTI_LINUX]), R('v0.2.301', WIN), R('v0.2.302', WIN), R('v0.2.303', WIN)];
    const chiavi = ['v0.2.301', 'v0.2.302', 'v0.2.303'].map((v) => chiaviAllarme('Linux', { versione: v, rilasci: storia })[0]);
    assert.deepEqual(new Set(chiavi), new Set(['piattaforma:linux:dopo-v0.2.300']));
    // Una release con il programma ma senza il foglietto non è uscita per intero: la piattaforma è ancora rotta.
    const monca = [R('v0.2.300', TUTTI_LINUX), R('v0.2.301', ['Filo-Linux.AppImage', 'latest-linux.yml']), R('v0.2.302', WIN)];
    assert.deepEqual(chiaviAllarme('Linux', { versione: 'v0.2.302', rilasci: monca }), ['piattaforma:linux:dopo-v0.2.300']);
  });

  test('Mac e Linux contano ciascuno le proprie uscite', () => {
    const storia = [R('v0.2.300', [...TUTTI_MAC, ...TUTTI_LINUX]), R('v0.2.301', TUTTI_MAC), R('v0.2.302', WIN)];
    assert.deepEqual(chiaviAllarme('Mac', { versione: 'v0.2.302', rilasci: storia }), ['piattaforma:mac:dopo-v0.2.301']);
    assert.deepEqual(chiaviAllarme('Linux', { versione: 'v0.2.302', rilasci: storia }), ['piattaforma:linux:dopo-v0.2.300']);
  });

  test('una ripubblicazione a mano di una versione vecchia guarda solo le uscite prima di lei', () => {
    const storia = [R('v0.2.300', TUTTI_MAC), R('v0.2.301', WIN), R('v0.2.302', TUTTI_MAC), R('v0.2.303', TUTTI_MAC)];
    assert.deepEqual(chiaviAllarme('Mac', { versione: 'v0.2.301', rilasci: storia }), ['piattaforma:mac:dopo-v0.2.300'],
      'il riattacco della 301 che fallisce è lo stesso guasto della 301');
  });

  test('bozze e anteprime non sono uscite, e l\'ordine dell\'elenco non conta', () => {
    const storia = [R('v0.2.303', WIN), R('v0.2.302', TUTTI_MAC, { bozza: true }), R('v0.2.299', TUTTI_MAC),
      R('v0.2.301', TUTTI_MAC, { anteprima: true }), R('v0.2.10', TUTTI_MAC)];
    assert.equal(ultimaUscita(storia, 'Mac', 'v0.2.303'), 'v0.2.299', 'v0.2.299 viene dopo v0.2.10: si confrontano i numeri, non le lettere');
  });

  test('mai uscita, versione inesistente, senza versione, release non lette: chiavi distinte, mai quella fissa', () => {
    const storia = [R('v0.2.300', WIN)];
    assert.deepEqual(chiaviAllarme('Mac', { versione: 'v0.2.300', rilasci: storia }), ['piattaforma:mac:dopo-nessuna']);
    assert.deepEqual(chiaviAllarme('Mac', { versione: 'v9.9.9', rilasci: storia }), ['piattaforma:mac:inesistente-v9.9.9']);
    assert.deepEqual(chiaviAllarme('Mac', { versione: '', rilasci: storia }), ['piattaforma:mac:senza-versione']);
    // Senza release lette non si sa se la piattaforma è tornata a uscire: la chiave della versione apre
    // al più un doppione, la chiave fissa inghiottirebbe il guasto in un feedback vecchio.
    assert.deepEqual(chiaviAllarme(' Linux ', { versione: 'v0.2.300', rilasci: null }), ['piattaforma:linux:in-v0.2.300']);
    assert.deepEqual(chiaviAllarme('', {}), ['piattaforma'], 'anche senza nome parte con una chiave');
    for (const nome of Object.keys(PIATTAFORME)) {
      assert.notDeepEqual(chiaviAllarme(nome, { versione: 'v0.2.300', rilasci: storia }), [`piattaforma:${nome.toLowerCase()}`]);
    }
  });

  test('una versione scritta a mano non porta nella chiave caratteri strani né lunghezze senza fine', () => {
    const [k] = chiaviAllarme('Linux', { versione: 'v1 <b>"x"</b>' + 'z'.repeat(500), rilasci: [] });
    assert.match(k, /^piattaforma:linux:inesistente-[A-Za-z0-9._-]+$/);
    assert.ok(k.length < 120);
  });

  // Verifica #1348, giro 1: con i file sempre al loro posto ogni versione era «uscita», e un guasto
  // che si ripeteva alle sole impronte apriva un feedback a ogni pubblicazione.
  describe('i file ci sono e si rompono le impronte: conta uscita solo una versione con le impronte', () => {
    const I = (tag, impronte, extra = {}) => R(tag, [...WIN, ...TUTTI_MAC, ...TUTTI_LINUX], { impronte, ...extra });
    const SI = { Mac: true, Linux: true };
    const NO = { Mac: false, Linux: false };
    const chiave = (P, versione, rilasci, opz = {}) => chiaviAllarme(P, { versione, rilasci, ...opz })[0];

    test('rotte a ogni versione: la chiave non cambia', () => {
      const storia = [I('v0.2.300', SI), I('v0.2.301', NO), I('v0.2.302', NO), I('v0.2.303', NO)];
      const chiavi = ['v0.2.301', 'v0.2.302', 'v0.2.303'].map((v) => chiave('Mac', v, storia));
      assert.deepEqual(new Set(chiavi), new Set(['piattaforma:mac:impronte:dopo-v0.2.300']));
      // Una release vecchia, di prima della sezione, non le ha: non è mai uscita «con le impronte».
      assert.equal(chiave('Linux', 'v0.2.301', [R('v0.2.300', TUTTI_LINUX), I('v0.2.301', NO)]), 'piattaforma:linux:impronte:dopo-nessuna');
    });

    test('tornate a uscire, un guasto dopo ha una chiave nuova; e ogni piattaforma conta le sue', () => {
      const storia = [I('v0.2.300', SI), I('v0.2.301', NO), I('v0.2.302', { Mac: true, Linux: false }), I('v0.2.303', NO)];
      assert.equal(chiave('Mac', 'v0.2.303', storia), 'piattaforma:mac:impronte:dopo-v0.2.302');
      assert.equal(chiave('Linux', 'v0.2.303', storia), 'piattaforma:linux:impronte:dopo-v0.2.300');
    });

    test('un file che manca dopo un guasto alle impronte non finisce nel feedback delle impronte', () => {
      const storia = [I('v0.2.300', SI), I('v0.2.301', NO), I('v0.2.302', NO), R('v0.2.303', WIN)];
      assert.equal(chiave('Mac', 'v0.2.302', storia), 'piattaforma:mac:impronte:dopo-v0.2.300');
      assert.equal(chiave('Mac', 'v0.2.303', storia), 'piattaforma:mac:dopo-v0.2.302');
    });

    test('se le impronte delle pagine non si sono potute leggere, la chiave è della versione', () => {
      const storia = [I('v0.2.300', SI), I('v0.2.301', NO)];
      assert.equal(chiave('Mac', 'v0.2.301', storia, { impronteLette: false }), 'piattaforma:mac:impronte:in-v0.2.301');
    });
  });
});

describe('le release, lette da GitHub', () => {
  const risposta = (corpo, stato = 200) => ({ ok: stato >= 200 && stato < 300, status: stato, json: async () => corpo });
  const grezza = (tag, nomi = [], extra = {}) => ({ tag_name: tag, draft: false, prerelease: false, assets: nomi.map((name) => ({ name })), ...extra });
  const zitto = () => {};

  test('legge tutte le pagine, col token, e restituisce tag, stato e allegati', async () => {
    const chieste = [];
    const pagine = [Array.from({ length: 100 }, (_, i) => grezza(`v0.1.${i}`)), [grezza('v0.2.0', ['a', 'b'], { draft: true })]];
    const fetchImpl = async (url, opz) => { chieste.push({ url, opz }); return risposta(pagine[chieste.length - 1] || []); };
    const r = await leggiRilasci({ repo: 'o/Filo', token: 'tok', api: 'https://api.x/', fetchImpl, log: zitto });
    assert.equal(r.length, 101);
    assert.deepEqual(r[100], { tag: 'v0.2.0', bozza: true, anteprima: false, allegati: ['a', 'b'], impronte: {} });
    assert.equal(chieste.length, 2);
    assert.match(chieste[0].url, /^https:\/\/api\.x\/repos\/o\/Filo\/releases\?per_page=100&page=1$/);
    assert.match(chieste[1].url, /page=2$/);
    assert.equal(chieste[0].opz.headers.Authorization, 'Bearer tok');
  });

  test('un elenco che non si legge per intero è «non letto», mai un elenco monco', async () => {
    const piena = Array.from({ length: 100 }, (_, i) => grezza(`v0.1.${i}`));
    let n = 0;
    const secondaRotta = async () => (++n === 1 ? risposta(piena) : risposta({ message: 'boom' }, 502));
    assert.equal(await leggiRilasci({ repo: 'o/Filo', fetchImpl: secondaRotta, log: zitto }), null);
    assert.equal(await leggiRilasci({ repo: 'o/Filo', fetchImpl: async () => risposta({ message: 'Not Found' }, 404), log: zitto }), null);
    assert.equal(await leggiRilasci({ repo: 'o/Filo', fetchImpl: async () => risposta({ non: 'un elenco' }), log: zitto }), null);
    assert.equal(await leggiRilasci({ repo: 'o/Filo', fetchImpl: async () => { throw new Error('rete giù'); }, log: zitto }), null);
    assert.equal(await leggiRilasci({ repo: '', fetchImpl: async () => risposta([]), log: zitto }), null);
    let pagine = 0;
    const senzaFine = async () => { pagine += 1; return risposta(piena); };
    assert.equal(await leggiRilasci({ repo: 'o/Filo', fetchImpl: senzaFine, log: zitto }), null, 'oltre il tetto l\'elenco sarebbe monco');
    assert.equal(pagine, PAGINE_MAX);
  });

  test('le impronte di ogni pagina le legge lo strumento che le scrive, per piattaforma', async () => {
    const { aggiornaCorpo } = await import('../../scripts/release-impronte.mjs');
    const riga = (nome) => ({ nome, sha256: 'a'.repeat(64), commit: 'b'.repeat(40), corsa: 'https://github.com/o/Filo/actions/runs/7' });
    const soloMac = aggiornaCorpo('Note della versione.', [riga('Filo-Mac.dmg'), riga('Filo-Mac.zip')]).corpo;
    const meta = aggiornaCorpo('', [riga('Filo-Mac.dmg')]).corpo;
    const impronteDi = await lettoreImpronte();
    assert.equal(typeof impronteDi, 'function');
    const lotto = [grezza('v0.2.3', [], { body: soloMac }), grezza('v0.2.2', [], { body: meta }), grezza('v0.2.1', [], { body: null })];
    const r = await leggiRilasci({ repo: 'o/Filo', fetchImpl: async () => risposta(lotto), log: zitto, impronteDi });
    assert.deepEqual(r.map((x) => x.impronte), [
      { Windows: false, Mac: true, Linux: false },
      { Windows: false, Mac: false, Linux: false },
      { Windows: false, Mac: false, Linux: false },
    ]);
  });

  test('la pagina della versione: trovata coi suoi allegati, assente, o non letta', () => {
    const storia = [R('v0.2.300', ['x']), R('v0.2.301', ['y', 'z'])];
    assert.deepEqual(paginaDellaVersione(storia, ' v0.2.301 '), { esiste: true, allegati: ['y', 'z'] });
    assert.deepEqual(paginaDellaVersione(storia, 'v0.2.999'), { esiste: false });
    assert.equal(paginaDellaVersione(null, 'v0.2.301'), null);
    assert.equal(ultimaPubblicata([...storia, R('v0.3.0', [], { bozza: true })]), 'v0.2.301');
  });
});

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
    const { titolo, testo } = componiAllarme({
      ...dati, piattaforma: 'Mac', passo: 'pippo', mancanti: '', esiti, pagina: { esiste: true, allegati: ['Filo-Setup.exe'] },
    });
    assert.match(titolo, /Mac/);
    assert.match(titolo, /pippo/);
    assert.match(testo, /pippo/, 'un id fuori tabella si scrive com\'è: si cerca nel registro');
    assert.match(testo, /releases\/latest\/download\/Filo-Mac\.dmg/);
  });

  // #733 giro 1: il feedback diceva SEMPRE che il download rispondeva 404 e che
  // l'aggiornamento automatico era muto, anche quando mancava il solo foglietto.
  // #733.3: dedurlo dai passi girati sbagliava al secondo tentativo e su una
  // versione inesistente. Vale solo la pagina della versione, letta davvero.
  describe('dichiara rotto solo quello che ha visto nella pagina della versione', () => {
    const riuscito = { outcome: 'success' };
    const fallito = { outcome: 'failure' };
    const conPagina = (allegati, esiti, extra = {}) => componiAllarme({
      ...dati, mancanti: '', esiti, pagina: { esiste: true, allegati }, ...extra,
    });

    test('senza pagina il controllo finale ha guardato la release: il suo elenco vale', () => {
      const { titolo, testo } = componiAllarme({
        ...dati, passo: 'controllo', mancanti: 'Se-Filo-non-si-apre-Linux.txt',
        esiti: { build: riuscito, istruzioni: riuscito, controllo: fallito },
      });
      assert.doesNotMatch(testo, /404/, 'il pacchetto è nella release: il download non risponde 404');
      assert.doesNotMatch(testo, /aggiornamento automatico legge/, 'il manifesto è nella release: l\'aggiornamento funziona');
      assert.match(testo, /mancano: Se-Filo-non-si-apre-Linux\.txt/);
      assert.doesNotMatch(titolo, /non è nella release/, 'la release è incompleta, non vuota');
    });

    test('fermo dopo la costruzione: nella pagina c\'è tutto tranne il foglietto', () => {
      const { testo } = conPagina(['Filo-Linux.AppImage', 'latest-linux.yml'],
        { build: riuscito, istruzioni: fallito }, { passo: 'istruzioni' });
      assert.match(testo, /mancano: Se-Filo-non-si-apre-Linux\.txt\./);
      assert.doesNotMatch(testo, /404/);
    });

    test('fermo prima della costruzione su una release nuova: nella pagina non c\'è niente, e si dice', () => {
      const { titolo, testo } = conPagina(['Filo-Setup.exe', 'latest.yml'], { bersaglio: riuscito, build: fallito }, { passo: 'build' });
      assert.match(testo, /mancano: Filo-Linux\.AppImage, latest-linux\.yml, Se-Filo-non-si-apre-Linux\.txt\./);
      assert.match(testo, /404/, 'qui il download è davvero rotto e va detto');
      assert.match(testo, /aggiornamento automatico legge/);
      assert.match(titolo, /non è nella release/);
    });

    test('#733.3 secondo tentativo fermo prima della costruzione: programma e manifesto del primo restano', () => {
      const { titolo, testo } = conPagina(['Filo-Setup.exe', 'Filo-Linux.AppImage', 'latest-linux.yml'],
        { bersaglio: riuscito, checkout: riuscito, node: riuscito, dipendenze: fallito }, { passo: 'dipendenze' });
      assert.match(testo, /mancano: Se-Filo-non-si-apre-Linux\.txt\./, 'il secondo avviso dava per persi tutti e tre i file');
      assert.doesNotMatch(testo, /404/, 'il programma è attaccato dal primo tentativo: il download funziona');
      assert.doesNotMatch(testo, /aggiornamento automatico legge/, 'il manifesto è attaccato: l\'aggiornamento funziona');
      assert.match(titolo, /incompleta/);
      assert.doesNotMatch(titolo, /non è nella release/);
    });

    test('nella pagina ci sono già tutti i file: lo dice, e non manda a rimetterli', () => {
      const { titolo, testo } = conPagina([...PIATTAFORME.Linux.attesi], { dipendenze: fallito }, { passo: 'dipendenze' });
      assert.match(titolo, /i file ci sono/);
      assert.match(testo, /ci sono tutti i file per Linux/);
      assert.doesNotMatch(testo, /mancano|404|STESSA release/);
    });

    test('senza pagina e senza controllo non inventa l\'elenco, qualunque passo si sia fermato', () => {
      const casi = [
        { build: fallito },
        { bersaglio: riuscito, checkout: riuscito, build: riuscito, istruzioni: fallito },
        { bersaglio: riuscito, checkout: fallito },
        {},
        null,
      ];
      for (const esiti of casi) {
        const { titolo, testo } = componiAllarme({ ...dati, mancanti: '', esiti, pagina: null });
        assert.match(testo, /Non ho potuto leggere la pagina della release v0\.2\.229/, `esiti ${JSON.stringify(esiti)}`);
        assert.doesNotMatch(testo, /mancano|404|aggiornamento automatico legge/, `con esiti ${JSON.stringify(esiti)} l'avviso inventa i file mancanti`);
        assert.match(testo, /Filo-Linux\.AppImage/, 'va comunque detto cosa deve esserci');
        assert.doesNotMatch(titolo, /non è nella release|incompleta/);
      }
    });

    test('#733.3 versione inesistente scritta a mano: dice che non esiste, e quale numero c\'è', () => {
      for (const piattaforma of Object.keys(PIATTAFORME)) {
        const { titolo, testo } = componiAllarme({
          ...dati, piattaforma, versione: 'v0.2.9999', passo: 'checkout', mancanti: '',
          esiti: { bersaglio: riuscito, checkout: fallito }, pagina: { esiste: false }, ultima: 'v0.2.305',
        });
        assert.match(titolo, /La versione v0\.2\.9999 non esiste/);
        assert.match(testo, /non ce n'è nessuna con quel numero/);
        assert.match(testo, /l'ultima pubblicata è v0\.2\.305/);
        assert.ok(testo.includes(casella(piattaforma)), 'il rimedio è la casella dell\'avvio a mano');
        assert.doesNotMatch(titolo + testo, /mancano|404|aggiornamento automatico legge|incompleta|non è nella release/,
          'una versione mai esistita non ha file mancanti né download rotti');
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
    const base = cartellaTemporanea('filo-allarme-');
    const vero = join(base, 'vero', 'scripts');
    mkdirSync(vero, { recursive: true });
    for (const f of ['release-platform-alarm.mjs', 'build-alarm.mjs']) {
      copyFileSync(join(ROOT, 'scripts', f), join(vero, f));
    }
    collegaCartella(join(base, 'vero'), join(base, 'link'));
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

// #785: fermo alle impronte i file ci sono; il feedback non deve mandare a cercare un download rotto.
test('fermo alle impronte: dice che i file ci sono e manca la sezione «Verifica», e come rimetterla', () => {
  for (const piattaforma of ['Mac', 'Linux']) {
    const esiti = { build: { outcome: 'success' }, istruzioni: { outcome: 'success' }, controllo: { outcome: 'success' }, impronte: { outcome: 'failure' } };
    const { titolo, testo } = componiAllarme({
      piattaforma, versione: 'v0.2.240', passo: passoFallito(esiti), esiti, mancanti: '',
      esecuzione: 'https://github.com/sathyaram1/Filo/actions/runs/42', repo: 'sathyaram1/Filo',
    });
    assert.match(titolo, /impronte/);
    assert.match(titolo, /v0\.2\.240/);
    assert.doesNotMatch(titolo, /incompleta|non è nella release/);
    assert.match(testo, /sezione «Verifica»/);
    assert.match(testo, /actions\/runs\/42/);
    assert.ok(testo.includes(casella(piattaforma)), 'il rimedio è la casella dell\'avvio a mano');
    assert.doesNotMatch(testo, /risponde 404|non è riuscito a farlo/);
  }
});

// Lo script intero, con GitHub e il server di Filo finti: quello che legge dalle release arriva davvero nella chiave e nel testo.
describe('lo script spedisce quello che ha letto nelle release', () => {
  const rilascio = (tag, nomi) => ({ tag_name: tag, draft: false, prerelease: false, assets: nomi.map((name) => ({ name })) });

  async function corsa(env, rilasci) {
    const spediti = [];
    const srv = createServer((req, res) => {
      let corpo = '';
      req.on('data', (c) => { corpo += c; });
      req.on('end', () => {
        if (req.url.startsWith('/repos/o/Filo/releases')) {
          res.writeHead(rilasci ? 200 : 503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(rilasci || { message: 'giù' }));
        } else if (req.url === '/buildAlarm') {
          spediti.push(JSON.parse(corpo));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, num: '#1' }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${srv.address().port}`;
    try {
      await promisify(execFile)(process.execPath, [join(ROOT, 'scripts', 'release-platform-alarm.mjs')], {
        env: {
          ...process.env, FILO_ROUTINE_API: base, GITHUB_API_URL: base, FILO_BUILD_PASSPHRASE: 'parola', REPO: 'o/Filo', GH_TOKEN: 'tok',
          ESECUZIONE: 'https://github.com/o/Filo/actions/runs/7', MANCANTI: '', ...env,
        },
      });
      assert.equal(spediti.length, 1, 'l\'avviso non è partito');
      return spediti[0];
    } finally {
      await new Promise((r) => srv.close(r));
    }
  }

  test('#752 dal vivo: la chiave nomina l\'ultima uscita, il testo i file che la pagina non ha', async () => {
    const inviato = await corsa({ PIATTAFORMA: 'Mac', VERSIONE: 'v0.2.303', ESITI: JSON.stringify({ build: { outcome: 'failure' } }) }, [
      rilascio('v0.2.303', WIN), rilascio('v0.2.302', [...WIN, ...TUTTI_MAC]), rilascio('v0.2.301', WIN),
    ]);
    assert.deepEqual(inviato.keys, ['piattaforma:mac:dopo-v0.2.302']);
    assert.match(inviato.text, /mancano: Filo-Mac\.dmg, Filo-Mac\.zip, latest-mac\.yml\./);
    assert.match(inviato.name, /Filo per Mac non è nella release v0\.2\.303 \(passo «build»\)/);
  });

  test('release che non si leggono: chiave della versione e «non ho potuto leggere», l\'avviso parte lo stesso', async () => {
    const inviato = await corsa({ PIATTAFORMA: 'Linux', VERSIONE: 'v0.2.303', ESITI: JSON.stringify({ build: { outcome: 'failure' } }) }, null);
    assert.deepEqual(inviato.keys, ['piattaforma:linux:in-v0.2.303']);
    assert.match(inviato.text, /Non ho potuto leggere la pagina della release v0\.2\.303/);
    assert.doesNotMatch(inviato.text, /mancano|404/);
  });

  test('#1348 dal vivo: fermo alle impronte con i file al loro posto, la chiave conta le pagine che le hanno', async () => {
    const { aggiornaCorpo } = await import('../../scripts/release-impronte.mjs');
    const riga = (nome) => ({ nome, sha256: 'c'.repeat(64), commit: 'd'.repeat(40), corsa: 'https://github.com/o/Filo/actions/runs/7' });
    const conImpronte = aggiornaCorpo('', [riga('Filo-Mac.dmg'), riga('Filo-Mac.zip')]).corpo;
    const ESITI = JSON.stringify({ controllo: { outcome: 'success' }, impronte: { outcome: 'failure' } });
    const storia = [
      { ...rilascio('v0.2.303', [...WIN, ...TUTTI_MAC]) }, { ...rilascio('v0.2.302', [...WIN, ...TUTTI_MAC]) },
      { ...rilascio('v0.2.301', [...WIN, ...TUTTI_MAC]), body: conImpronte },
    ];
    const alla302 = await corsa({ PIATTAFORMA: 'Mac', VERSIONE: 'v0.2.302', ESITI }, storia);
    const alla303 = await corsa({ PIATTAFORMA: 'Mac', VERSIONE: 'v0.2.303', ESITI }, storia);
    assert.deepEqual(alla302.keys, ['piattaforma:mac:impronte:dopo-v0.2.301']);
    assert.deepEqual(alla303.keys, alla302.keys, 'lo stesso guasto alle impronte aprirebbe un feedback a ogni versione');
    assert.match(alla303.name, /non riporta le impronte/);
  });

  test('versione inesistente scritta a mano: lo dice, con una chiave sua', async () => {
    const inviato = await corsa({ PIATTAFORMA: 'Linux', VERSIONE: 'v0.2.9999', ESITI: JSON.stringify({ checkout: { outcome: 'failure' } }) }, [
      rilascio('v0.2.303', [...WIN, ...TUTTI_LINUX]),
    ]);
    assert.deepEqual(inviato.keys, ['piattaforma:linux:inesistente-v0.2.9999']);
    assert.match(inviato.name, /La versione v0\.2\.9999 non esiste/);
    assert.match(inviato.text, /l'ultima pubblicata è v0\.2\.303/);
  });
});
