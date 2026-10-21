// I cancelli su Windows (suite.yml, release.yml) rifanno una volta i soli file rossi: un flaky non butta un verde,
// un rosso vero resta rosso e l'allarme ne legge solo i file rimasti.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { chiaviDelRegistroUnit } from '../../scripts/build-alarm.mjs';
import { corsaIncompleta, fileRossi, ripassati } from '../../scripts/unit-con-riprova.mjs';
import { testoFermo, testoRiepilogo } from '../../scripts/run-unit-tests.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'unit-con-riprova.mjs');
const A = 'tests/unit/a.test.mjs';
const B = 'tests/unit/b.test.mjs';
const rosso = (file, n = 1) => `not ok ${n} - prova di ${file}\n  ---\n  location: '${join(ROOT, file)}:3:1'\n  ...\n`;

describe('quali file si rifanno', () => {
  test('i file delle righe location:, relativi alla radice, anche coi percorsi di Windows', () => {
    const win = 'D:\\a\\Filo\\Filo';
    const registro = `TAP version 13\nnot ok 1 - x\n  location: '${win}\\tests\\unit\\a.test.mjs:12:1'\nnot ok 2 - y\n  location: '${win}\\tests\\unit\\b.test.mjs:3:1'\n`;
    assert.deepEqual(fileRossi(registro, win), [A, B]);
    assert.deepEqual(fileRossi('# fail 1\n', win), [], 'senza un file riconoscibile non si rifà niente: il rosso resta');
  });

  // Le frasi le scrive il lanciatore: se cambiano lì, questa diventa rossa invece di far tornare il falso verde (#1184).
  test('una prima corsa che non ha detto tutto non si riprova: le frasi sono quelle del lanciatore', () => {
    const somma = (rossi) => ({ test: 2, pass: 1, fail: rossi.length, annullati: 0, saltati: 0, todo: 0, rossi });
    const r1 = { gruppo: 1, nome: 'x', file: join(ROOT, A), riga: 3 };
    const conRiepilogo = (t) => `${rosso(A)}# fail 1\n${t}\n`;
    assert.equal(corsaIncompleta(`${rosso(A)}# fail 1\n`), '', 'un rosso normale, col suo riepilogo, si riprova');
    assert.notEqual(corsaIncompleta(conRiepilogo(testoFermo([join(ROOT, B)], 4000))), '', 'un file appeso');
    assert.notEqual(corsaIncompleta(conRiepilogo(testoFermo([], 4000))), '', 'niente avanzava');
    assert.notEqual(corsaIncompleta(conRiepilogo(testoRiepilogo({ somma: somma([r1]), gruppi: 3, file: 3, esiti: [1, 1], interrotto: true }))), '', 'interrotta');
    assert.notEqual(corsaIncompleta(conRiepilogo(testoRiepilogo({ somma: somma([r1]), gruppi: 2, file: 2, esiti: [1, 1] }))), '', 'gruppo rosso senza colpevole');
    assert.notEqual(corsaIncompleta(rosso(A)), '', 'senza riepilogo node non è arrivato in fondo');
    const gruppi = `[test:unit] gruppo 1 di 2 (1 file)\n${rosso(A)}# fail 1\n[test:unit] gruppo 2 di 2 (1 file)\nok 1 - y\n`;
    assert.notEqual(corsaIncompleta(gruppi), '', 'un gruppo senza riepilogo');
    assert.equal(corsaIncompleta(`${gruppi}# fail 0\n`), '', 'ogni gruppo col suo riepilogo');
  });

  // #1457: il titolo di un test verde che citava una frase del lanciatore toglieva la riprova a un flaky di Windows.
  test('le frasi del lanciatore contano solo quando le dice lui, non nel titolo di un test', () => {
    const titoli = ['un gruppo rosso senza un test rosso registrato non sparisce dal riepilogo',
      'interrotto al gruppo 2 di 3: i gruppi dopo non partono', 'un file appeso e la corsa è stata chiusa col suo nome',
      'se non sono riuscito a lanciare node lo dico'];
    const verdi = titoli.map((t, i) => `# Subtest: ${t}\nok ${i + 2} - ${t}\n  ---\n  duration_ms: 1\n  ...\n`).join('');
    assert.equal(corsaIncompleta(`${verdi}${rosso(A)}# fail 1\n`), '', 'un rosso normale si riprova anche accanto a quei titoli');
    const aMetaRiga = `${rosso(A)}# fail 1\n  duration_ms: 12.3${testoFermo([join(ROOT, B)], 4000)}\n`;
    assert.notEqual(corsaIncompleta(aMetaRiga), '', 'il messaggio del lanciatore caduto a metà di una riga conta');
  });

  test('ripassato è chi era rosso e alla riprova non lo è più; una riprova rotta non scagiona nessuno', () => {
    assert.deepEqual(ripassati([A, B], { codice: 0, rossiRiprova: [] }), [A, B]);
    assert.deepEqual(ripassati([A, B], { codice: 1, rossiRiprova: [A] }), [B]);
    assert.deepEqual(ripassati([A, B], { codice: 1, rossiRiprova: [] }), [], 'rossa senza file: un lancio fallito, non due flaky');
  });
});

// Il lanciatore finto risponde come quello vero: TAP su stdout e il codice d'uscita; si segna con che argomenti è partito.
const FINTO = `
const fs = require('fs');
const stato = process.env.FINTO_STATO;
const chiamate = fs.existsSync(stato) ? JSON.parse(fs.readFileSync(stato, 'utf8')) : [];
const args = process.argv.slice(2);
chiamate.push(args);
fs.writeFileSync(stato, JSON.stringify(chiamate));
const uscite = JSON.parse(process.env.FINTO_USCITE);
const u = uscite[Math.min(chiamate.length, uscite.length) - 1];
process.stdout.write('TAP version 13\\n' + u.testo + '# fail ' + (u.codice ? 1 : 0) + '\\n');
process.exitCode = u.codice;
`;

async function lancia(uscite) {
  const tmp = cartellaTemporanea('filo-unit-riprova-');
  try {
    const finto = join(tmp, 'lanciatore.cjs');
    writeFileSync(finto, FINTO);
    const registro = join(tmp, 'unit.log');
    const env = { ...process.env, FILO_UNIT_LANCIATORE: finto, FINTO_STATO: join(tmp, 'stato.json'), FINTO_USCITE: JSON.stringify(uscite) };
    const { codice, stdout } = await new Promise((ok) => {
      execFile(process.execPath, [SCRIPT, '--registro', registro], { cwd: tmp, env }, (err, out) => ok({ codice: err ? err.code : 0, stdout: out }));
    });
    const chiamate = JSON.parse(readFileSync(join(tmp, 'stato.json'), 'utf8'));
    const prima = join(tmp, 'unit-prima.log');
    return { codice, stdout, chiamate, registro: readFileSync(registro, 'utf8'), prima: existsSync(prima) ? readFileSync(prima, 'utf8') : null };
  } finally {
    togliCartella(tmp, { tentativi: 10 });
  }
}

describe('la corsa vera, contro un lanciatore finto', () => {
  test('tutto verde: una corsa sola, e il registro è quella', async () => {
    const r = await lancia([{ codice: 0, testo: 'ok 1 - tutto\n' }]);
    assert.equal(r.codice, 0);
    assert.deepEqual(r.chiamate, [[]]);
    assert.match(r.registro, /ok 1 - tutto/);
    assert.equal(r.prima, null);
  });

  test('rossi che ripassano: verde, rifatti solo quei file, e il flaky si dice', async () => {
    const r = await lancia([{ codice: 1, testo: rosso(A) + rosso(B, 2) }, { codice: 0, testo: 'ok 1 - ripassato\n' }]);
    assert.equal(r.codice, 0, 'un flaky non deve buttare il verde');
    assert.deepEqual(r.chiamate, [[], ['--solo', A, B]]);
    assert.match(r.stdout, /::warning::[^\n]*flaky[^\n]*tests\/unit\/a\.test\.mjs, tests\/unit\/b\.test\.mjs/);
    assert.match(r.prima, /not ok 1/, 'la prima corsa resta accanto al registro');
    assert.doesNotMatch(r.registro, /not ok/);
  });

  test('un rosso vero resta rosso, e il registro che l\'allarme legge ha solo i file rimasti', async () => {
    const r = await lancia([{ codice: 1, testo: rosso(A) + rosso(B, 2) }, { codice: 1, testo: rosso(A) }]);
    assert.equal(r.codice, 1);
    assert.deepEqual(chiaviDelRegistroUnit(r.registro, ROOT), [`unit:${A}`], 'il flaky non diventa una chiave dell\'allarme');
    assert.match(r.stdout, /::warning::[^\n]*tests\/unit\/b\.test\.mjs/);
    assert.doesNotMatch(r.stdout, /::warning::[^\n]*a\.test\.mjs/);
  });

  test('un flaky e un file appeso: nessuna riprova, rosso, e il registro tiene la prima corsa intera', async () => {
    const r = await lancia([{ codice: 1, testo: `${rosso(A)}${testoFermo([join(ROOT, B)], 4000)}\n` }, { codice: 0, testo: 'ok 1 - ripassato\n' }]);
    assert.equal(r.codice, 1, 'i file dopo quello appeso non hanno detto niente: verde non si può dire');
    assert.deepEqual(r.chiamate, [[]]);
    assert.match(r.registro, /la corsa è stata chiusa/);
    assert.match(r.stdout, /nessuna riprova/);
    assert.doesNotMatch(r.stdout, /::warning::/);
  });

  test('rosso senza un file da rifare (un lancio fallito): nessuna riprova, rosso', async () => {
    const r = await lancia([{ codice: 1, testo: '[test:unit] non sono riuscito a lanciare node\n' }]);
    assert.equal(r.codice, 1);
    assert.deepEqual(r.chiamate, [[]]);
    assert.match(r.registro, /non sono riuscito/);
    assert.doesNotMatch(r.stdout, /::warning::/);
  });
});
