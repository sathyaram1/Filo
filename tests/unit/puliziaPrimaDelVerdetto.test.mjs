// #1555: la pulizia che non dipende dall'esito si fa PRIMA del verdetto, nel commit della critica: un commit in meno da far
// quadrare ai cancelli dopo il verdetto. Il perché intero: routines/roles/_critica-e-livelli.md.

import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import {
  esceInOgniEsito, fermaDiSicuro, proveDaToglierePrimaDelVerdetto, proveScritteDa, testoProvePrimaDelVerdetto, titoliDeiCasi,
} from '../../scripts/lib/prove-tolte.mjs';
import { verifierReplyText } from '../../scripts/dispatch.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('escono in ogni esito gli esterni e i `?` che contano al più 1; gli altri dipendono dai bilanci', () => {
  assert.equal(esceInOgniEsito({ level: 3, sede: 'e' }), true);
  assert.equal(esceInOgniEsito({ level: 1, sede: 'i', decision: true }), true);
  assert.equal(esceInOgniEsito({ level: 3, sede: 'v', decision: true }), true, 'un vicino col ? esce sempre');
  assert.equal(esceInOgniEsito({ level: 2, sede: 'i', decision: true }), false, 'un 2 col ? si corregge con la consigliata: la prova resta');
  assert.equal(esceInOgniEsito({ level: 1, sede: 'i' }), false, 'un 1 si corregge o esce secondo il bilancio');
  assert.equal(esceInOgniEsito({ level: 0, sede: 'v' }), false);
});

test('fra le prove scritte escono intere quelle coi soli numeri di rilievi che escono comunque; a una mista si toglie il caso e il numero', () => {
  const findings = [{ level: 2, sede: 'i' }, { level: 1, sede: 'e' }, { level: 0, sede: 'i', decision: true }];
  const fuori = proveDaToglierePrimaDelVerdetto([
    'tests/verifica/42/giro1-r1-salva.spec.mjs',
    'tests/verifica/42/giro1-r2-esterno.spec.mjs',
    'tests/verifica/42/giro1-r1-r2-misto.spec.mjs',
    'tests/verifica/42/giro1-r3-domanda.spec.mjs',
    'tests/verifica/42/giro1-chiusa.spec.mjs',
    'tests/verifica/42/aiuto.mjs',
  ], findings);
  assert.deepEqual(fuori.map((f) => [f.prova, f.intera]), [
    ['tests/verifica/42/giro1-r2-esterno.spec.mjs', true],
    ['tests/verifica/42/giro1-r1-r2-misto.spec.mjs', false],
    ['tests/verifica/42/giro1-r3-domanda.spec.mjs', true],
  ]);
  const misto = fuori[1];
  assert.deepEqual(misto.numeri, [2]);
  assert.deepEqual(misto.restano, [1]);
  assert.equal(misto.rinomina, 'tests/verifica/42/giro1-r1-misto.spec.mjs');
  const testo = testoProvePrimaDelVerdetto(fuori, findings);
  assert.match(testo, /giro1-r1-r2-misto\.spec\.mjs: il rilievo 2 è esterno; copre anche r1, che resta: togli il caso di r2 e il numero dal nome \(`git mv tests\/verifica\/42\/giro1-r1-r2-misto\.spec\.mjs tests\/verifica\/42\/giro1-r1-misto\.spec\.mjs`\)/);
  assert.match(testo, /giro1-r2-esterno\.spec\.mjs: il rilievo 2 è esterno; toglila/);
});

test('rinominata senza il numero, una prova che ha ancora il caso di un rilievo che esce non passa; tolto il caso, passa', () => {
  const findings = [{ level: 2, sede: 'i' }, { level: 1, sede: 'e' }];
  const prova = 'tests/verifica/42/giro1-r1-misto.spec.mjs';
  const conCaso = "test('r1 col titolo vuoto non salva', () => {});\ntest(\"r2 il menu delle schede si chiude\", () => {});\n";
  const fuori = proveDaToglierePrimaDelVerdetto([prova], findings, { [prova]: conCaso });
  assert.deepEqual(fuori.map((f) => [f.prova, f.casi]), [[prova, ['r2 il menu delle schede si chiude']]]);
  assert.match(testoProvePrimaDelVerdetto(fuori, findings), /giro1-r1-misto\.spec\.mjs: il rilievo 2 è esterno; togli il caso «r2 il menu delle schede si chiude»/);
  assert.deepEqual(proveDaToglierePrimaDelVerdetto([prova], findings, { [prova]: "test('r1 col titolo vuoto non salva', () => {});\n" }), []);
  // Un caso che cita anche un rilievo che resta, resta; un titolo composto a runtime non si legge.
  assert.deepEqual(proveDaToglierePrimaDelVerdetto([prova], findings, { [prova]: "test.describe('r1 r2 insieme', () => {});\ntest(`r${2} composto`, () => {});\n" }), []);
});

test('i titoli dei casi si leggono anche da describe, fail e template, non da un nome che finisce per «it»', () => {
  assert.deepEqual(titoliDeiCasi("test.describe('r1 gruppo', () => {\n  test.fail(`r2 atteso`, async () => {});\n  edit('r3 no');\n  it(\"r4 sì\", () => {});\n});"),
    ['r1 gruppo', 'r2 atteso', 'r4 sì']);
});

test('#1202.2 la fermata la decidono livello e segno, mai la domanda: un 2 col ?! ferma e il `?` di livello 1 resta con la sua prova', () => {
  for (const domanda of [{ titolo: 'Colore' }, { titolo: 'Colore', blocca: true }, { titolo: 'Colore', blocca: false }]) {
    const findings = [{ level: 2, sede: 'i', decision: true, irreversibile: true, domanda }, { level: 1, sede: 'i', decision: true, domanda }];
    assert.equal(fermaDiSicuro(findings), true, JSON.stringify(domanda));
    assert.deepEqual(proveDaToglierePrimaDelVerdetto(['tests/verifica/42/giro1-r2-bordo.spec.mjs'], findings), []);
  }
  // Un 2 col ? senza «!» non ferma: la prova dell'1 col ? esce, e il rifiuto non parla di domande che non bloccano.
  const findings = [{ level: 2, sede: 'i', decision: true }, { level: 1, sede: 'i', decision: true }];
  const fuori = proveDaToglierePrimaDelVerdetto(['tests/verifica/42/giro1-r1-riquadro.spec.mjs', 'tests/verifica/42/giro1-r2-bordo.spec.mjs'], findings);
  assert.deepEqual(fuori.map((f) => f.prova), ['tests/verifica/42/giro1-r2-bordo.spec.mjs']);
  assert.doesNotMatch(testoProvePrimaDelVerdetto(fuori, findings), /non blocca/);
});

test('a lavoro fermo di sicuro i `?` restano a chi riprende con la loro prova: escono prima solo gli esterni', () => {
  const require = createRequire(import.meta.url);
  require('../../src/shared/feedbackTransitions.js');
  require('../../src/shared/verifierRound.js');
  const V = globalThis.SN_VERIFIER_ROUND;
  const caps = { cap3: 10, cap2: 10, cap1: 1, cap0: 0 };
  for (const critica of [
    'Provato.\n[2i?!] I dati salvati cambiano forma?\n[1i?] Il bordo è grigio?\n[1e] Fuori.',
    'Provato.\n[3i?] I dati escono?\n[2v?] Il titolo accanto è tagliato?\n[1e] Fuori.',
  ]) {
    const { findings } = V.parseFindings(critica);
    const esito = V.decideRound({ findings, caps, counts: {} });
    assert.equal(esito.stop, true);
    assert.equal(esito.sospesi.length, 1, 'il secondo rilievo resta al lavoro');
    const fuori = proveDaToglierePrimaDelVerdetto(['tests/verifica/42/giro1-r2-sospeso.spec.mjs', 'tests/verifica/42/giro1-r3-esterno.spec.mjs'], findings);
    assert.deepEqual(fuori.map((f) => f.prova), ['tests/verifica/42/giro1-r3-esterno.spec.mjs'], critica);
  }
});

test('la pulizia prima del verdetto decide la fermata con la stessa regola del giro', () => {
  const require = createRequire(import.meta.url);
  require('../../src/shared/verifierRound.js');
  const V = globalThis.SN_VERIFIER_ROUND;
  for (const level of [0, 1, 2, 3]) for (const decision of [false, true]) for (const irreversibile of [false, true]) {
    const f = { level, sede: 'i', decision, irreversibile };
    assert.equal(fermaDiSicuro([f]), V.decisioneFerma(f), JSON.stringify(f));
    assert.equal(fermaDiSicuro([{ ...f, sede: 'e' }]), false);
    assert.equal(fermaDiSicuro([{ ...f, sede: 'v' }]), false);
  }
});

test('un 2 col `?` non ferma (#1202): la prova di un 1 col `?` della stessa critica esce prima del verdetto, la sua resta', () => {
  const require = createRequire(import.meta.url);
  require('../../src/shared/verifierRound.js');
  const V = globalThis.SN_VERIFIER_ROUND;
  const { findings } = V.parseFindings('Provato.\n[2i?] Il riquadro è freddo? Consiglio caldo.\n[1i?] Il bordo è grigio?\n[1e] Fuori.');
  const esito = V.decideRound({ findings, caps: { cap3: 10, cap2: 10, cap1: 1, cap0: 0 }, counts: {} });
  assert.equal(esito.stop, false);
  assert.deepEqual(esito.fix.map((f) => f.level), [2]);
  const fuori = proveDaToglierePrimaDelVerdetto([
    'tests/verifica/42/giro1-r1-riquadro.spec.mjs',
    'tests/verifica/42/giro1-r2-bordo.spec.mjs',
    'tests/verifica/42/giro1-r3-esterno.spec.mjs',
  ], findings);
  assert.deepEqual(fuori.map((f) => f.prova), ['tests/verifica/42/giro1-r2-bordo.spec.mjs', 'tests/verifica/42/giro1-r3-esterno.spec.mjs']);
});

/** Un ramo con un punto fermo all'avvio della verifica e, dopo, le prove della critica (un elenco, o percorso → sorgente). */
function ramoConProve(prove) {
  const sorgenti = Array.isArray(prove) ? Object.fromEntries(prove.map((p) => [p, '// rossa\n'])) : prove;
  const casa = cartellaTemporanea('filo-pulizia-prima-');
  const g = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: casa, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const scrivi = (f, t) => { mkdirSync(dirname(resolve(casa, f)), { recursive: true }); writeFileSync(resolve(casa, f), t, 'utf8'); };
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  scrivi('.gitignore', 'stato/\n.claude/\n');
  scrivi('tests/verifica/901/giro1-r1-vecchia.spec.mjs', '// di un giro passato\n');
  g('add', '-A'); g('commit', '-qm', 'init');
  g('checkout', '-q', '-b', 'worker/901');
  const avvio = g('rev-parse', 'HEAD');
  for (const [p, testo] of Object.entries(sorgenti)) scrivi(p, testo);
  if (Object.keys(sorgenti).length) { g('add', '-A'); g('commit', '-qm', 'verifica #901 giro 2: prove'); }
  mkdirSync(resolve(casa, 'stato'), { recursive: true });
  mkdirSync(resolve(casa, 'stato', 'fuori'), { recursive: true });
  writeFileSync(resolve(casa, 'stato', 'fid-901.json'), JSON.stringify({
    id: 'fid-901', branch: 'worker/901', verifierVerdict: null, checkpoints: [{ sha: avvio, by: 'checkout' }],
  }), 'utf8');
  return { casa, avvio, g };
}

test('le prove scritte dalla verifica sono quelle aggiunte o rinominate dopo l\'avvio, non quelle che c\'erano', (t) => {
  const { casa, avvio, g } = ramoConProve(['tests/verifica/901/giro2-r1-nuova.spec.mjs']);
  t.after(() => togliCartella(casa));
  g('mv', 'tests/verifica/901/giro1-r1-vecchia.spec.mjs', 'tests/verifica/901/giro2-r2-rinominata.spec.mjs');
  g('commit', '-qm', 'rinomina');
  assert.deepEqual(proveScritteDa(avvio, casa).sort(), ['tests/verifica/901/giro2-r1-nuova.spec.mjs', 'tests/verifica/901/giro2-r2-rinominata.spec.mjs']);
});

function fintoServer(reply = { outcome: 'pass', derived: [{ level: 1, sede: 'e', text: 'esterno', num: '#901.1' }] }) {
  const ricevuti = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      ricevuti.push({ url: req.url });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, ...(req.url.includes('routineDeliver') ? { reply } : {}) }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, ricevuti, port: srv.address().port })));
}

const esegui = (argv, casa, port) => new Promise((r) => {
  execFile(process.execPath, [resolve(REPO, 'scripts', 'dispatch.mjs'), ...argv], {
    env: {
      ...process.env, FILO_ROUTINE_API: `http://127.0.0.1:${port}`, FILO_REPO_ROOT: casa, FILO_DISPATCH_STATE_DIR: resolve(casa, 'stato'),
      FILO_ROUTINES_ENABLED: '1', FILO_ROUTINE_TICKET: 'biglietto-di-prova', FILO_ROUTINE_ROLE: 'verifier', FILO_NO_BEAT: '1',
    },
  }, (err, so, se) => r({ code: err ? (err.code ?? 1) : 0, out: String(so || '') + String(se || '') }));
});

test('la prova di un esterno ancora nel ramo ferma la critica prima del server; tolta, il pass non chiede altri commit', async (t) => {
  const { casa, g } = ramoConProve(['tests/verifica/901/giro2-r1-esterno.spec.mjs']);
  t.after(() => togliCartella(casa));
  const { srv, ricevuti, port } = await fintoServer();
  t.after(() => srv.close());
  const critica = 'Provato il salvataggio da menu e scorciatoia: regge.\n[1e] Il menu delle schede si chiude da solo, fuori da questo lavoro.';
  const fermo = await esegui(['--record-verifier', 'fid-901', critica], casa, port);
  assert.notEqual(fermo.code, 0);
  assert.match(fermo.out, /giro2-r1-esterno\.spec\.mjs: il rilievo 1 è esterno/);
  assert.ok(!ricevuti.some((x) => x.url.includes('routineDeliver')), 'il verdetto non deve partire su una punta che poi si sposta');

  g('rm', '-q', 'tests/verifica/901/giro2-r1-esterno.spec.mjs'); g('commit', '-qm', 'verifica #901 giro 2: via la prova dell\'esterno');
  const tip = g('rev-parse', 'HEAD');
  const ok = await esegui(['--record-verifier', 'fid-901', critica], casa, port);
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /verifica superata/);
  assert.doesNotMatch(ok.out, /TOGLIERE/, 'nessun commit dopo il verdetto');
  assert.match(ok.out, /il ramo non si tocca più/);
  assert.equal(g('rev-parse', 'HEAD'), tip);
});

const domandaDi = (titolo, blocca) => ({
  titolo, priorita: 'quando_puoi', ...(blocca === undefined ? {} : { blocca }),
  contesto: 'Una scelta di gusto sul riquadro.', problema: 'Va scelto il colore. Scegli tu quale tenere.',
  opzioni: [
    { testo: 'Più caldo', pro: 'Come il resto', contro: 'Un giro in più', azione: { tipo: 'riprendi', feedbackId: 'fid-901' } },
    { testo: 'Com\'è', pro: 'Niente lavoro', contro: 'Resta freddo', azione: { tipo: 'riprendi', feedbackId: 'fid-901' } },
  ],
  consiglio: { opzione: 0, perche: 'Coerente col resto.' },
});

test('#1555.1 con la domanda del 2 col ?! che non blocca, la prova dell\'1 col ? va tolta prima; con quella che blocca resta', async (t) => {
  const prova = 'tests/verifica/901/giro2-r2-bordo.spec.mjs';
  const critica = 'Provato il riquadro in tema chiaro e scuro.\n[2i?!] Il riquadro è freddo: caldo come il resto?\n[1i?] Il bordo è grigio: più caldo?';
  const { srv, ricevuti, port } = await fintoServer({
    outcome: 'fix', domandaProvvisoria: 'D-8',
    phase2: {
      findings: [{ level: 2, sede: 'i', decision: true, irreversibile: true, text: 'Il riquadro è freddo: caldo come il resto?' }],
      derived: [{ level: 1, sede: 'i', decision: true, text: 'Il bordo è grigio: più caldo?', num: '#901.1' }],
    },
  });
  t.after(() => srv.close());

  const { casa, g } = ramoConProve([prova]);
  t.after(() => togliCartella(casa));
  const file = resolve(casa, 'stato', 'fuori', 'domande.json');
  writeFileSync(file, JSON.stringify([domandaDi('Colore del riquadro', false), domandaDi('Colore del bordo', false)]), 'utf8');
  const fermo = await esegui(['--record-verifier', 'fid-901', critica, '--domanda', file], casa, port);
  assert.notEqual(fermo.code, 0, fermo.out);
  assert.match(fermo.out, /giro2-r2-bordo\.spec\.mjs: il rilievo 2 chiede una decisione e conta al più 1; toglila/);
  assert.match(fermo.out, /La domanda del rilievo 1 non blocca/);
  assert.ok(!ricevuti.some((x) => x.url.includes('routineDeliver')));

  g('rm', '-q', prova); g('commit', '-qm', 'verifica #901 giro 2: via la prova del bordo');
  const ok = await esegui(['--record-verifier', 'fid-901', critica, '--domanda', file], casa, port);
  assert.equal(ok.code, 0, ok.out);
  assert.doesNotMatch(ok.out, /le prove con r2 nel nome/, 'la sua prova è già uscita');

  // La stessa critica con la domanda del 2 che blocca ferma il lavoro: l'1 col ? resta a chi riprende, con la prova.
  const altro = ramoConProve([prova]);
  t.after(() => togliCartella(altro.casa));
  const bloccante = resolve(altro.casa, 'stato', 'fuori', 'domande.json');
  writeFileSync(bloccante, JSON.stringify([domandaDi('Colore del riquadro'), domandaDi('Colore del bordo', false)]), 'utf8');
  const prima = ricevuti.length;
  const resta = await esegui(['--record-verifier', 'fid-901', critica, '--domanda', bloccante], altro.casa, port);
  assert.doesNotMatch(resta.out, /critica non registrata/, resta.out);
  assert.ok(ricevuti.slice(prima).some((x) => x.url.includes('routineDeliver')), 'la critica arriva al server');
});

test('#1555.1 una prova che copre un interno e un esterno perde prima del verdetto il caso dell\'esterno e il suo numero', async (t) => {
  const misto = 'tests/verifica/901/giro2-r1-r2-misto.spec.mjs';
  const casoInterno = "test('r1 col titolo vuoto il salvataggio non parte', () => { throw new Error('rossa'); });\n";
  const casoEsterno = "test('r2 il menu delle schede si chiude da solo', () => { throw new Error('rossa'); });\n";
  const { casa, g } = ramoConProve({ [misto]: casoInterno + casoEsterno });
  t.after(() => togliCartella(casa));
  const { srv, ricevuti, port } = await fintoServer({
    outcome: 'fix',
    phase2: {
      findings: [{ level: 2, sede: 'i', text: 'Col titolo vuoto il salvataggio non parte.' }],
      derived: [{ level: 1, sede: 'e', text: 'Il menu delle schede si chiude da solo.', num: '#901.1' }],
    },
  });
  t.after(() => srv.close());
  const critica = 'Provato il salvataggio da menu e da scorciatoia, col titolo vuoto e lungo.\n[2i] Col titolo vuoto il salvataggio non parte.\n[1e] Il menu delle schede si chiude da solo.';
  const fermo = await esegui(['--record-verifier', 'fid-901', critica], casa, port);
  assert.notEqual(fermo.code, 0, fermo.out);
  assert.match(fermo.out, /giro2-r1-r2-misto\.spec\.mjs: il rilievo 2 è esterno; copre anche r1, che resta/);
  assert.match(fermo.out, /git mv tests\/verifica\/901\/giro2-r1-r2-misto\.spec\.mjs tests\/verifica\/901\/giro2-r1-misto\.spec\.mjs/);

  // Rinominata ma col caso dell'esterno ancora dentro: non basta.
  const rinominata = 'tests/verifica/901/giro2-r1-misto.spec.mjs';
  g('mv', misto, rinominata); g('commit', '-qm', 'rinomina');
  const ancora = await esegui(['--record-verifier', 'fid-901', critica], casa, port);
  assert.notEqual(ancora.code, 0, ancora.out);
  assert.match(ancora.out, /giro2-r1-misto\.spec\.mjs: il rilievo 2 è esterno; togli il caso «r2 il menu delle schede si chiude da solo»/);
  assert.ok(!ricevuti.some((x) => x.url.includes('routineDeliver')));

  writeFileSync(resolve(casa, rinominata), casoInterno, 'utf8');
  g('add', '-A'); g('commit', '-qm', 'verifica #901 giro 2: via il caso dell\'esterno');
  const ok = await esegui(['--record-verifier', 'fid-901', critica], casa, port);
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /c'è da correggere/);
  assert.doesNotMatch(ok.out, /TOGLIERE/, 'il caso dell\'esterno è già uscito: dopo il verdetto non c\'è niente da togliere');
});

test('dopo un pass si tolgono solo le prove dei rilievi che il bilancio ha messo da parte', () => {
  const testo = verifierReplyText({
    outcome: 'pass',
    derived: [
      { level: 2, sede: 'e', text: 'esterno.', n: 1, num: '#42.1' },
      { level: 1, sede: 'i', text: 'domanda.', decision: true, n: 2, num: '#42.2' },
      { tipo: 'rimasti', num: '#42.3', findings: [{ level: 1, sede: 'i', text: 'rimasto.', n: 3 }] },
    ],
  });
  assert.match(testo, /TOGLIERE/);
  assert.match(testo, /le prove con r3 nel nome/);
  assert.doesNotMatch(testo, /le prove con r[12] nel nome/);
});
