// Sentinella: nel repo, che è pubblico, non entra una copia di dati del server (#1108).
// Il 02/07/2026 una copia di lavoro di 300 feedback (testi, user agent, identificativi) è stata committata e spedita
// dal salvataggio automatico: tolta dall'albero, resta nella storia. La forma la riconosce scripts/lib/copie-di-dati.mjs.

import '../helpers/senzaSessione.mjs';
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import { scene, togliScene, runHookRaw, stdinEdit, git as gitScena } from '../helpers/scenaHook.mjs';
import { copieNelRepo, motivoCopia, motivoCopiaTesto, CARTELLA_FINTI, installaControlloSpedizione } from '../../scripts/lib/copie-di-dati.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const DOC = 'projects/filo/databases/(default)/documents/feedback/abc123';
const RISPOSTA_FIRESTORE = {
  documents: [{
    name: DOC,
    fields: { text: { stringValue: 'il tasto non va' }, userAgent: { stringValue: 'Mozilla/5.0' }, clientId: { stringValue: 'c-1' } },
    createTime: '2026-07-02T10:00:00Z',
  }],
};
const FEEDBACK_IN_CHIARO = [
  { id: 'abc123', text: 'il tasto non va', clientId: 'c-1', userAgent: 'Mozilla/5.0' },
  { id: 'def456', text: 'grazie', clientId: 'c-2', userAgent: 'Mozilla/5.0' },
];

describe('copie di dati del server fuori dal repo', () => {
  after(togliScene);

  test('nessun file tracciato ha la forma di una copia di dati del server', () => {
    const trovate = copieNelRepo(ROOT);
    assert.deepEqual(trovate, [],
      'questi file sono copie di dati del server, e il repo è pubblico: '
      + trovate.map((c) => `${c.file} (${c.motivo})`).join('; ')
      + '. Le copie di lavoro si scrivono in os.tmpdir(); i dati finti per le prove in tests/fixtures/. '
      + 'Si tolgono con `git rm --cached <file>`, ma restano nella storia già spedita: va detto all\'owner nel report');
  });

  test('i nomi delle copie di lavoro non entrano in git', () => {
    for (const nome of ['scripts/_fb_dump.json', 'feedback_dump.json', 'tmp/collezione-dump-2026.jsonl',
      'filo-copie/abc.json', 'filo-feedback/1108-x/allegato.txt']) {
      assert.doesNotThrow(
        () => git(ROOT, '-c', 'core.excludesFile=/dev/null', 'check-ignore', '--no-index', '-q', nome),
        `${nome} deve essere escluso da .gitignore: il salvataggio automatico committa e spedisce tutto il resto`);
    }
  });

  test('un file finto con la forma di una copia: fuori da tests/fixtures la sentinella lo trova, dentro no', () => {
    const repo = cartellaTemporanea('filo-copie-dati-');
    git(repo, 'init', '-q');
    mkdirSync(join(repo, 'scripts'));
    mkdirSync(join(repo, CARTELLA_FINTI), { recursive: true });
    writeFileSync(join(repo, 'scripts', 'lettura.json'), JSON.stringify(RISPOSTA_FIRESTORE, null, 2));
    writeFileSync(join(repo, 'scripts', 'chiaro.json'), JSON.stringify(FEEDBACK_IN_CHIARO));
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'node --test' } }));
    git(repo, 'add', '-A');

    const fuori = copieNelRepo(repo);
    assert.deepEqual(fuori.map((c) => c.file).sort(), ['scripts/chiaro.json', 'scripts/lettura.json'],
      'una risposta di Firestore e una lista di feedback in chiaro committate nel repo vanno trovate, qualunque nome abbiano');

    git(repo, 'rm', '-q', '--cached', 'scripts/lettura.json', 'scripts/chiaro.json');
    renameSync(join(repo, 'scripts', 'lettura.json'), join(repo, CARTELLA_FINTI, 'lettura.json'));
    renameSync(join(repo, 'scripts', 'chiaro.json'), join(repo, CARTELLA_FINTI, 'chiaro.json'));
    git(repo, 'add', '-A');
    assert.deepEqual(copieNelRepo(repo), [], 'in tests/fixtures/ stanno i dati finti delle prove: lì sono ammessi');
  });

  test('le forme di una copia: risposte di Firestore e feedback in chiaro, comunque impacchettati', () => {
    const copie = {
      'lista di documenti': RISPOSTA_FIRESTORE,
      'lista con nomi corti': { documents: [{ name: 'abc', fields: {} }] },
      'risposta di runQuery': [{ document: { name: DOC, fields: {} }, readTime: '2026-07-02T10:00:00Z' }],
      'risposta di batchGet': [{ found: { name: DOC, fields: { seq: { integerValue: '3' } } } }],
      'documento singolo': { name: DOC, fields: { seq: { integerValue: '3' } } },
      'campi senza nome': [{ fields: { text: { stringValue: 'x' } } }],
      'feedback in chiaro': FEEDBACK_IN_CHIARO,
      'feedback per identificativo': { abc123: { text: 'ciao', userAgent: 'Mozilla/5.0' } },
      'dentro un involucro': { esportati: 300, feedback: FEEDBACK_IN_CHIARO },
      'identificativi senza testo': [{ clientIdHash: 'h', userAgent: 'Mozilla/5.0' }],
    };
    for (const [caso, valore] of Object.entries(copie)) {
      assert.notEqual(motivoCopia(valore), '', `${caso}: è una copia di dati del server`);
      assert.notEqual(motivoCopiaTesto(JSON.stringify(valore, null, 2)), '', `${caso}, come testo: è una copia`);
    }
    const righe = FEEDBACK_IN_CHIARO.map((f) => JSON.stringify(f)).join('\n');
    assert.notEqual(motivoCopiaTesto(righe), '', 'una riga JSON per feedback è una copia anche lei');
    assert.notEqual(motivoCopiaTesto(`﻿${JSON.stringify(RISPOSTA_FIRESTORE)}`), '', 'il BOM di un file salvato su Windows non la nasconde');
  });

  test('quello che copia non è resta fuori: configurazioni, schemi, indici, testi', () => {
    const non = {
      'package.json': { name: 'filo', scripts: { test: 'x' }, dependencies: { electron: '1' } },
      'indici di Firestore': { indexes: [{ collectionGroup: 'feedback', fields: [{ fieldPath: 'seq', order: 'ASCENDING' }] }] },
      'uno schema': { properties: { text: { type: 'string' }, clientId: { type: 'string' }, userAgent: { type: 'string' } } },
      'soli testi': [{ text: 'a' }, { text: 'b' }],
      'name e fields come elenco': { name: 'modulo', fields: ['a', 'b'] },
    };
    for (const [caso, valore] of Object.entries(non)) assert.equal(motivoCopia(valore), '', `${caso}: non è una copia`);
    for (const testo of ['', '   ', 'testo normale', '// commento\nexport const a = 1;', '{ rotto', '[1, 2, 3]']) {
      assert.equal(motivoCopiaTesto(testo), '', `${JSON.stringify(testo)} non è una copia`);
    }
  });

  test('il salvataggio automatico non spedisce una copia, qualunque nome abbia, e spedisce il resto', () => {
    const { origin, work } = scene();
    gitScena(work, ['checkout', '-q', '-b', 'claude/prova']);
    mkdirSync(join(work, 'scripts', 'lib'), { recursive: true });
    for (const f of ['scripts/copie-in-scena.mjs', 'scripts/lib/copie-di-dati.mjs']) copyFileSync(join(ROOT, f), join(work, f));
    writeFileSync(join(work, 'scripts', 'feedback.json'), JSON.stringify(RISPOSTA_FIRESTORE, null, 2));
    writeFileSync(join(work, 'export.txt'), FEEDBACK_IN_CHIARO.map((f) => JSON.stringify(f)).join('\n'));
    writeFileSync(join(work, 'README.md'), 'lavoro\n');
    const r = runHookRaw(work, stdinEdit(join(work, 'README.md')), { FILO_ROUTINE: '1' });
    assert.equal(r.status, 0);
    const spediti = gitScena(origin, ['ls-tree', '-r', '--name-only', 'claude/prova']).split('\n');
    assert.ok(spediti.includes('README.md') && spediti.includes('scripts/copie-in-scena.mjs'), `il resto del lavoro parte: ${spediti}`);
    assert.ok(!spediti.includes('scripts/feedback.json') && !spediti.includes('export.txt'),
      `una copia spedita resta nella storia pubblica anche se tolta subito: ${spediti}`);
    assert.match(r.stdout, /feedback\.json.*export\.txt|export\.txt.*feedback\.json/, 'la sessione sa cosa non è partito e perché');
  });

  // Le altre strade che spediscono: il commit del rilascio, un commit a mano spedito dal salvataggio dopo (#1108 giro 2).
  function ramoConStrumenti() {
    const s = scene();
    gitScena(s.work, ['checkout', '-q', '-b', 'claude/prova']);
    mkdirSync(join(s.work, 'scripts', 'lib'), { recursive: true });
    for (const f of ['scripts/copie-in-scena.mjs', 'scripts/lib/copie-di-dati.mjs']) copyFileSync(join(ROOT, f), join(s.work, f));
    gitScena(s.work, ['add', '-A']);
    gitScena(s.work, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'strumenti']);
    gitScena(s.work, ['push', '-q', 'origin', 'claude/prova']);
    return s;
  }
  const spediti = (origin) => gitScena(origin, ['ls-tree', '-r', '--name-only', 'claude/prova']).split('\n');
  const commitAMano = (work, msg) => {
    gitScena(work, ['add', '-A']);
    gitScena(work, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', msg]);
  };

  test('al rilascio una copia nata da shell resta fuori dal commit e dalla vista di git, il resto parte', async () => {
    const { commitRestante, pushRamoCorrente } = await import('../../scripts/routine-channel.mjs');
    const s = ramoConStrumenti();
    writeFileSync(join(s.work, 'scripts', 'feedback.json'), JSON.stringify(RISPOSTA_FIRESTORE, null, 2));
    writeFileSync(join(s.work, 'note.txt'), 'lavoro\n');
    const c = commitRestante(s.work, { env: { FILO_ROUTINE: '1' } });
    assert.ok(c.ok);
    assert.deepEqual(c.fuori, ['scripts/feedback.json']);
    assert.ok(pushRamoCorrente(s.work, { env: { FILO_ROUTINE: '1' } }).ok);
    const su = spediti(s.origin);
    assert.ok(su.includes('note.txt') && !su.includes('scripts/feedback.json'), `${su}`);
    // Invisibile a git: un «git add -A» chiesto davanti a una cartella sporca non la rimette nel commit.
    assert.equal(gitScena(s.work, ['status', '--porcelain']), '');
  });

  test('una copia entrata in un commit a mano esce dalla storia prima della spedizione, il lavoro parte', () => {
    const s = ramoConStrumenti();
    writeFileSync(join(s.work, 'scripts', 'feedback.json'), JSON.stringify(RISPOSTA_FIRESTORE, null, 2));
    writeFileSync(join(s.work, 'a.txt'), 'uno\n');
    commitAMano(s.work, 'verifica: prove');
    writeFileSync(join(s.work, 'README.md'), 'lavoro\n');
    const r = runHookRaw(s.work, stdinEdit(join(s.work, 'README.md')), { FILO_ROUTINE: '1' });
    assert.equal(r.status, 0);
    const su = spediti(s.origin);
    assert.ok(su.includes('a.txt') && !su.includes('scripts/feedback.json'), `${su}`);
    assert.equal(gitScena(s.origin, ['show', 'claude/prova:README.md']), 'lavoro');
    const storia = gitScena(s.origin, ['log', '--format=', '--name-only', 'claude/prova']).split('\n');
    assert.ok(!storia.includes('scripts/feedback.json'), 'nemmeno in un commit di mezzo');
    assert.match(r.stdout, /feedback\.json/, 'la sessione sa cosa è stato tolto');
  });

  test('un file che era una copia ed è stato corretto dopo parte com\'è adesso, senza la copia nella storia', async () => {
    const { pushRamoCorrente } = await import('../../scripts/routine-channel.mjs');
    const s = ramoConStrumenti();
    writeFileSync(join(s.work, 'dati.json'), JSON.stringify(FEEDBACK_IN_CHIARO));
    commitAMano(s.work, 'copia');
    writeFileSync(join(s.work, 'dati.json'), '{"soglia": 3}\n');
    commitAMano(s.work, 'corretto');
    assert.ok(pushRamoCorrente(s.work).ok);
    assert.equal(gitScena(s.origin, ['show', 'claude/prova:dati.json']), '{"soglia": 3}');
    const blob = gitScena(s.origin, ['log', '-p', '--format=', 'claude/prova', '--', 'dati.json']);
    assert.doesNotMatch(blob, /clientId/);
  });

  test('con una fusione fra i commit da spedire il ramo non parte, e il motivo dice come toglierla a mano', async () => {
    const { pushRamoCorrente } = await import('../../scripts/routine-channel.mjs');
    const s = ramoConStrumenti();
    writeFileSync(join(s.work, 'export.txt'), JSON.stringify(RISPOSTA_FIRESTORE));
    commitAMano(s.work, 'copia');
    gitScena(s.work, ['checkout', '-q', '-b', 'laterale', 'HEAD~1']);
    writeFileSync(join(s.work, 'b.txt'), 'b\n');
    commitAMano(s.work, 'laterale');
    gitScena(s.work, ['checkout', '-q', 'claude/prova']);
    gitScena(s.work, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'merge', '-q', '--no-edit', 'laterale']);
    const p = pushRamoCorrente(s.work);
    assert.equal(p.ok, false);
    assert.match(p.reason, /export\.txt[\s\S]*git reset --soft/);
    assert.ok(!spediti(s.origin).includes('export.txt'));
  });

  test('una copia salvata a metà (le prime righe di una risposta lunga) è ancora una copia', () => {
    const documenti = { documents: Array.from({ length: 30 }, (_, i) => ({ ...RISPOSTA_FIRESTORE.documents[0], name: `${DOC}${i}` })) };
    const firestore = JSON.stringify(documenti, null, 2);
    assert.notEqual(motivoCopiaTesto(firestore.split('\n').slice(0, 120).join('\n')), '', 'risposta di Firestore interrotta');
    const chiaro = JSON.stringify(Array.from({ length: 30 }, () => FEEDBACK_IN_CHIARO[0]), null, 2);
    assert.notEqual(motivoCopiaTesto(chiaro.slice(0, chiaro.length / 2)), '', 'elenco di feedback in chiaro interrotto');
    assert.equal(motivoCopiaTesto('{"a": {"b": "}"}, "c": {"text": "x"'), '', 'graffe dentro le stringhe e oggetti innocui non bastano');
    // Più corta del primo documento: nessun oggetto chiuso, ma testo e identificativi di una persona ci sono già (#1108 giro 4).
    const unoSolo = (testo) => testo.slice(0, testo.indexOf('c-1') + 4);
    assert.notEqual(motivoCopiaTesto(unoSolo(firestore)), '', 'risposta di Firestore interrotta dentro il primo documento');
    assert.notEqual(motivoCopiaTesto(unoSolo(JSON.stringify({ documents: [{ fields: RISPOSTA_FIRESTORE.documents[0].fields }] }))), '',
      'campi di Firestore interrotti, senza il nome del documento');
    assert.notEqual(motivoCopiaTesto(unoSolo(chiaro)), '', 'feedback in chiaro interrotto dentro il primo');
    assert.equal(motivoCopiaTesto('{"text": "x", "titolo": "y"'), '', 'un testo interrotto senza chi l\'ha scritto non basta');
  });

  // Il salvataggio gira in ogni sessione: è lui a mettere il controllo prima del push, che vale per ogni altra strada.
  test('dopo un salvataggio un push a mano non spedisce una copia, e il messaggio non suggerisce di spedire', () => {
    const s = ramoConStrumenti();
    writeFileSync(join(s.work, 'README.md'), 'lavoro\n');
    assert.equal(runHookRaw(s.work, stdinEdit(join(s.work, 'README.md')), { FILO_ROUTINE: '1' }).status, 0);
    writeFileSync(join(s.work, 'feedback.json'), JSON.stringify(RISPOSTA_FIRESTORE, null, 2));
    commitAMano(s.work, 'copia');
    assert.throws(() => gitScena(s.work, ['push', '-q', 'origin', 'claude/prova']), /copia dei dati del server/);
    assert.ok(!spediti(s.origin).includes('feedback.json'));
    // Con una fusione dopo la copia il salvataggio si ferma: la coda del messaggio non deve dire di spedire a mano.
    gitScena(s.work, ['checkout', '-q', '-b', 'laterale', 'HEAD~1']);
    writeFileSync(join(s.work, 'b.txt'), 'b\n');
    commitAMano(s.work, 'laterale');
    gitScena(s.work, ['checkout', '-q', 'claude/prova']);
    gitScena(s.work, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'merge', '-q', '--no-edit', 'laterale']);
    writeFileSync(join(s.work, 'README.md'), 'lavoro 2\n');
    const r = runHookRaw(s.work, stdinEdit(join(s.work, 'README.md')), { FILO_ROUTINE: '1' });
    assert.match(r.stdout, /NON spedisco il ramo/);
    assert.doesNotMatch(r.stdout, /git push del ramo/);
    assert.ok(!spediti(s.origin).includes('feedback.json'));
  });

  // Una regola sola per ogni strada che spedisce, anche quelle che nessuno ha pensato: il pre-push di git (#1108 giro 3).
  test('col controllo di git installato una copia non parte nemmeno con un git push a mano; il codice sì', () => {
    const s = ramoConStrumenti();
    assert.equal(installaControlloSpedizione(s.work), 'installato');
    assert.equal(installaControlloSpedizione(s.work), 'presente');
    writeFileSync(join(s.work, 'scripts', 'feedback.json'), JSON.stringify(RISPOSTA_FIRESTORE, null, 2));
    commitAMano(s.work, 'copia');
    assert.throws(() => gitScena(s.work, ['push', '-q', 'origin', 'claude/prova']), /copia dei dati del server/);
    assert.ok(!spediti(s.origin).includes('scripts/feedback.json'));
    gitScena(s.work, ['reset', '-q', '--hard', 'HEAD~1']);
    writeFileSync(join(s.work, 'note.txt'), 'lavoro\n');
    commitAMano(s.work, 'lavoro');
    gitScena(s.work, ['push', '-q', 'origin', 'claude/prova']);
    assert.ok(spediti(s.origin).includes('note.txt'));
  });

  test('chi riparte su un ramo non spedisce la copia lasciata nei commit locali da una sessione morta', async () => {
    const { prepareBranch } = await import('../../scripts/lib/branch-integrity.mjs');
    const s = ramoConStrumenti();
    gitScena(s.work, ['fetch', '-q', 'origin']);
    writeFileSync(join(s.work, 'export.json'), JSON.stringify(FEEDBACK_IN_CHIARO));
    commitAMano(s.work, 'copia, poi la sessione muore');
    assert.ok(prepareBranch({ root: s.work, branch: 'claude/prova', checkpoint: null }).ok);
    const ovunque = gitScena(s.origin, ['log', '--all', '--format=', '--name-only']);
    assert.doesNotMatch(ovunque, /export\.json/, 'nemmeno nel ramo di scarto');
  });

  test('un pre-push che non è nostro non si tocca', () => {
    const s = ramoConStrumenti();
    const dove = join(s.work, '.git', 'hooks', 'pre-push');
    writeFileSync(dove, '#!/bin/sh\nexit 0\n');
    assert.equal(installaControlloSpedizione(s.work), 'altrui');
    assert.equal(readFileSync(dove, 'utf8'), '#!/bin/sh\nexit 0\n');
  });
});
