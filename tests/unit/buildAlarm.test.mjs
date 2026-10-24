// L'allarme che apre un feedback quando la pubblicazione si ferma
// (scripts/build-alarm.mjs): il server tiene 10.000 caratteri di testo e
// taglia il resto in silenzio. Il taglio si fa prima di spedire e si DICE,
// col numero (giro del 14/09, terza verifica).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const esegui = promisify(execFile);
const { testoEntroIlTetto, TETTO_TESTO } = await import('../../scripts/build-alarm.mjs');

test('un testo entro il tetto passa intero', () => {
  assert.equal(testoEntroIlTetto('ciao'), 'ciao');
  const giusto = 'x'.repeat(TETTO_TESTO);
  assert.equal(testoEntroIlTetto(giusto), giusto);
  assert.equal(testoEntroIlTetto(''), '');
  assert.equal(testoEntroIlTetto(null), '');
});

test('un testo oltre il tetto viene tagliato entro il tetto, e il taglio è scritto in coda col numero', () => {
  const lungo = 'r'.repeat(12700);
  const t = testoEntroIlTetto(lungo);
  assert.ok(t.length <= TETTO_TESTO, `${t.length} caratteri: oltre il tetto`);
  assert.match(t, /testo tagliato a 10000 caratteri \(era di 12700\)/);
  assert.match(t, /Actions/);
  assert.ok(t.startsWith('rrrr'), 'l\'inizio del testo resta');
});

test('il tetto si può passare, e la nota rientra sempre nel tetto', () => {
  const t = testoEntroIlTetto('abcdefghij'.repeat(30), 250);
  assert.ok(t.length <= 250);
  assert.match(t, /era di 300/);
});

// Le chiavi dicono al server COSA è rotto: senza, un feedback aperto qualunque
// dello stesso mittente inghiottiva ogni allarme dopo di lui (tre settimane).
const { normalizzaChiavi, chiaviDelRegistroUnit, leggiArgomenti } = await import('../../scripts/build-alarm.mjs');

test('le chiavi si normalizzano: bordi, vuote, doppioni, non stringhe', () => {
  assert.deepEqual(normalizzaChiavi([' a ', 'a', '', '  ', 7, null, 'b']), ['a', 'b']);
  assert.deepEqual(normalizzaChiavi(undefined), []);
  assert.equal(normalizzaChiavi(['x'.repeat(500)])[0].length, 200, 'il server ne tiene 200 caratteri');
});

test('le chiavi del cancello unit vengono dalle righe location: del registro, relative e con le barre normali', () => {
  // Come le scrive il runner Windows (Node 20 e 22): barre rovesciate, a volte raddoppiate, lettera del disco.
  const registro = [
    'not ok 3 - il conto torna',
    String.raw`    location: 'D:\\a\\Filo\\Filo\\tests\\unit\\conto.test.mjs:12:3'`,
    'not ok 4 - gruppo',
    String.raw`  location: 'D:\a\Filo\Filo\tests\unit\conto.test.mjs:10:1'`,
    String.raw`  location: 'D:\a\Filo\Filo\tests\unit\altro.test.mjs:4:1'`,
    'ok 5 - verde',
  ].join('\r\n');
  assert.deepEqual(chiaviDelRegistroUnit(registro, String.raw`D:\a\Filo\Filo`),
    ['unit:tests/unit/conto.test.mjs', 'unit:tests/unit/altro.test.mjs']);
  // Senza radice (o con una diversa) si riparte da tests/.
  assert.deepEqual(chiaviDelRegistroUnit(registro, ''), ['unit:tests/unit/conto.test.mjs', 'unit:tests/unit/altro.test.mjs']);
  assert.deepEqual(chiaviDelRegistroUnit("  location: '/home/runner/work/Filo/Filo/tests/unit/x.test.mjs:1:1'", '/home/runner/work/Filo/Filo'),
    ['unit:tests/unit/x.test.mjs']);
});

test('un registro senza file riconoscibili dà la chiave generica, mai nessuna', () => {
  assert.deepEqual(chiaviDelRegistroUnit('', String.raw`D:\a`), ['unit']);
  assert.deepEqual(chiaviDelRegistroUnit('not ok 1 - qualcosa\n# fail 1', ''), ['unit']);
  assert.deepEqual(chiaviDelRegistroUnit(String.raw`  location: 'C:\altrove\x.mjs:1:1'`, String.raw`D:\a`), ['unit'],
    'un percorso assoluto fuori dal repo non è una chiave');
});

// Con una chiave per guasto più feedback della costruzione restano aperti insieme: il titolo li distingue.
const { nomeDelGuasto, titoloCoiGuasti, TETTO_TITOLO } = await import('../../scripts/build-alarm.mjs');

test('il nome di un guasto è il file di prova o di test rosso; le chiavi il cui titolo lo dice già restano mute', () => {
  assert.equal(nomeDelGuasto('suite:tests/wallet-credits.spec.mjs'), 'wallet-credits');
  assert.equal(nomeDelGuasto('suite:tests/sotto/prova.spec.js'), 'sotto/prova');
  assert.equal(nomeDelGuasto('unit:tests/unit/fineRigaLf.test.mjs'), 'fineRigaLf');
  assert.equal(nomeDelGuasto('suite:fuori-dai-casi'), 'errori fuori dai casi');
  assert.equal(nomeDelGuasto('suite:non-partita'), 'suite non partita');
  assert.equal(nomeDelGuasto('suite:tetto'), 'suite oltre il tetto di tempo');
  for (const k of ['unit', 'bake:tavily', 'piattaforma:mac', 'rilascio:fermo', '', undefined]) assert.equal(nomeDelGuasto(k), '', String(k));
});

test('il titolo porta i guasti fra parentesi, entro il tetto del server, e un taglio si dice', () => {
  assert.equal(titoloCoiGuasti('T', ['suite:tests/a.spec.mjs', 'suite:tests/a.spec.mjs', 'bake:x']), 'T (a)');
  assert.equal(titoloCoiGuasti('T', ['piattaforma:linux']), 'T', 'il titolo di una piattaforma la dice già');
  assert.equal(titoloCoiGuasti('T', []), 'T');
  const tante = Array.from({ length: 40 }, (_, i) => `suite:tests/prova-numero-${i}.spec.mjs`);
  const t = titoloCoiGuasti('Suite Playwright rossa su main: commit non pubblicabile', tante);
  assert.ok(t.length <= TETTO_TITOLO, `${t.length} caratteri`);
  assert.match(t, /prova-numero-0, /);
  assert.match(t, /e altri \d+\)$/);
});

test('gli argomenti: titolo e testo, --chiave ripetibile, --chiavi-da, --chiavi-unit', () => {
  assert.deepEqual(leggiArgomenti(['T', 'x', '--chiave', 'a', '--chiave', 'b', '--chiavi-da', 'k.txt', '--chiavi-unit', 'u.log']),
    { posizionali: ['T', 'x'], chiavi: ['a', 'b'], chiaviDa: ['k.txt'], chiaviUnit: ['u.log'] });
  assert.deepEqual(leggiArgomenti(['T', 'x']).chiavi, [], 'senza chiavi resta l\'uso di prima');
  assert.throws(() => leggiArgomenti(['T', 'x', '--chiave']), /vuole un valore/);
  assert.throws(() => leggiArgomenti(['T', 'x', '--chiavi']), /non capita/);
});

const { parolaDellaCostruzione } = await import('../../scripts/build-alarm.mjs');

test('la parola d’ordine della costruzione perde spazi e a capo ai bordi, e senza resta vuota', () => {
  assert.equal(parolaDellaCostruzione({ FILO_BUILD_PASSPHRASE: '    abc-def\r\n' }), 'abc-def');
  assert.equal(parolaDellaCostruzione({ FILO_BUILD_PASSPHRASE: 'abc def' }), 'abc def', 'dentro non si tocca');
  assert.equal(parolaDellaCostruzione({ FILO_BUILD_PASSPHRASE: '   ' }), '');
  assert.equal(parolaDellaCostruzione({}), '');
  assert.equal(parolaDellaCostruzione(undefined), '');
});

test('ogni strumento legge FILO_BUILD_PASSPHRASE da parolaDellaCostruzione, non dall’ambiente nudo', () => {
  const cartella = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts');
  const nudi = [];
  for (const f of [...readdirSync(cartella), ...readdirSync(join(cartella, 'lib')).map((x) => `lib/${x}`)]) {
    if (!f.endsWith('.mjs') || f === 'build-alarm.mjs') continue;
    if (/env(\?\.|\[['"])FILO_BUILD_PASSPHRASE/.test(readFileSync(join(cartella, f), 'utf8'))) nudi.push(f);
  }
  assert.deepEqual(nudi, [], 'con gli spazi ai bordi il server la rifiuta: si passa dal pulitore');
});

describe('le chiavi arrivano al server', () => {
  const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'build-alarm.mjs');

  // Il server vero risponde 401 bad_passphrase a una parola d'ordine che non è la sua, spazi compresi.
  async function spedisci(argomenti, { parola = 'prova', giusta = 'prova' } = {}) {
    const ricevute = [];
    const srv = createServer((req, res) => {
      let corpo = '';
      req.on('data', (c) => { corpo += c; });
      req.on('end', () => {
        const json = JSON.parse(corpo);
        ricevute.push(json);
        const buona = json.passphrase === giusta;
        res.writeHead(buona ? 200 : 401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(buona ? { ok: true, num: '#9', duplicate: false } : { ok: false, reason: 'bad_passphrase' }));
      });
    });
    await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
    const dir = cartellaTemporanea('filo-allarme-chiavi-');
    try {
      writeFileSync(join(dir, 'chiavi.txt'), 'suite:tests/a.spec.mjs\n\nsuite:tests/a.spec.mjs\nsuite:fuori-dai-casi\n');
      writeFileSync(join(dir, 'unit.log'), `not ok 1 - x\n${String.raw`  location: 'tests\unit\y.test.mjs:1:1'`}\n`);
      const env = { ...process.env, FILO_ROUTINE_API: `http://127.0.0.1:${srv.address().port}`, FILO_BUILD_PASSPHRASE: parola,
        NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' };
      try {
        const r = await esegui(process.execPath, [CLI, ...argomenti], { cwd: dir, env });
        return { ricevute, stdout: r.stdout, registro: `${r.stdout}\n${r.stderr}`, uscita: 0 };
      } catch (e) {
        return { ricevute, stdout: e.stdout || '', registro: `${e.stdout || ''}\n${e.stderr || ''}`, uscita: e.code ?? 1 };
      }
    } finally {
      await new Promise((ok) => srv.close(ok));
      togliCartella(dir);
    }
  }

  test('--chiave, --chiavi-da e --chiavi-unit finiscono in `keys`, senza doppioni', async () => {
    const { ricevute } = await spedisci(['Titolo', 'testo', '--chiave', 'rilascio:fermo', '--chiave', 'rilascio:fermo',
      '--chiavi-da', 'chiavi.txt', '--chiavi-unit', 'unit.log']);
    assert.equal(ricevute.length, 1);
    assert.deepEqual(ricevute[0].keys,
      ['rilascio:fermo', 'suite:tests/a.spec.mjs', 'suite:fuori-dai-casi', 'unit:tests/unit/y.test.mjs']);
    assert.equal(ricevute[0].name, 'Titolo (a, errori fuori dai casi, y)');
  });

  test('due guasti diversi arrivano con due titoli diversi, ciascuno col suo', async () => {
    const titolo = 'Suite Playwright rossa su main: commit non pubblicabile';
    const a = (await spedisci([titolo, 'testo', '--chiave', 'suite:tests/wallet-credits.spec.mjs'])).ricevute[0].name;
    const b = (await spedisci([titolo, 'testo', '--chiave', 'suite:tests/board-offline-error.spec.mjs'])).ricevute[0].name;
    assert.notEqual(a, b);
    assert.match(a, /wallet-credits/);
    assert.match(b, /board-offline-error/);
    const u = (await spedisci(['Controlli automatici rossi', 'testo', '--chiavi-unit', 'unit.log'])).ricevute[0].name;
    assert.equal(u, 'Controlli automatici rossi (y)');
  });

  test('senza chiavi il campo non parte: un server vecchio e uno nuovo fanno quel che facevano', async () => {
    const { ricevute } = await spedisci(['Titolo', 'testo']);
    assert.equal(ricevute.length, 1);
    assert.ok(!('keys' in ricevute[0]), 'un `keys` vuoto non deve arrivare');
  });

  // #1210: il segreto incollato con la riga rientrata in cui routine-keys stampava la parola d'ordine.
  test('una parola d’ordine incollata con spazi e a capo ai bordi arriva pulita, e l’allarme si apre', async () => {
    const r = await spedisci(['Titolo', 'testo', '--chiave', 'rilascio:fermo'], { parola: '    prova\n' });
    assert.equal(r.uscita, 0, r.registro);
    assert.equal(r.ricevute.length, 1);
    assert.equal(r.ricevute[0].passphrase, 'prova');
    assert.match(r.registro, /feedback aperto \(#9\)/);
    assert.match(r.registro, /::warning::FILO_BUILD_PASSPHRASE ha spazi o a capo ai bordi/,
      'il segreto sporco va ricopiato: la corsa lo dice in evidenza');
  });

  test('una parola d’ordine pulita non porta avvisi', async () => {
    const r = await spedisci(['Titolo', 'testo']);
    assert.equal(r.uscita, 0, r.registro);
    assert.doesNotMatch(r.registro, /::warning::/);
  });

  test('una parola d’ordine che il server non riconosce si dice in evidenza, col segreto da ricopiare', async () => {
    const r = await spedisci(['Titolo', 'testo', '--chiave', 'rilascio:fermo'], { parola: 'vecchia' });
    assert.notEqual(r.uscita, 0);
    assert.match(r.registro, /non consegnato \(401 bad_passphrase\)/);
    assert.match(r.registro, /::error::Allarme non consegnato: il server non riconosce FILO_BUILD_PASSPHRASE[^\n]*«rilascio»/);
  });
});
