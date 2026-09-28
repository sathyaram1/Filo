// L'allarme che apre un feedback quando la pubblicazione si ferma
// (scripts/build-alarm.mjs): il server tiene 10.000 caratteri di testo e
// taglia il resto in silenzio. Il taglio si fa prima di spedire e si DICE,
// col numero (giro del 14/09, terza verifica).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

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

test('gli argomenti: titolo e testo, --chiave ripetibile, --chiavi-da, --chiavi-unit', () => {
  assert.deepEqual(leggiArgomenti(['T', 'x', '--chiave', 'a', '--chiave', 'b', '--chiavi-da', 'k.txt', '--chiavi-unit', 'u.log']),
    { posizionali: ['T', 'x'], chiavi: ['a', 'b'], chiaviDa: ['k.txt'], chiaviUnit: ['u.log'] });
  assert.deepEqual(leggiArgomenti(['T', 'x']).chiavi, [], 'senza chiavi resta l\'uso di prima');
  assert.throws(() => leggiArgomenti(['T', 'x', '--chiave']), /vuole un valore/);
  assert.throws(() => leggiArgomenti(['T', 'x', '--chiavi']), /non capita/);
});

describe('le chiavi arrivano al server', () => {
  const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'build-alarm.mjs');

  async function spedisci(argomenti) {
    const ricevute = [];
    const srv = createServer((req, res) => {
      let corpo = '';
      req.on('data', (c) => { corpo += c; });
      req.on('end', () => {
        ricevute.push(JSON.parse(corpo));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, num: '#9', duplicate: false }));
      });
    });
    await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
    const dir = cartellaTemporanea('filo-allarme-chiavi-');
    try {
      writeFileSync(join(dir, 'chiavi.txt'), 'suite:tests/a.spec.mjs\n\nsuite:tests/a.spec.mjs\nsuite:fuori-dai-casi\n');
      writeFileSync(join(dir, 'unit.log'), `not ok 1 - x\n${String.raw`  location: 'tests\unit\y.test.mjs:1:1'`}\n`);
      const env = { ...process.env, FILO_ROUTINE_API: `http://127.0.0.1:${srv.address().port}`, FILO_BUILD_PASSPHRASE: 'prova',
        NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' };
      const r = await esegui(process.execPath, [CLI, ...argomenti], { cwd: dir, env });
      return { ricevute, stdout: r.stdout };
    } finally {
      await new Promise((ok) => srv.close(ok));
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test('--chiave, --chiavi-da e --chiavi-unit finiscono in `keys`, senza doppioni', async () => {
    const { ricevute } = await spedisci(['Titolo', 'testo', '--chiave', 'rilascio:fermo', '--chiave', 'rilascio:fermo',
      '--chiavi-da', 'chiavi.txt', '--chiavi-unit', 'unit.log']);
    assert.equal(ricevute.length, 1);
    assert.deepEqual(ricevute[0].keys,
      ['rilascio:fermo', 'suite:tests/a.spec.mjs', 'suite:fuori-dai-casi', 'unit:tests/unit/y.test.mjs']);
    assert.equal(ricevute[0].name, 'Titolo');
  });

  test('senza chiavi il campo non parte: un server vecchio e uno nuovo fanno quel che facevano', async () => {
    const { ricevute } = await spedisci(['Titolo', 'testo']);
    assert.equal(ricevute.length, 1);
    assert.ok(!('keys' in ricevute[0]), 'un `keys` vuoto non deve arrivare');
  });
});
