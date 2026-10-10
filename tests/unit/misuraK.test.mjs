// Le parti pure della misura di K (#1157): rossi e guasti letti dai log, soglie, K, tabella. La misura vera gira nel
// contenitore delle routine (scripts/misura-k.mjs); qui si controlla che dai numeri esca il K giusto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  calcolaK, cpuDelCgroup, erroriInfrastruttura, estraiRossi, pressione, rossiNotiDa, tabella, valutaCorsa, baseDa,
  ambienteWorker, passiWorker, SPEC_MISURA,
} from '../../scripts/misura-k.mjs';
import { specsForChangedFiles } from '../../scripts/finish-local.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SPEC_FILE = SPEC_MISURA.map((s) => `tests/${s}.spec.mjs`);

test('coi valori predefiniti ogni worker, dopo il comando, corre spec Electron: sul ramo della misura le aree non ne scelgono', () => {
  assert.deepEqual(specsForChangedFiles([], SPEC_FILE), [], 'un ramo che non tocca niente non sceglie spec da solo');
  const env = ambienteWorker({ PATH: 'p', FILO_REPO_ROOT: '/altrove', FILO_NO_BEAT: '1' }, 2, 3);
  assert.deepEqual([env.FILO_WORKER, env.FILO_WORKER_PARALLELI, env.PATH], ['2', '3', 'p']);
  assert.equal(env.FILO_REPO_ROOT, undefined, 'il principale della misura non arriva ai test');
  assert.equal(env.FILO_NO_BEAT, undefined);

  const win = passiWorker('npm run finish:check', SPEC_MISURA, { indice: 2, paralleli: 3, env, platform: 'win32' });
  assert.equal(win.ok, true);
  assert.deepEqual(win.passi.map((p) => [p.cmd, p.args]), [['npm run finish:check', []], ['npx', ['playwright', 'test', ...SPEC_FILE]]]);

  const linux = passiWorker('npm run finish:check', SPEC_MISURA, { indice: 2, paralleli: 3, env, platform: 'linux', haXvfb: () => true });
  assert.deepEqual(linux.passi[1].args.slice(0, 4), ['-a', '-n', '120', 'npx'], 'il worker 2 cerca il display dalla base sua');
  assert.equal(linux.passi[1].cmd, 'xvfb-run');
  assert.equal(linux.passi[1].env.ELECTRON_DISABLE_SANDBOX, '1');
  assert.equal(linux.passi[1].env.FILO_WORKER, '2');
  const senzaXvfb = passiWorker('npm run finish:check', SPEC_MISURA, { indice: 1, paralleli: 1, env: {}, platform: 'linux', haXvfb: () => false });
  assert.equal(senzaXvfb.ok, false, 'senza xvfb la misura si ferma prima, col motivo');
  assert.deepEqual(passiWorker('x', [], { indice: 1, paralleli: 1, env: {} }).passi.length, 1, '--spec vuoto: solo il comando');
});

test('gli spec della misura esistono e non stanno fra i rossi noti', () => {
  assert.deepEqual(SPEC_FILE.filter((f) => !existsSync(resolve(ROOT, f))), []);
  const noti = new Set(rossiNotiDa(JSON.parse(readFileSync(resolve(ROOT, 'tests', 'rossi-noti.json'), 'utf8'))));
  assert.deepEqual(SPEC_MISURA.filter((s) => noti.has(`tests/${s}`)), [], 'misurerebbero il contenitore, non il carico');
});

const corsa = (n, minuti, { rossi = [], infra = [], piccoMb = 4000, tettoMb = 16000, codici = Array(n).fill(0) } = {}) => ({
  n, durateMs: Array(n).fill(minuti * 60000), codici, rossi, infra, piccoMb, tettoMb, caricoMax: 3, psiCpu: 1, psiMem: 0,
});

test('dai log: i file rossi di Playwright e degli unit, senza doppioni', () => {
  const log = [
    '  ✘  12 [electron] › tests/menu.spec.mjs:10:5 › il menu si apre (3.2s)',
    '  1) [electron] › tests/menu.spec.mjs:10:5 › il menu si apre',
    '  ✓  13 [electron] › tests/home.spec.mjs:3:1 › verde',
    '  ✖ tests/unit/branchIntegrity.test.mjs:44  la guardia  (gruppo 2)',
    'tests/altro.spec.mjs nominato in una riga qualunque',
  ].join('\n');
  assert.deepEqual(estraiRossi(log), ['tests/menu.spec.mjs', 'tests/unit/branchIntegrity.test.mjs']);
});

test('dai log: il TAP di node --test fuori da un terminale (com\'era nella prova a secco)', () => {
  const tap = [
    'not ok 26 - tests\\\\unit\\\\autoCommitGate.test.mjs',
    'ok 27 - verde',
    'not ok 3673 - due invocazioni con lo stesso biglietto accendono UN battito solo',
    '    not ok 2 - un sotto-test, gia\' contato dal suo padre',
    'not ok 3680 - ancora da fare # TODO',
    'not ok 3681 - worker in parallelo (#1157): il battito resta',
  ].join('\n');
  assert.deepEqual(estraiRossi(tap), ['due invocazioni con lo stesso biglietto accendono UN battito solo', 'tests/unit/autoCommitGate.test.mjs', 'worker in parallelo (#1157): il battito resta']);
});

test('dai log: su Windows Playwright scrive il percorso con le barre rovesciate, e il rosso conta lo stesso', () => {
  const log = [
    '  ✘  3 tests\\context-menu.spec.mjs:30:1 › la voce feedback (21.2s)',
    '  1) tests\\verifica\\locale-x\\giro1-r1-a.spec.mjs:5:1 › r1 caso',
    '  ok  1 tests\\tab-archive.spec.mjs:15:1 › verde',
  ].join('\n');
  assert.deepEqual(estraiRossi(log), ['tests/context-menu.spec.mjs', 'tests/verifica/locale-x/giro1-r1-a.spec.mjs']);
});

test('un worker che esce con errore senza un rosso riconoscibile non vale come sano, se da solo usciva pulito', () => {
  const uno = [corsa(1, 20), corsa(1, 20)];
  const r = calcolaK([...uno, corsa(2, 21, { codici: [0, 1] })]);
  assert.equal(r.k, 1);
  assert.match(r.motivo, /con 2 insieme: uscite diverse da zero: worker 2 → 1/);
  // Da solo il comando usciva gia' rosso coi suoi unit: li' l'uscita non dice niente, contano i rossi.
  const sporca = [corsa(1, 20, { codici: [1], rossi: ['tests/unit/lento.test.mjs'] })];
  assert.equal(calcolaK([...sporca, corsa(2, 21, { codici: [1, 1], rossi: ['tests/unit/lento.test.mjs'] })]).k, 2);
  assert.equal(calcolaK([...sporca, corsa(2, 21, { codici: [1, 1], rossi: ['tests/unit/lento.test.mjs', 'tests/menu.spec.mjs'] })]).k, 1);
  // Una base che cade senza dire cosa: la misura non vedrebbe niente.
  const cieca = calcolaK([corsa(1, 1, { codici: [1] }), corsa(2, 1, { codici: [1, 1] })]);
  assert.equal(cieca.k, null);
  assert.match(cieca.motivo, /senza un rosso riconoscibile/);
});

test('dai log: le famiglie dei guasti d\'infrastruttura', () => {
  assert.deepEqual(erroriInfrastruttura('xvfb-run: error: Xvfb failed to start\nlisten EADDRINUSE: :::8089'), ['xvfb', 'porta']);
  assert.deepEqual(erroriInfrastruttura("fatal: Unable to create '/x/.git/index.lock': File exists."), ['lock']);
  assert.deepEqual(erroriInfrastruttura('ENOSPC: no space left on device\nKilled'), ['disco', 'ucciso']);
  assert.deepEqual(erroriInfrastruttura('tutto verde'), []);
});

test('pressione, cpu del cgroup e rossi noti', () => {
  assert.equal(pressione('some avg10=2.50 avg60=1.00 avg300=0.10 total=1\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0'), 2.5);
  assert.equal(pressione(null), null);
  assert.equal(cpuDelCgroup('200000 100000'), 2);
  assert.equal(cpuDelCgroup('max 100000'), null);
  assert.deepEqual(rossiNotiDa({ specs: ['tests/a.spec.mjs'], contenitore: { specs: ['tests/b.spec.mjs', { spec: 'tests/c.spec.mjs' }] } }),
    ['tests/a.spec.mjs', 'tests/b.spec.mjs', 'tests/c.spec.mjs']);
});

test('le soglie: rossi in più, infrastruttura, memoria all\'85%, tempo a 1,5 volte', () => {
  const base = baseDa([corsa(1, 20, { rossi: ['tests/instabile.spec.mjs'] }), corsa(1, 22)]);
  assert.equal(base.durataMs, 21 * 60000);
  assert.equal(valutaCorsa(corsa(2, 30, { rossi: ['tests/instabile.spec.mjs'] }), base).ok, true, 'un rosso gia\' visto da solo non conta');
  assert.match(valutaCorsa(corsa(2, 25, { rossi: ['tests/nuovo.spec.mjs'] }), base).motivi.join(), /rossi in più: tests\/nuovo/);
  assert.equal(valutaCorsa(corsa(2, 25, { rossi: ['tests/noto.spec.mjs'] }), base, { rossiNoti: ['tests/noto.spec.mjs'] }).ok, true);
  assert.match(valutaCorsa(corsa(2, 25, { infra: ['xvfb'] }), base).motivi.join(), /infrastruttura: xvfb/);
  assert.match(valutaCorsa(corsa(2, 25, { piccoMb: 13700, tettoMb: 16000 }), base).motivi.join(), /memoria/);
  assert.equal(valutaCorsa(corsa(2, 25, { piccoMb: 13500, tettoMb: 16000 }), base).ok, true, 'sotto l\'85%');
  assert.match(valutaCorsa(corsa(3, 32, {}), base).motivi.join(), /tempo 1\.52×/);
  assert.equal(valutaCorsa(corsa(3, 31, {}), base).ok, true);
});

test('K: il piu\' grande N che regge salendo da 1, senza buchi', () => {
  const uno = [corsa(1, 20), corsa(1, 20)];
  assert.deepEqual(calcolaK([...uno, corsa(2, 22), corsa(3, 26), corsa(4, 29)]), { k: 4, motivo: '' });
  const r = calcolaK([...uno, corsa(2, 22), corsa(3, 26, { infra: ['xvfb'] }), corsa(4, 29)]);
  assert.equal(r.k, 2, 'cade a 3: un 4 che passa e\' rumore');
  assert.match(r.motivo, /con 3 insieme: infrastruttura: xvfb/);
  assert.equal(calcolaK([...uno, corsa(2, 40)]).k, 1, 'a 2 il tempo raddoppia: K = 1');
  assert.equal(calcolaK([corsa(2, 20)]).k, null, 'senza base non si misura');
  assert.equal(calcolaK([corsa(1, 20, { infra: ['ucciso'] }), corsa(2, 20)]).k, null, 'una base rotta non e\' una base');
  assert.equal(calcolaK([corsa(1, 20, { piccoMb: 15000, tettoMb: 16000 })]).k, null);
});

test('la tabella: una riga per corsa, con lavori all\'ora ed esito', () => {
  const t = tabella([corsa(1, 20), corsa(1, 20), corsa(2, 24, { rossi: ['tests/nuovo.spec.mjs'] })]).split('\n');
  assert.equal(t.length, 4);
  assert.match(t[0], /^N \| durata media \| lavori\/ora/);
  assert.match(t[1], /^1 \| 20\.0 min \| 3\.0 \| 4000\/16000 \| .* \| ok$/);
  assert.match(t[3], /^2 \| 24\.0 min \| 5\.0 \| .* \| 1 \| — \| rossi in più: tests\/nuovo\.spec\.mjs$/);
});
