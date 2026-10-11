// Le parti pure della misura di K (#1157): rossi e guasti letti dai log, soglie, K, tabella. La misura vera gira nel
// contenitore delle routine (scripts/misura-k.mjs); qui si controlla che dai numeri esca il K giusto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  calcolaK, cpuDelCgroup, erroriInfrastruttura, estraiRossi, pressione, rossiNotiDa, tabella, valutaCorsa, baseDa,
  ambienteWorker, passiWorker, SPEC_MISURA, testFatti,
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
  assert.deepEqual(SPEC_MISURA.filter((s) => noti.has(`tests/${s}.spec.mjs`)), [], 'misurerebbero il contenitore, non il carico');
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

test('dai log: un test che nomina un guasto nel titolo o nella sua uscita non è un guasto d\'infrastruttura', () => {
  // Con questa riga verde fra gli unit la misura col comando vero dava sempre «base da rifare» (verifica #1157 giro 3).
  const verdi = [
    '    # Subtest: index.lock a terra: niente commit, e la sessione lo sa col motivo di git',
    '    ok 1 - index.lock a terra: niente commit, e la sessione lo sa col motivo di git',
    '      ---',
    '      duration_ms: 12.3',
    "      error: 'listen EADDRINUSE: :::8089'",
    '      ...',
    "# fatal: Unable to create '/x/.git/index.lock': File exists.",
    'not ok 2 - Killed a meta\'',
    '  ---',
    '  stack: ENOSPC: no space left on device',
    '  ...',
    '  ok  1 tests\\tab-archive.spec.mjs:15:1 › Xvfb failed to start, per finta (8.0s)',
    '  1) tests\\menu.spec.mjs:3:1 › Process failed to launch nel titolo',
    '  ✖ tests/unit/x.test.mjs:4  SIGKILL nel titolo  (gruppo 1)',
  ].join('\n');
  assert.deepEqual(erroriInfrastruttura(verdi), []);
  // I guasti veri restano: fuori dal TAP, nel dettaglio d'errore di Playwright, dopo un blocco YAML chiuso.
  assert.deepEqual(erroriInfrastruttura(`${verdi}\nxvfb-run: error: Xvfb failed to start`), ['xvfb']);
  assert.deepEqual(erroriInfrastruttura(`${verdi}\n    Error: electron.launch: Process failed to launch!`), ['avvio']);
  assert.deepEqual(erroriInfrastruttura(`${verdi}\nfatal: Unable to create '/c/.git/index.lock': File exists.`), ['lock']);
  // Un `---` qualunque, non dopo un risultato del TAP, non apre un blocco che inghiotte il resto.
  assert.deepEqual(erroriInfrastruttura('---\nKilled'), ['ucciso']);
  // Stessa regola per i rossi: l'uscita di un test verde che stampa un elenco di rossi non è un rosso.
  assert.deepEqual(estraiRossi('# Subtest: il riepilogo\n# ✖ tests/unit/finto.test.mjs:3  stampato da un test\nok 1 - il riepilogo'), []);
});

test('dai log: il fermo del lanciatore degli unit è un rosso, col file fermo e quelli chiusi insieme', () => {
  assert.deepEqual(estraiRossi([
    '[test:unit] ROSSO: tests\\unit\\a.test.mjs non è andato avanti per 20 minuti, e la corsa è stata chiusa.',
    '[test:unit] chiusi insieme, senza esito: tests/unit/b.test.mjs, tests/unit/c.test.mjs.',
  ].join('\n')), ['tests/unit/a.test.mjs', 'tests/unit/b.test.mjs', 'tests/unit/c.test.mjs']);
  assert.deepEqual(estraiRossi('[test:unit] ROSSO: per 20 minuti non è andato avanti niente, e la corsa è stata chiusa.'), ['test:unit fermo']);
});

test('con una base già rossa, un worker che esce con errore senza rossi suoi cade: i rossi degli altri non lo coprono', () => {
  const sporca = { ...corsa(1, 20, { codici: [1], rossi: ['lento'] }), rossiPerWorker: [['lento']] };
  const coperto = { ...corsa(2, 21, { codici: [1, 1], rossi: ['lento'] }), rossiPerWorker: [['lento'], []] };
  const r = calcolaK([sporca, coperto]);
  assert.equal(r.k, 1);
  assert.match(r.motivo, /uscite diverse da zero senza un rosso riconoscibile: worker 2 → 1/);
  const sani = { ...corsa(2, 21, { codici: [1, 1], rossi: ['lento'] }), rossiPerWorker: [['lento'], ['lento']] };
  assert.equal(calcolaK([sporca, sani]).k, 2, 'lo stesso rosso della base in ogni worker non è un degrado');
});

test('dai log: i test finiti sono i conti di node --test, gruppo per gruppo, più il riepilogo di Playwright', () => {
  const log = [
    'TAP version 13',
    'ok 1 - verde',
    '# # tests 3',
    '1..1',
    '# tests 5364',
    '# pass 5348',
    '[test:unit] gruppo 2 di 2 (40 file)',
    '# tests 10',
    '  ok 13 tests\\tab-archive.spec.mjs:154:1 › verde (4.9s)',
    '  1) [electron] › tests\\menu.spec.mjs:3:1 › rosso',
    '  1 failed',
    '  1 flaky',
    '  11 passed (1.1m)',
    '  2 did not run',
  ].join('\n');
  assert.equal(testFatti(log), 5364 + 10 + 1 + 1 + 11, 'l\'uscita di un test che stampa conti suoi e i test non partiti non contano');
  assert.equal(testFatti('nessun conto'), 0);
});

test('un worker che scrive il rosso della base e poi cade senza finire i test non vale come sano', () => {
  // Verifica #1157 giro 4: un gruppo unico di unit ucciso dopo il rosso della base, o un gruppo interrotto, dava K = 2.
  const sporca = { ...corsa(1, 20, { codici: [1], rossi: ['lento'] }), rossiPerWorker: [['lento']], fattiPerWorker: [5377] };
  const caduto = { ...corsa(2, 21, { codici: [1, 1], rossi: ['lento'] }), rossiPerWorker: [['lento'], ['lento']], fattiPerWorker: [5377, 2100] };
  const r = calcolaK([sporca, caduto]);
  assert.equal(r.k, 1);
  assert.match(r.motivo, /test non finiti: worker 2 → 2100 su 5377/);
  const sani = { ...caduto, fattiPerWorker: [5377, 5377] };
  assert.equal(calcolaK([sporca, sani]).k, 2);
  // Con la base pulita conta lo stesso: un worker uscito a zero con meno test non ha fatto il lavoro.
  const pulita = { ...corsa(1, 20), fattiPerWorker: [5377] };
  assert.equal(calcolaK([pulita, { ...corsa(2, 21), fattiPerWorker: [5377, 13] }]).k, 1);
  // Una base che ha fatto meno test di un worker in parallelo non ha finito lei: la misura non vale.
  const corta = calcolaK([{ ...corsa(1, 20, { codici: [1], rossi: ['lento'] }), fattiPerWorker: [3000] }, sani]);
  assert.equal(corta.k, null);
  assert.match(corta.motivo, /non ha finito i suoi test \(3000 su 5377\)/);
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

test('dai log: uno spec caduto a un tentativo e passato a uno dopo non è un rosso; uno caduto a ogni tentativo sì', () => {
  // Verifica #1157 giro 5: Playwright lo segna «flaky» ed esce a zero, ma il tentativo caduto lascia le sue righe.
  const windows = [
    '  x  1 tests\\a.spec.mjs:2:1 › instabile (9ms)',
    '  ok 2 tests\\a.spec.mjs:2:1 › instabile (retry #1) (7ms)',
    '  1) tests\\a.spec.mjs:4:33 › ciclo due ─────────',
    '  2) tests\\a.spec.mjs:2:1 › instabile ──────────',
    '  3) tests\\a.spec.mjs:4:33 › ciclo uno ─────────',
    '  4) tests\\b.spec.mjs:2:1 › solo instabile ',
    '  1 failed',
    '    tests\\a.spec.mjs:4:33 › ciclo due ──────────',
    '  3 flaky',
    '    tests\\a.spec.mjs:2:1 › instabile ───────────',
    '    tests\\a.spec.mjs:4:33 › ciclo uno ──────────',
    '    tests\\b.spec.mjs:2:1 › solo instabile ─',
    '  9 passed (1.2m)',
  ].join('\n');
  assert.deepEqual(estraiRossi(windows), ['tests/a.spec.mjs'], 'due casi di un ciclo stanno sulla stessa riga: conta il titolo');
  const linux = [
    '  ✘  1 [electron] › tests/b.spec.mjs:2:1 › solo instabile (9.1s)',
    '  ✓  2 [electron] › tests/b.spec.mjs:2:1 › solo instabile (retry #1) (4.2s)',
    '  1) [electron] › tests/b.spec.mjs:2:1 › solo instabile ──────────',
    '  1 flaky',
    '    [electron] › tests/b.spec.mjs:2:1 › solo instabile ───────────',
    '  12 passed (1.3m)',
  ].join('\n');
  assert.deepEqual(estraiRossi(linux), []);
  assert.equal(testFatti(linux), 13);
  const verde = { ...corsa(1, 20), rossiPerWorker: [[]], fattiPerWorker: [13] };
  const instabile = { ...corsa(2, 21, { rossi: estraiRossi(linux) }), rossiPerWorker: [[], estraiRossi(linux)], fattiPerWorker: [13, 13] };
  assert.equal(calcolaK([verde, verde, instabile]).k, 2);
});

test('i rossi noti scritti senza estensione valgono per i rossi dei log, e spiegano l\'uscita del worker', () => {
  // Verifica #1157 giro 5: l'elenco del progetto scrive «tests/transparency-page», i log «tests/transparency-page.spec.mjs».
  const rossiNoti = rossiNotiDa({ contenitore: { specs: [{ spec: 'tests/transparency-page' }, 'tests\\x.spec.mjs'] } });
  assert.deepEqual(rossiNoti, ['tests/transparency-page.spec.mjs', 'tests/x.spec.mjs']);
  const noto = 'tests/transparency-page.spec.mjs';
  const base = { ...corsa(1, 20), rossiPerWorker: [[]], fattiPerWorker: [13] };
  const due = (suoi) => ({ ...corsa(2, 21, { codici: [0, 1], rossi: suoi }), rossiPerWorker: [[], suoi], fattiPerWorker: [13, 13] });
  assert.equal(calcolaK([base, due([noto])], { rossiNoti }).k, 2);
  assert.equal(calcolaK([base, due([noto])]).k, 1, 'senza l\'elenco lo stesso rosso è in più');
  assert.match(calcolaK([base, due([])], { rossiNoti }).motivo, /uscite diverse da zero: worker 2 → 1/, 'un\'uscita senza rossi resta una caduta');
  assert.match(calcolaK([base, due([noto, 'tests/nuovo.spec.mjs'])], { rossiNoti }).motivo, /rossi in più: tests\/nuovo\.spec\.mjs/);
});
