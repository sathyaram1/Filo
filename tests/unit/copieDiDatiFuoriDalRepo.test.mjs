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
import { inspect } from 'node:util';
import { Console } from 'node:console';
import { Writable } from 'node:stream';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import { scene, togliScene, runHookRaw, stdinEdit, git as gitScena } from '../helpers/scenaHook.mjs';
import {
  copieNelRepo, motivoCopia, motivoCopiaTesto, motivoContenuto, CARTELLA_FINTI, installaControlloSpedizione,
} from '../../scripts/lib/copie-di-dati.mjs';

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

// La copia si riconosce dal contenuto, i campi di un feedback insieme, in qualunque forma sia scritta (#1360).
describe('una copia dei feedback si ferma in qualunque forma, intera o tagliata', () => {
  after(togliScene);

  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Filo/0.9.3 Electron/33.0.0';
  const FB = [
    { id: 'abc123', text: 'il tasto non va, l\'ho detto "due" volte\nseconda riga', clientId: 'c-1', userAgent: UA, seq: 3 },
    { id: 'def456', text: 'grazie', clientId: 'c-2', userAgent: 'Mozilla/5.0' },
  ];
  const nelFormatoDelServer = (f) => Object.fromEntries(Object.entries(f)
    .map(([k, v]) => [k, typeof v === 'number' ? { integerValue: String(v) } : { stringValue: v }]));
  const pyStr = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
  const py = (v) => (Array.isArray(v) ? `[${v.map(py).join(', ')}]`
    : typeof v === 'object' ? `{${Object.entries(v).map(([k, x]) => `${pyStr(k)}: ${py(x)}`).join(', ')}}`
      : typeof v === 'string' ? pyStr(v) : String(v));
  const csv = (s) => (/[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
  const unaRiga = (s) => s.replace(/\n/g, ' ');
  const documento = (f) => ({ name: `projects/filo/databases/(default)/documents/feedback/${f.id}`, fields: nelFormatoDelServer(f) });
  // Come la stampa di un DataFrame: colonne allineate a destra, due spazi fra l'una e l'altra, l'indice senza nome.
  const tabellaDiPandas = (righe, nomi) => {
    const tutte = [['', ...nomi], ...righe.map((r, i) => [String(i), ...r])];
    const larghe = tutte[0].map((_, k) => Math.max(...tutte.map((r) => r[k].length)));
    return tutte.map((r) => r.map((c, k) => c.padStart(larghe[k])).join('  ')).join('\n');
  };
  const tabellaDiNode = (righe) => {
    let fuori = '';
    const stdout = new Writable({ write(pezzo, _, fatto) { fuori += pezzo; fatto(); } });
    new Console({ stdout, colorMode: false }).table(righe);
    return fuori;
  };

  const FORME = {
    // #1108.2: le forme che non sono JSON.
    'la stampa normale di node': inspect(FB),
    'la stampa di node con un titolo davanti': `Trovati ${FB.length} feedback:\n${inspect(FB)}\n`,
    'la stampa di node di una risposta di Firestore': inspect({ documents: FB.map(documento) }),
    'la stampa di node a colori': inspect(FB, { colors: true }),
    'console.table di node': tabellaDiNode(FB.map(({ id, text, clientId, userAgent }) => ({ id, text, clientId, userAgent }))),
    'una tabella di pandas': tabellaDiPandas(FB.map((f) => [f.id, unaRiga(f.text), f.clientId, f.userAgent]), ['id', 'text', 'clientId', 'userAgent']),
    'una risposta salvata con le intestazioni HTTP': `HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=UTF-8\r\nVary: Origin\r\n\r\n${JSON.stringify({ documents: FB.map(documento) }, null, 2)}`,
    'una risposta HTTP in chiaro': `HTTP/2 200\ncontent-type: application/json\n\n${JSON.stringify(FB)}`,
    'un CSV con testo, identificativo e user agent': ['id,text,clientId,userAgent', ...FB.map((f) => [f.id, f.text, f.clientId, f.userAgent].map(csv).join(','))].join('\n'),
    'un CSV col punto e virgola, senza virgolette': ['id;text;clientId;userAgent', ...FB.map((f) => [f.id, unaRiga(f.text), f.clientId, f.userAgent].join(';'))].join('\r\n'),
    'un TSV': ['text\tclientId\tuserAgent', ...FB.map((f) => [unaRiga(f.text), f.clientId, f.userAgent].join('\t'))].join('\n'),
    'una tabella markdown': ['| text | clientId | userAgent |', '|---|---|---|', ...FB.map((f) => `| ${unaRiga(f.text)} | ${f.clientId} | ${f.userAgent} |`)].join('\n'),
    'un elenco nella sintassi di Python': py(FB),
    'oggetti di Python': `[${FB.map((f) => `Feedback(text=${pyStr(f.text)}, clientId='${f.clientId}', userAgent='${f.userAgent}')`).join(', ')}]`,
    'YAML': FB.map((f) => `- id: ${f.id}\n  text: "${unaRiga(f.text)}"\n  clientId: ${f.clientId}\n  userAgent: ${f.userAgent}`).join('\n'),
    'righe «chiave: valore», a capo di Windows': FB.map((f) => `text: ${unaRiga(f.text)}\r\nclientId: ${f.clientId}\r\nuserAgent: ${f.userAgent}\r\n`).join('\r\n'),
    'righe di log chiave=valore': FB.map((f) => `2026-10-19T10:00:00Z INFO text="${unaRiga(f.text).replace(/"/g, '\\"')}" clientId=${f.clientId} userAgent="${f.userAgent}"`).join('\n'),
    'un JSON dentro una stringa': JSON.stringify(JSON.stringify(FB)),
    // #1108.3: i soli campi dei documenti, nel formato del server, senza il percorso.
    'i campi dei documenti nel formato del server': JSON.stringify(FB.map(nelFormatoDelServer), null, 2),
    'una mappa identificativo → campi': JSON.stringify(Object.fromEntries(FB.map((f) => [f.id, nelFormatoDelServer(f)])), null, 2),
    'una mappa identificativo → campi, stampata da node': inspect(Object.fromEntries(FB.map((f) => [f.id, nelFormatoDelServer(f)]))),
  };

  test('ogni forma è una copia', () => {
    for (const [forma, testo] of Object.entries(FORME)) assert.notEqual(motivoCopiaTesto(testo), '', `${forma}: è una copia\n${testo}`);
  });

  // Senza i nomi esatti del server (jq @csv, la coda di un file, colonne rinominate) i dati sono gli stessi.
  test('una copia senza i nomi dei campi, o con altri nomi, o di cui resta solo la coda, è una copia', () => {
    const UA_VERO = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Filo/0.9.3 Chrome/130.0 Safari/537.36';
    const tanti = Array.from({ length: 30 }, (_, i) => ({
      id: `fbId${i}abcdefghijklmn`, text: `il tasto ${i} non risponde quando apro la scheda`, userAgent: UA_VERO, clientIdHash: String(i).padStart(32, 'a'),
    }));
    const righe = (elenco, d = ',') => elenco.map((f) => Object.values(f).map((v) => (d === ',' ? `"${v}"` : v)).join(d)).join('\n');
    const senzaIntestazione = righe(tanti);
    const conIntestazione = `id,text,userAgent,clientIdHash\n${senzaIntestazione}\n`;
    const forme = {
      'un CSV senza intestazione (jq @csv)': senzaIntestazione,
      'la coda di un CSV': conIntestazione.split('\n').slice(-20).join('\n'),
      'la coda di un TSV, senza virgolette': righe(tanti.slice(-5), '\t'),
      'un elenco di soli valori (jq -c)': tanti.slice(0, 3).map((f) => JSON.stringify(Object.values(f))).join('\n'),
      'colonne user_agent e client_id_hash': `id,text,user_agent,client_id_hash\n${righe(tanti.slice(0, 3))}`,
      'una colonna «User Agent»': `id,text,User Agent,clientIdHash\n${righe(tanti.slice(0, 3))}`,
      'una colonna useragent': `id,text,useragent,clientIdHash\n${righe(tanti.slice(0, 3))}`,
      'chiavi user_agent in JSON': JSON.stringify(tanti.slice(0, 3).map((f) => ({ id: f.id, text: f.text, user_agent: f.userAgent }))),
      'righe «User Agent: …»': `text: ${tanti[0].text}\nUser Agent: ${UA_VERO}\n`,
      'la coda di un elenco nel formato del server': JSON.stringify(tanti.map(nelFormatoDelServer), null, 2).split('\n').slice(-12).join('\n'),
      'la coda di una risposta di Firestore': JSON.stringify({ documents: tanti.map(documento) }, null, 2).split('\n').slice(-10).join('\n'),
      'la coda di una stampa di node in una riga': JSON.stringify(tanti.slice(0, 2)).slice(JSON.stringify(tanti.slice(0, 2)).lastIndexOf('"id"')),
    };
    for (const [forma, testo] of Object.entries(forme)) assert.notEqual(motivoCopiaTesto(testo), '', `${forma}: è una copia\n${testo}`);
    const non = {
      'una configurazione di dispositivi': JSON.stringify({ 'Desktop Chrome': { userAgent: UA_VERO, defaultBrowserType: 'chromium', viewport: { width: 1280, height: 720 } } }, null, 2),
      'un log di accessi': `1.2.3.4 - - [19/Oct/2026:10:00:00] "GET / HTTP/1.1" 200 512 "-" "${UA_VERO}"\n`,
      'un user agent da solo in un CSV': `"${UA_VERO}",200,ok\n`,
      'un elenco di regole che nomina i campi': "        ['text', 'url', 'title', 'userAgent', 'clientId',\n         'files', 'createdAt', 'seq']\n",
      'la coda di un documento senza chi scrive': '    "titolo": "tasto"\n  },\n  "text": "il tasto non va"\n}\n',
    };
    for (const [caso, testo] of Object.entries(non)) assert.equal(motivoCopiaTesto(testo), '', `${caso}: non è una copia\n${testo}`);
  });

  test('lettura intera e interrotta seguono la stessa regola', () => {
    for (const [forma, testo] of Object.entries(FORME)) {
      // Da quando c'è il primo identificativo, o il percorso del primo documento, ogni taglio è una copia.
      const da = Math.min(...['c-1', '/feedback/abc123'].map((s) => testo.indexOf(s)).filter((i) => i >= 0)) + 3;
      for (let n = da; n <= testo.length; n++) {
        assert.notEqual(motivoCopiaTesto(testo.slice(0, n)), '', `${forma}, tagliata a ${n} caratteri: è ancora una copia\n${testo.slice(0, n)}`);
      }
    }
    // E il contrario: una lettura a metà non vede niente che l'intera non veda.
    const innocui = ['{"text": "x", "titolo": "y", "fine": 1}', "[{ text: 'x', autore: 'y' }]", 'text,titolo\nx,y\n'];
    for (const testo of innocui) {
      assert.equal(motivoCopiaTesto(testo), '');
      for (let n = 0; n < testo.length; n++) assert.equal(motivoCopiaTesto(testo.slice(0, n)), '', `${testo.slice(0, n)}`);
    }
  });

  test('il formato del file non conta: UTF-16 di PowerShell, estensioni qualunque, un .md', () => {
    const stampa = inspect(FB);
    const utf16 = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(stampa, 'utf16le')]);
    for (const [f, byte] of [['scripts/fb-console.txt', utf16], ['fb.log', Buffer.from(stampa)], ['note/fb.md', Buffer.from(`# feedback\n\n${stampa}`)],
      ['scripts/fb-campi', Buffer.from(FORME['i campi dei documenti nel formato del server'])]]) {
      assert.notEqual(motivoContenuto(f, byte), '', `${f}: è una copia`);
    }
    assert.equal(motivoContenuto('tests/fixtures/fb.txt', Buffer.from(stampa)), '', 'i dati finti delle prove stanno lì');
    assert.equal(motivoContenuto('img.png', Buffer.from([0x89, 0x50, 0x4E, 0x47, 0, 0, 0, 0x0D, ...Buffer.from(stampa)])), '', 'un file binario non si legge');
    // Il codice del repo scrive feedback finti come oggetti JS: lì conta solo un file che è tutto un JSON.
    assert.equal(motivoContenuto('tests/x.spec.mjs', Buffer.from(`const FB = ${inspect(FB)};\n`)), '');
    assert.notEqual(motivoContenuto('dump.js', Buffer.from(JSON.stringify(FB))), '');
  });

  test('quello che copia non è resta fuori, in ogni forma', () => {
    const non = {
      'prosa sui campi': 'I campi di un feedback sono text, clientId e userAgent: il testo e chi l\'ha scritto.\n',
      'un elenco di nomi di campo': 'text, clientId, userAgent\n\nPoi, a parte, il resto: una frase, con virgole.\n',
      'intestazione CSV senza righe': 'id,text,clientId,userAgent\n',
      'tabella che descrive i campi': '| campo | cosa |\n|---|---|\n| text | il testo |\n| clientId | chi scrive |\n| userAgent | il browser |\n',
      'una richiesta di curl': '> GET /v1/x HTTP/2\n> User-Agent: curl/8.4.0\n> Accept: */*\n< HTTP/2 200\n< content-type: application/json\n\n{"ok": true, "n": 3}\n',
      'la stampa di node di una configurazione': inspect({ name: 'filo', scripts: { test: 'node --test' }, text: 'ciao' }),
      'uno schema stampato da node': inspect({ text: { type: 'string' }, clientId: { type: 'string' } }),
      'righe chiave: valore senza chi scrive': 'text: il tasto non va\ntitolo: tasto\n',
      'un elenco di Python di numeri': '[1, 2, 3, (4, 5)]',
      'testo italiano con apostrofi e parentesi': "L'utente [vedi nota] ha scritto {qualcosa}: l'ho letto (due volte) e clientId non c'era.\n",
      'un documento qualunque col nome': inspect({ name: 'modulo', fields: ['a', 'b'] }),
      'console.table senza chi scrive': tabellaDiNode([{ text: 'il tasto', titolo: 'tasto' }, { text: 'grazie', titolo: 'ok' }]),
      'colonne allineate senza righe': '       id   text   clientId\n',
    };
    for (const [caso, testo] of Object.entries(non)) assert.equal(motivoCopiaTesto(testo), '', `${caso}: non è una copia\n${testo}`);
    // Mille parentesi aperte in fila non fanno saltare il controllo (che senza esito lascerebbe passare tutto).
    assert.notEqual(motivoCopiaTesto(`${'['.repeat(100000)}${JSON.stringify(FB)}`), '');
  });

  // I passi della segnalazione: la stampa di node rediretta in un file, i campi salvati come JSON, e il salvataggio dopo.
  test('il salvataggio non spedisce la stampa di node né i soli campi nel formato del server; il resto parte', () => {
    const { origin, work } = scene();
    gitScena(work, ['checkout', '-q', '-b', 'claude/prova']);
    mkdirSync(join(work, 'scripts', 'lib'), { recursive: true });
    for (const f of ['scripts/copie-in-scena.mjs', 'scripts/lib/copie-di-dati.mjs']) copyFileSync(join(ROOT, f), join(work, f));
    writeFileSync(join(work, 'scripts', 'fb-console.txt'), `${inspect(FB)}\n`);
    writeFileSync(join(work, 'scripts', 'fb-campi.json'), FORME['i campi dei documenti nel formato del server']);
    writeFileSync(join(work, 'note.md'), `# appunti\n\n${FORME['un CSV con testo, identificativo e user agent']}\n`);
    writeFileSync(join(work, 'README.md'), 'lavoro\n');
    const r = runHookRaw(work, stdinEdit(join(work, 'README.md')), { FILO_ROUTINE: '1' });
    assert.equal(r.status, 0);
    const su = gitScena(origin, ['ls-tree', '-r', '--name-only', 'claude/prova']).split('\n');
    assert.ok(su.includes('README.md') && su.includes('scripts/copie-in-scena.mjs'), `il resto del lavoro parte: ${su}`);
    for (const f of ['scripts/fb-console.txt', 'scripts/fb-campi.json', 'note.md']) assert.ok(!su.includes(f), `${f} è arrivato su origin: ${su}`);
    assert.match(r.stdout, /fb-console\.txt/, 'la sessione sa cosa non è partito');
  });

  test('col controllo di git una copia in un .md o in un .txt non parte nemmeno con un push a mano', () => {
    const s = scene();
    gitScena(s.work, ['checkout', '-q', '-b', 'claude/prova']);
    mkdirSync(join(s.work, 'scripts', 'lib'), { recursive: true });
    for (const f of ['scripts/copie-in-scena.mjs', 'scripts/lib/copie-di-dati.mjs']) copyFileSync(join(ROOT, f), join(s.work, f));
    gitScena(s.work, ['add', '-A']);
    gitScena(s.work, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'strumenti']);
    assert.equal(installaControlloSpedizione(s.work), 'installato');
    for (const [f, testo] of [['fb.md', `# copia\n\n${inspect(FB)}\n`], ['scripts/fb-console.txt', py(FB)]]) {
      writeFileSync(join(s.work, f), testo);
      gitScena(s.work, ['add', '-A']);
      gitScena(s.work, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'copia']);
      assert.throws(() => gitScena(s.work, ['push', '-q', 'origin', 'claude/prova']), /copia dei dati del server/, f);
      gitScena(s.work, ['reset', '-q', '--hard', 'HEAD~1']);
    }
  });
});
