// Un download che risponde 503 per un minuto durante `npm ci` fermava suite e pubblicazione (#952): qui le regole
// dello script che ritenta, e che ogni workflow installi passando da lui (anche da un tag più vecchio dello script).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, copyFileSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve, join, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cartellaTemporanea, collegaCartella, togliCartella } from '../helpers/percorsi.mjs';
import { fileURLToPath } from 'node:url';
import { installa, daRitentare, esegui, ATTESE_S } from '../../scripts/npm-ci-ritenta.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const WORKFLOWS = resolve(ROOT, '.github', 'workflows');

const ROSSO_503 = 'npm error command sh -c node install.js\nnpm error HTTPError: Response code 503 (Service Unavailable)\n';
const ROSSO_LOCK = 'npm error code EUSAGE\nnpm error `npm ci` can only install packages when your package.json and package-lock.json are in sync.\n';

/** Una finta `npm ci` che risponde con gli esiti dati, in ordine; tiene il conto e le attese chieste. */
function finta(esiti) {
  const stato = { chiamate: 0, attese: [], righe: [] };
  const prova = async () => esiti[Math.min(stato.chiamate++, esiti.length - 1)];
  const aspetta = async (ms) => { stato.attese.push(ms); };
  const log = (r) => stato.righe.push(r);
  return { stato, opzioni: { prova, aspetta, log } };
}

describe('npm ci che ritenta', () => {
  test('il guasto di #952: due 503 di fila e poi il download arriva, l\'installazione riesce', async () => {
    const { stato, opzioni } = finta([{ codice: 1, uscita: ROSSO_503 }, { codice: 1, uscita: ROSSO_503 }, { codice: 0, uscita: '' }]);
    assert.equal(await installa(opzioni), 0);
    assert.equal(stato.chiamate, 3);
    assert.deepEqual(stato.attese, [ATTESE_S[0] * 1000, ATTESE_S[1] * 1000], 'le attese crescono');
    assert.ok(stato.righe.some((r) => /::warning::npm ci riuscito al tentativo 3/.test(r)),
      'una corsa salvata dal secondo tentativo lo dice nel riepilogo di Actions, o il download che zoppica non lo vede nessuno');
  });

  test('al primo colpo: nessuna attesa e nessun avviso', async () => {
    const { stato, opzioni } = finta([{ codice: 0, uscita: '' }]);
    assert.equal(await installa(opzioni), 0);
    assert.equal(stato.chiamate, 1);
    assert.deepEqual(stato.attese, []);
    assert.deepEqual(stato.righe, []);
  });

  test('un guasto che dura: si arrende dopo tutti i tentativi, rosso, e lo dice', async () => {
    const { stato, opzioni } = finta([{ codice: 1, uscita: ROSSO_503 }]);
    assert.notEqual(await installa(opzioni), 0);
    assert.equal(stato.chiamate, ATTESE_S.length + 1);
    assert.deepEqual(stato.attese, ATTESE_S.map((s) => s * 1000));
    assert.match(stato.righe.at(-1), /::error::npm ci rosso a tutti i \d+ tentativi/);
  });

  test('i tentativi coprono un disservizio di minuti, non di secondi', () => {
    const totale = ATTESE_S.reduce((a, b) => a + b, 0);
    assert.ok(totale >= 5 * 60, `le attese sommano ${totale} s: npm e got ritentano già per secondi da soli`);
    assert.ok(totale <= 15 * 60, `le attese sommano ${totale} s: un guasto vero arriverebbe troppo tardi`);
  });

  test('un lockfile fuori sincrono non si ritenta: l\'errore vero arriva subito', async () => {
    const { stato, opzioni } = finta([{ codice: 1, uscita: ROSSO_LOCK }]);
    assert.equal(await installa(opzioni), 1);
    assert.equal(stato.chiamate, 1);
    assert.deepEqual(stato.attese, []);
    assert.equal(daRitentare(ROSSO_LOCK), false);
    assert.equal(daRitentare(ROSSO_503), true);
    assert.equal(daRitentare(''), true, 'un rosso muto si ritenta: non si sa cosa sia');
  });

  test('esegui inoltra l\'uscita e ne tiene la coda e il codice', async () => {
    const codice = "process.stderr.write('npm error code EUSAGE\\n'); process.stdout.write('ciao\\n'); process.exit(3)";
    const r = await esegui(process.execPath, ['-e', codice]);
    assert.equal(r.codice, 3);
    assert.match(r.uscita, /EUSAGE/);
    assert.match(r.uscita, /ciao/);
  });

  // I lavori Mac e Linux la lanciano da una copia nella temporanea del runner, che su Mac passa da un collegamento.
  // L'`npm` trovato per primo nel PATH è finto: quello vero, a macchina carica, ha superato il minuto (#1063). Si lancia
  // per nome come quello vero, quindi su Windows passa dalla shell come lui.
  test('lanciato da un percorso con un collegamento, installa davvero (non esce verde senza far niente)', () => {
    const base = cartellaTemporanea('npm-ci-ritenta-');
    try {
      const vera = join(base, 'vera');
      mkdirSync(vera);
      copyFileSync(resolve(ROOT, 'scripts', 'npm-ci-ritenta.mjs'), join(vera, 'npm-ci-ritenta.mjs'));
      collegaCartella(vera, join(base, 'collegamento'));
      const progetto = join(base, 'progetto');
      mkdirSync(progetto);
      const finti = join(base, 'finti');
      mkdirSync(finti);
      const chiamata = join(finti, 'chiamata.txt');
      if (process.platform === 'win32') {
        writeFileSync(join(finti, 'npm.cmd'), '@echo off\r\necho %*> "%~dp0chiamata.txt"\r\necho npm error code EUSAGE 1>&2\r\nexit /b 1\r\n');
      } else {
        writeFileSync(join(finti, 'npm'), '#!/bin/sh\necho "$*" > "$(dirname "$0")/chiamata.txt"\necho "npm error code EUSAGE" >&2\nexit 1\n');
        chmodSync(join(finti, 'npm'), 0o755);
      }
      const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== 'PATH'));
      const percorso = Object.entries(process.env).find(([k]) => k.toUpperCase() === 'PATH')?.[1] || '';
      env.PATH = `${finti}${delimiter}${percorso}`;
      const r = spawnSync(process.execPath, [join(base, 'collegamento', 'npm-ci-ritenta.mjs')], { cwd: progetto, env, encoding: 'utf8', timeout: 60_000 });
      const uscita = `${r.stdout}${r.stderr}`;
      assert.match(uscita, /EUSAGE/, `npm ci non è nemmeno partito:\n${uscita}`);
      assert.equal(readFileSync(chiamata, 'utf8').trim(), 'ci', 'lo script deve lanciare proprio `npm ci`');
      assert.equal(r.status, 1, 'il lockfile fuori sincrono deve arrivare rosso, al primo tentativo');
      assert.match(uscita, /niente altri tentativi/);
    } finally {
      togliCartella(base);
    }
  });

  test('un comando che non esiste è un rosso, non un\'eccezione', async () => {
    const r = await esegui('comando-che-non-esiste-filo-952', []);
    assert.notEqual(r.codice, 0);
  });
});

describe('ogni workflow installa passando dallo script che ritenta', () => {
  const senzaCommenti = (s) => s.split(/\r?\n/).filter((r) => !/^\s*#/.test(r)).join('\n');
  const passiDi = (testo) => senzaCommenti(testo).split(/^ {6}- (?=name: |uses: |run: )/m).slice(1);
  const files = readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f));

  test('nessun `npm ci` nudo', () => {
    assert.ok(files.length >= 4);
    let installazioni = 0;
    for (const f of files) {
      for (const passo of passiDi(readFileSync(resolve(WORKFLOWS, f), 'utf8'))) {
        // Come comando, non come parola: l'avviso della suite nomina `npm ci` nel testo.
        if (!/(?:^|run:|[;&|]|\bthen|\belse)\s*npm ci\b|npm-ci-ritenta/m.test(passo)) continue;
        installazioni++;
        assert.match(passo, /npm-ci-ritenta\.mjs/, `${f}: un passo lancia \`npm ci\` senza lo script che ritenta:\n${passo.slice(0, 200)}`);
      }
    }
    assert.ok(installazioni >= 6, `trovate ${installazioni} installazioni: suite, due verifiche e tre pubblicazioni`);
  });

  test('dove si costruisce un tag vecchio, lo script arriva dal riparo di questa corsa', () => {
    const yml = readFileSync(resolve(WORKFLOWS, 'release.yml'), 'utf8');
    for (const nome of ['release-mac', 'release-linux']) {
      const inizio = yml.search(new RegExp(`^ {2}${nome}:\\s*$`, 'm'));
      assert.ok(inizio >= 0, nome);
      const resto = yml.slice(inizio + 1);
      const fine = resto.search(/^ {2}[a-z][\w-]*:\s*$/m);
      const passi = passiDi(fine >= 0 ? yml.slice(inizio, inizio + 1 + fine) : yml.slice(inizio));
      const iRiparo = passi.findIndex((p) => /cp scripts\/npm-ci-ritenta\.mjs "\$\{\{ runner\.temp \}\}\/strumenti\/"/.test(p));
      const iVersione = passi.findIndex((p) => /^name: Checkout del codice di questa versione/.test(p));
      const iInstalla = passi.findIndex((p) => /npm-ci-ritenta/.test(p) && /id: dipendenze/.test(p));
      assert.ok(iRiparo >= 0 && iRiparo < iVersione, `${nome}: lo script va messo al riparo prima che il prelievo della versione lo porti via`);
      assert.match(passi[iInstalla], /node "\$\{\{ runner\.temp \}\}\/strumenti\/npm-ci-ritenta\.mjs"/,
        `${nome}: un tag di prima dello script non lo ha nella copia di lavoro`);
    }
  });

  test('la pubblicazione Windows regge un commit provato più vecchio dello script', () => {
    const yml = senzaCommenti(readFileSync(resolve(WORKFLOWS, 'release.yml'), 'utf8'));
    assert.match(yml, /if \[ -f scripts\/npm-ci-ritenta\.mjs \]; then node scripts\/npm-ci-ritenta\.mjs; else npm ci; fi/);
  });
});
