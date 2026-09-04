// I rossi VERI contro i rossi NOTI (scripts/suite-reds.mjs).
//
// La suite completa gira su GitHub Actions e il suo verbale lo legge una
// macchina, non un modello: qui si sorveglia proprio quella lettura, perché è
// l'unico punto in cui "rosso" diventa "regressione" oppure "si sapeva".
//
// Le due cose che non devono mai succedere, e che hanno un test ciascuna:
//   1. un rosso vero scusato da una voce che non lo riguarda (file giusto ma
//      test sbagliato, oppure una scusa d'ambiente usata nell'altro ambiente);
//   2. un verbale vuoto, o assente, che passa per verde — "zero test eseguiti"
//      è il modo classico in cui un cancello smette di essere un cancello;
//   3. una suite che NON HA ESEGUITO quello che doveva e che, non avendo
//      fallimenti da mostrare, esce verde: una fetta morta, uno spec che non
//      compila, spec cancellati. Sono quattro strade per lo stesso punto e qui
//      hanno un test ciascuna.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  normalizzaFile, normalizzaTitolo, speccFalliti, testEseguiti, leggiNoti, scusaPer,
  classifica, riassunto, riga, parseArgs, espandiVerbali, ambienteCopre,
  erroriFuoriTest, leggiAttesi, verde, primaRiga,
} = await import('../../scripts/suite-reds.mjs');

// Un verbale Playwright ridotto all'osso: la forma è quella vera (suites
// annidate, `tests[].status`), i contenuti no.
function verbale(specs) {
  return {
    suites: [{
      title: 'tests',
      file: '',
      specs: [],
      suites: specs.map((s) => ({
        title: s.file,
        file: s.file,
        specs: [{
          title: s.titolo,
          file: s.file,
          tests: [{
            status: s.stato,
            results: s.errore ? [{ error: { message: s.errore } }] : [],
          }],
        }],
        suites: [],
      })),
    }],
  };
}

test('normalizzaFile: le due forme dello stesso spec si incontrano', () => {
  // Il verbale scrive `a.spec.mjs`, chi compila la lista a mano scrive
  // `tests/a.spec.mjs`: se non si incontrano, la voce non scusa niente.
  assert.equal(normalizzaFile('tests\\a.spec.mjs'), 'a.spec.mjs');
  assert.equal(normalizzaFile('./tests/a.spec.mjs'), 'a.spec.mjs');
  assert.equal(normalizzaFile('  a.spec.mjs '), 'a.spec.mjs');
  assert.equal(normalizzaFile(null), '');
});

test('falliti = solo `unexpected`: un flaky è passato, uno skipped non è mai partito', () => {
  const v = verbale([
    { file: 'a.spec.mjs', titolo: 'rotto', stato: 'unexpected' },
    { file: 'b.spec.mjs', titolo: 'ballerino', stato: 'flaky' },
    { file: 'c.spec.mjs', titolo: 'saltato', stato: 'skipped' },
    { file: 'd.spec.mjs', titolo: 'a posto', stato: 'expected' },
  ]);
  assert.deepEqual(speccFalliti(v), [{ file: 'a.spec.mjs', titolo: 'rotto', messaggio: '' }]);
  // I due retry servono ad assorbire i blip: contarli come rossi rimetterebbe
  // in circolo il falso "ramo principale rotto" che i retry sono venuti a
  // togliere.
  assert.equal(testEseguiti(v), 3); // lo skipped non conta come eseguito
});

test('una scusa per file copre tutto il file; una scusa per test copre solo quel test', () => {
  const noti = leggiNoti({
    spec: [
      { file: 'tests/schermo.spec.mjs', perche: 'schermo intero' },
      { file: 'tests/misto.spec.mjs', titolo: 'cattura dello schermo', perche: 'niente schermo vero' },
    ],
  });
  // La voce è scritta `tests/schermo.spec.mjs`, il verbale dice
  // `schermo.spec.mjs`: devono combaciare comunque.
  assert.ok(scusaPer({ file: 'schermo.spec.mjs', titolo: 'qualunque' }, noti, 'cloud'));
  assert.ok(scusaPer({ file: 'misto.spec.mjs', titolo: 'cattura dello schermo' }, noti, 'cloud'));
  // ⚠️ il caso che conta: stesso file, ALTRO test → nessuna scusa. Scusare il
  // file intero nasconderebbe le regressioni degli altri suoi test.
  assert.equal(scusaPer({ file: 'misto.spec.mjs', titolo: 'tutt’altro' }, noti, 'cloud'), null);
});

test('il runner di Actions eredita i rossi di «cloud», ma non viceversa', () => {
  // Il runner è anche lui una macchina senza schermo: i rossi dello schermo
  // valgono anche lì. Il contrario no — ci sono spec rosse SOLO sul runner
  // (più lento della macchina delle routine), e scusarle ovunque spegnerebbe
  // la suite in un posto dove invece funziona.
  assert.ok(ambienteCopre('cloud', 'actions'));
  assert.ok(!ambienteCopre('actions', 'cloud'));
  assert.ok(!ambienteCopre('actions', 'locale'));
  assert.ok(ambienteCopre('ovunque', 'locale'));
  assert.ok(!ambienteCopre('cloud', 'locale'));
});

test('«tranne» toglie un ambiente alla scusa, e la toglie anche dalle voci scadute', () => {
  // La cattura dello schermo è nera sulla macchina delle routine e vera sul
  // runner: la scusa vale sul cloud, tranne lì. Senza il ritaglio il cancello
  // resterebbe cieco proprio dove la suite gira davvero.
  assert.ok(ambienteCopre('cloud', 'cloud', 'actions'));
  assert.ok(!ambienteCopre('cloud', 'actions', 'actions'));
  // Un ritaglio che nomina un ambiente che non c'entra non cambia niente.
  assert.ok(ambienteCopre('cloud', 'actions', 'locale'));

  const noti = leggiNoti({
    spec: [{
      file: 'tests/cattura.spec.mjs', dove: 'cloud', tranne: 'actions', perche: 'schermata nera',
    }],
  });
  assert.ok(scusaPer({ file: 'cattura.spec.mjs', titolo: 'x' }, noti, 'cloud'));
  assert.equal(scusaPer({ file: 'cattura.spec.mjs', titolo: 'x' }, noti, 'actions'), null);

  // E su Actions la voce non deve nemmeno comparire fra le "scadute": lì non
  // scusa niente per scelta, non perché lo spec sia guarito. Una spia che
  // ripropone la stessa voce a ogni corsa smette di essere guardata.
  const vuoto = { suites: [{ title: 'tests', file: '', specs: [], suites: [] }] };
  assert.deepEqual(classifica([vuoto], noti, 'actions').scaduti, []);
  assert.deepEqual(classifica([vuoto], noti, 'cloud').scaduti, noti);
});

test('una scusa d’ambiente vale solo nel suo ambiente', () => {
  const noti = leggiNoti({
    spec: [
      { file: 'tests/cloud.spec.mjs', dove: 'cloud', perche: 'finestra nascosta' },
      { file: 'tests/locale.spec.mjs', dove: 'locale', perche: 'percorso di Windows' },
      { file: 'tests/sempre.spec.mjs', dove: 'ovunque', perche: 'sito esterno' },
    ],
  });
  assert.ok(scusaPer({ file: 'cloud.spec.mjs', titolo: 'x' }, noti, 'cloud'));
  assert.equal(scusaPer({ file: 'cloud.spec.mjs', titolo: 'x' }, noti, 'locale'), null);
  assert.equal(scusaPer({ file: 'locale.spec.mjs', titolo: 'x' }, noti, 'cloud'), null);
  assert.ok(scusaPer({ file: 'sempre.spec.mjs', titolo: 'x' }, noti, 'locale'));
});

test('classifica: i rossi veri restano, i noti no, e le scuse inutili si dichiarano', () => {
  const v = verbale([
    { file: 'nuovo.spec.mjs', titolo: 'regressione', stato: 'unexpected' },
    { file: 'noto.spec.mjs', titolo: 'schermo intero', stato: 'unexpected' },
    { file: 'guarito.spec.mjs', titolo: 'una volta rosso', stato: 'expected' },
  ]);
  const noti = leggiNoti({
    spec: [
      { file: 'tests/noto.spec.mjs', perche: 'niente schermo vero' },
      { file: 'tests/guarito.spec.mjs', perche: 'non serve più' },
    ],
  });
  const esito = classifica(v, noti, 'cloud');
  assert.deepEqual(esito.rossi.map(riga), ['nuovo.spec.mjs › regressione']);
  assert.equal(esito.scusati.length, 1);
  assert.deepEqual(esito.scaduti.map((n) => n.file), ['guarito.spec.mjs']);
});

test('più verbali (le fette parallele) si sommano: una fetta verde non basta', () => {
  const fetta1 = verbale([{ file: 'a.spec.mjs', titolo: 'ok', stato: 'expected' }]);
  const fetta2 = verbale([{ file: 'b.spec.mjs', titolo: 'rotto', stato: 'unexpected' }]);
  const esito = classifica([fetta1, fetta2], [], 'cloud');
  assert.equal(esito.eseguiti, 2);
  assert.deepEqual(esito.rossi.map((f) => f.file), ['b.spec.mjs']);
});

test('il riassunto di una suite rossa contiene gli spec da rilanciare', () => {
  const esito = classifica(
    verbale([{ file: 'rotto.spec.mjs', titolo: 'la cosa chiesta', stato: 'unexpected' }]),
    [], 'cloud',
  );
  const testo = riassunto(esito);
  assert.match(testo, /ROSSA/);
  assert.match(testo, /rotto\.spec\.mjs › la cosa chiesta/);
});

test('il riassunto di una suite verde dice quanti test sono stati eseguiti', () => {
  const esito = classifica(verbale([{ file: 'a.spec.mjs', titolo: 'ok', stato: 'expected' }]), [], 'cloud');
  const testo = riassunto(esito);
  assert.match(testo, /verde/i);
  assert.match(testo, /1 test eseguiti/);
});

test('un verbale senza nemmeno un test non è un verde: zero eseguiti si vede', () => {
  const esito = classifica({ suites: [] }, [], 'cloud');
  assert.equal(esito.eseguiti, 0);
  assert.equal(esito.rossi.length, 0);
  // È il CLI a trasformarlo in un rosso; qui si asserisce che il conto lo dica.
});

// ─── la suite che non ha eseguito quello che doveva ──────────────────────────
//
// Quattro strade, un solo punto d'arrivo: un verdetto verde con dei test mai
// partiti. Chiuderne una per volta è costato un giro ciascuna, quindi qui
// stanno insieme.

test('uno spec che non compila fa morire la fetta e NON lascia fallimenti: è rosso lo stesso', () => {
  // Il caso più comune, e il più insidioso: un import sbagliato. Playwright
  // abbandona la fetta, scrive l'errore in `errors` — fuori dall'elenco dei
  // test — e consegna un verbale con zero test falliti.
  const persa = {
    ...verbale([]),
    errors: [{ message: "Error: Cannot find module './fixtures/electron.mjs'", location: { file: 'tests/rotto.spec.mjs' } }],
  };
  const sana = verbale([{ file: 'a.spec.mjs', titolo: 'ok', stato: 'expected' }]);

  assert.equal(erroriFuoriTest(persa).length, 1);
  assert.equal(erroriFuoriTest(persa)[0].file, 'rotto.spec.mjs');

  const esito = classifica([{ nome: 'verbale-1.json', dati: sana }, { nome: 'verbale-2.json', dati: persa }], [], 'actions');
  assert.equal(esito.rossi.length, 0, 'nessun test è fallito: è proprio questo il punto');
  assert.equal(verde(esito), false, 'una fetta abbandonata non è un verde');
  assert.match(riassunto(esito), /Cannot find module/);
});

test('un guasto del worker DOPO i test si dice, ma non tinge di rosso una corsa sana', () => {
  // La differenza è il file. Un errore che nomina uno spec vuol dire che quello
  // spec non è partito: rosso. Uno senza file arriva dallo smontaggio del
  // worker, dopo che i test sono girati, e compare proprio nelle fette che
  // avevano dei rossi NOTI (ritentativi, tracce salvate): contarlo come rosso
  // vorrebbe dire che un rosso scusato apposta riesce comunque a bloccare la
  // fusione, per una via traversa.
  const v = {
    ...verbale([{ file: 'a.spec.mjs', titolo: 'ok', stato: 'expected' }]),
    errors: [{ message: 'Worker teardown timeout of 180000ms exceeded.' }],
  };
  const esito = classifica([{ nome: 'verbale-1.json', dati: v }], [], 'actions');
  assert.equal(esito.errori.length, 0);
  assert.equal(esito.avvisi.length, 1);
  assert.equal(verde(esito), true);
  assert.match(riassunto(esito), /Guasti del worker dopo i test/);
});

test('una fetta che esegue zero test mentre le altre girano non è un verde', () => {
  // Il controllo "zero eseguiti" scritto sulla somma non scattava mai: bastava
  // una fetta viva. Va per fetta.
  const viva = verbale([{ file: 'a.spec.mjs', titolo: 'ok', stato: 'expected' }]);
  const morta = verbale([]);
  const esito = classifica(
    [{ nome: 'verbale-1.json', dati: viva }, { nome: 'verbale-2.json', dati: morta }],
    [], 'actions',
  );
  assert.equal(esito.eseguiti, 1);
  assert.deepEqual(esito.vuote, ['verbale-2.json']);
  assert.equal(verde(esito), false);
  assert.match(riassunto(esito), /NEMMENO UN TEST/);
});

test('se il conto dei test crolla sotto il minimo atteso, non è un verde', () => {
  // Spec cancellati, rinominati, o un filtro che non li prende più: nessuno di
  // questi fa fallire un test. Si vedono solo così.
  const v = verbale([
    { file: 'a.spec.mjs', titolo: 'uno', stato: 'expected' },
    { file: 'b.spec.mjs', titolo: 'due', stato: 'expected' },
  ]);
  const crollato = classifica(v, [], 'actions', { minimo: 1400 });
  assert.equal(crollato.rossi.length, 0);
  assert.equal(verde(crollato), false);
  assert.match(riassunto(crollato), /2, contro i 1400 attesi/);

  // Senza un numero atteso il confronto non si fa: una corsa parziale non
  // pretende di essere la suite intera.
  assert.equal(verde(classifica(v, [], 'actions', { minimo: 0 })), true);
});

test('leggiAttesi: il numero è per ambiente, e un ambiente senza numero non si confronta', () => {
  const dati = { attesi: { actions: 1365, locale: 1400 } };
  assert.equal(leggiAttesi(dati, 'actions'), 1365);
  assert.equal(leggiAttesi(dati, 'cloud'), 0);
  assert.equal(leggiAttesi({}, 'actions'), 0);
  assert.equal(leggiAttesi({ attesi: { actions: 'molti' } }, 'actions'), 0);
});

test('il riassunto di uno spec rotto porta anche il PERCHÉ, non solo il nome', () => {
  // Chi corregge riceve questo testo e nient'altro: senza il messaggio deve
  // andare a rileggersi i log della corsa, che è mezzo giro buttato.
  const esito = classifica(verbale([
    { file: 'rotto.spec.mjs', titolo: 'la cosa chiesta', stato: 'unexpected', errore: '[31mError: expect(received).toBe(expected)[39m\n\nExpected: true' },
  ]), [], 'cloud');
  const testo = riassunto(esito);
  assert.match(testo, /Error: expect\(received\)\.toBe\(expected\)/);
  assert.ok(!testo.includes('['), 'i colori del terminale non vanno in un testo che legge una persona');
});

test('primaRiga: una riga sola, senza colori, e non lunga come un romanzo', () => {
  assert.equal(primaRiga('\n\n  [31mrotto[39m\nseconda riga'), 'rotto');
  assert.equal(primaRiga('x'.repeat(500)).length, 200);
  assert.equal(primaRiga(null), '');
});

test('normalizzaTitolo: uno spazio di troppo non deve rendere una voce inutile', () => {
  // La voce si scrive a mano copiando dal terminale: il file veniva ripulito, il
  // titolo no, e una voce con uno spazio davanti non scusava niente pur
  // sembrando a posto.
  const noti = leggiNoti({ spec: [{ file: 'tests/x.spec.mjs', titolo: '  il  titolo esatto ', perche: 'schermo' }] });
  assert.ok(scusaPer({ file: 'x.spec.mjs', titolo: 'il titolo esatto' }, noti, 'cloud'));
  assert.equal(normalizzaTitolo(null), '');
});

test('nel workflow le fette dichiarate, quelle eseguite e quelle pretese sono lo stesso numero', async () => {
  // Tre posti dicono quante sono le fette: la matrice dei lavori, il
  // `--shard=i/N` di Playwright e il `--fette N` del conto. Se divergono, la
  // suite gira per una frazione e nessuno se ne accorge: con un `--fette` più
  // basso il conto è contento con meno verbali di quelli attesi, con uno più
  // alto ogni corsa è "incompleta" e il cancello resta rosso per sempre.
  const { readFileSync } = await import('node:fs');
  const { resolve, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const radice = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const yml = readFileSync(resolve(radice, '.github', 'workflows', 'suite.yml'), 'utf8');

  const matrice = yml.match(/fetta:\s*\[([^\]]+)\]/);
  assert.ok(matrice, 'la matrice delle fette deve esistere');
  const quante = matrice[1].split(',').filter((s) => s.trim()).length;

  const shard = yml.match(/--shard=\$\{\{\s*matrix\.fetta\s*\}\}\/(\d+)/);
  assert.ok(shard, 'il comando di Playwright deve dividere in fette');
  assert.equal(Number(shard[1]), quante, 'Playwright divide in un numero di fette diverso da quelle avviate');

  const fette = yml.match(/--fette\s+(\d+)/);
  assert.ok(fette, 'il conto deve pretendere un numero preciso di verbali');
  assert.equal(Number(fette[1]), quante, 'il conto pretende un numero di verbali diverso dalle fette avviate');
});

test('il numero minimo di test attesi esiste ed è un numero serio', async () => {
  // Una sentinella contro il modo silenzioso di spegnere il controllo: mettere
  // zero, o togliere la voce dell'ambiente in cui la suite gira davvero.
  const { readFileSync } = await import('node:fs');
  const { resolve, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const radice = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const dati = JSON.parse(readFileSync(resolve(radice, '.github', 'workflows', 'suite-attesi.json'), 'utf8'));
  assert.ok(leggiAttesi(dati, 'actions') > 1000, 'la suite di Filo è di più di mille test: un numero più basso è una svista o una resa');
});

test('espandiVerbali: una cartella vale tutti i .json che contiene', () => {
  const finti = {
    esisteFn: (p) => !p.endsWith('assente.json'),
    isDirFn: (p) => p.endsWith('verbali'),
    elencaFn: () => ['verbale-2.json', 'verbale-1.json', 'note.txt'],
  };
  const fuori = espandiVerbali(['verbali', 'assente.json'], finti);
  assert.equal(fuori.length, 2);
  assert.ok(fuori[0].endsWith('verbale-1.json'));
  assert.ok(fuori[1].endsWith('verbale-2.json'));
});

test('parseArgs: più verbali posizionali, opzioni sconosciute raccolte', () => {
  const a = parseArgs(['uno.json', 'due.json', '--noti', 'lista.json', '--json-out', 'out.json']);
  assert.deepEqual(a.verbali, ['uno.json', 'due.json']);
  assert.equal(a.noti, 'lista.json');
  assert.equal(a.jsonOut, 'out.json');
  assert.deepEqual(parseArgs(['--boh']).unknown, ['--boh']);
});

test('--proponi: le voci escono già col file e col TITOLO esatto del test', async () => {
  const { proponiVoci } = await import('../../scripts/suite-reds.mjs');
  const voci = proponiVoci([{ file: 'x.spec.mjs', titolo: 'cattura dello schermo' }], 'cloud');
  assert.equal(voci.length, 1);
  assert.equal(voci[0].file, 'x.spec.mjs');
  assert.equal(voci[0].titolo, 'cattura dello schermo');
  assert.equal(voci[0].dove, 'cloud');
  // Il motivo NON si propone: è l'unica parte che deve scrivere una persona.
  assert.match(voci[0].perche, /DA SCRIVERE/);
});

// ─── il CLI: le vie in cui un "verde" sarebbe una bugia ───────────────────────

test('una fetta che non consegna il suo verbale NON è un verde', async () => {
  const { spawnSync } = await import('node:child_process');
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, resolve, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'suite-reds.mjs');

  const dir = mkdtempSync(join(tmpdir(), 'filo-fette-'));
  try {
    // Una sola fetta, tutta verde. Da sola sarebbe un verde perfetto.
    writeFileSync(join(dir, 'verbale-1.json'), JSON.stringify(verbale([
      { file: 'a.spec.mjs', titolo: 'ok', stato: 'expected' },
    ])));
    const parziale = spawnSync(process.execPath, [CLI, dir, '--fette', '6'], { encoding: 'utf8' });
    assert.equal(parziale.status, 1, `cinque sesti di suite non eseguiti non sono un verde (${parziale.stdout} ${parziale.stderr})`);
    assert.match(parziale.stderr, /1 verbali su 6/);

    // Senza `--fette` lo stesso comando è verde: è la richiesta esplicita di
    // completezza a fare la differenza, non un caso particolare del contenuto.
    const senza = spawnSync(process.execPath, [CLI, dir], { encoding: 'utf8' });
    assert.equal(senza.status, 0, `${senza.stdout} ${senza.stderr}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('verbale con zero test: il CLI esce rosso, non verde', async () => {
  const { spawnSync } = await import('node:child_process');
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, resolve, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'suite-reds.mjs');

  const dir = mkdtempSync(join(tmpdir(), 'filo-vuoto-'));
  try {
    writeFileSync(join(dir, 'verbale-1.json'), JSON.stringify({ suites: [] }));
    const r = spawnSync(process.execPath, [CLI, dir], { encoding: 'utf8' });
    assert.equal(r.status, 1, `zero test eseguiti non è "tutto a posto" (${r.stdout} ${r.stderr})`);
    assert.match(r.stderr, /zero test/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
