// Le novità del redattore entrano nel registro dell'albero che si pubblica (SPEC-MANUTENTORE § 8): la riscrittura al
// posto delle righe che ha letto, quelle fuse dopo accanto, le versioni vecchie ogni volta; senza server la
// pubblicazione va avanti con le righe dei worker. In fondo, i tre lavori di release.yml che la chiedono (il numero
// entra come variabile, perché quel passo ha la parola della costruzione).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { applicaNovita, chiediNovita, impronta, leggiNote, main } from '../../scripts/release-novita.mjs';

const note = (testo) => (leggiNote(testo) || {}).note;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE = join(ROOT, 'src', 'shared', 'patchNotes.js');
// In cima un blocco della prova, con tre righe: quello di main appena aperto ne ha una o nessuna, e senza righe
// già lette non c'è riscrittura parziale da provare (verifica #1959 giro 6).
const VERO = readFileSync(FILE, 'utf8');
const IN_CIMA = `{\n      version: '99.0.1', date: '2026-11-02',\n      features: ['Prima riga della prova.', { testo: 'Seconda, con la sua segnalazione.', segnalazione: 1956 }],\n      fixes: ['Una correzione della prova.'],\n    },\n    `;
const PRIMO = VERO.indexOf('{', VERO.indexOf('const NOTES = ['));
const SORGENTE = VERO.slice(0, PRIMO) + IN_CIMA + VERO.slice(PRIMO);
const NOTE = note(SORGENTE);
const TOP = NOTE[0];
const VECCHIO = NOTE[5];
const righeDi = (b) => [...(b.features || []), ...(b.fixes || [])];

describe('applicaNovita sul registro vero', () => {
  test('l’impronta è quella che la pagina Novità salva', () => {
    createRequire(import.meta.url)(FILE);
    for (const r of [...righeDi(TOP), ...righeDi(VECCHIO), 'a', '', { testo: 'x', segnalazione: 3 }]) {
      assert.equal(impronta(r), globalThis.SN_PATCH_NOTES.impronta(r));
    }
  });

  test('la riscrittura prende il posto delle righe lette; una riga fusa dopo resta; gli altri blocchi non cambiano', () => {
    const lette = righeDi(TOP).slice(1);
    const tardiva = righeDi(TOP)[0];
    const r = applicaNovita(SORGENTE, [{
      versione: TOP.version,
      features: ['Riga con "virgolette", \\ barra,   e `apici`.', { testo: 'Con la sua segnalazione.', segnalazione: 1956 }],
      fixes: ['Una correzione.'],
      originali: lette.map(impronta),
    }]);
    assert.equal(r.ok, true, r.reason);
    assert.deepEqual(r.applicate, [TOP.version]);
    const dopo = note(r.testo);
    assert.equal(dopo.length, NOTE.length);
    const tardivaIn = TOP.features.includes(tardiva) ? 'features' : 'fixes';
    assert.deepEqual(dopo[0][tardivaIn].at(-1), tardiva, 'la riga che il redattore non ha visto resta in coda');
    assert.deepEqual(dopo[0].features.slice(0, 2), ['Riga con "virgolette", \\ barra,   e `apici`.', { testo: 'Con la sua segnalazione.', segnalazione: 1956 }]);
    assert.equal(dopo[0].fixes[0], 'Una correzione.');
    assert.equal(dopo[0].date, TOP.date);
    assert.deepEqual(dopo.slice(1), NOTE.slice(1));
  });

  test('le versioni vecchie tornano riscritte a ogni costruzione; senza impronte la riscrittura copre il blocco', () => {
    const r = applicaNovita(SORGENTE, [{ versione: VECCHIO.version, features: ['Vecchia, riscritta.'], fixes: [] }]);
    assert.equal(r.ok, true, r.reason);
    const dopo = note(r.testo);
    assert.deepEqual({ features: dopo[5].features, fixes: dopo[5].fixes }, { features: ['Vecchia, riscritta.'], fixes: [] });
    assert.deepEqual(dopo.filter((_, i) => i !== 5), NOTE.filter((_, i) => i !== 5));
  });

  test('una riscrittura che ha letto righe che questo albero non ha (fuse dopo il commit provato) non si mette', () => {
    const r = applicaNovita(SORGENTE, [{ versione: TOP.version, fixes: ['Racconta anche la riga che qui non c’è.'], originali: [...righeDi(TOP), 'Riga fusa dopo il commit provato.'].map(impronta) }]);
    assert.equal(r.ok, true);
    assert.deepEqual(r.applicate, []);
    assert.equal(r.testo, SORGENTE);
    assert.equal(r.saltate[0].copreAltro, true);
    assert.match(r.saltate[0].perche, /copre 1 righe che questo albero non ha/);
  });

  test('una versione che l’albero non ha, o una riscrittura malformata, si salta e il testo resta quello', () => {
    const r = applicaNovita(SORGENTE, [
      { versione: '9.9.9', fixes: ['Futura.'] },
      { versione: TOP.version, features: [{ testo: 'Senza numero.' }] },
      { versione: TOP.version, features: [''] },
      { versione: '<script>', fixes: ['x'] },
      { versione: TOP.version, features: [], fixes: [] },
      null,
    ]);
    assert.equal(r.ok, true);
    assert.deepEqual(r.applicate, []);
    assert.equal(r.testo, SORGENTE);
    assert.equal(r.saltate.length, 6);
    assert.match(r.saltate[0].perche, /non c’è in questo albero/);
  });

  test('il registro si legge come dato, senza eseguirlo: uguale a quello che carica l’app, e niente oltre ai letterali', () => {
    createRequire(import.meta.url)(FILE);
    assert.deepEqual(note(VERO), JSON.parse(JSON.stringify(globalThis.SN_PATCH_NOTES.NOTES)));
    const letti = note("const NOTES = [\n  // c\n  { version: '1.0.0', 'date': \"x\", features: ['}', '\\u00e8\\x41\\u{1F600}\\n'], /* } */ fixes: [`t`, -1.5, true, null], },\n];");
    assert.deepEqual(letti, [{ version: '1.0.0', date: 'x', features: ['}', 'èA😀\n'], fixes: ['t', -1.5, true, null] }]);
    for (const cattivo of [
      "const NOTES = [{ version: '1.0.0', features: [process.env.FILO_BUILD_PASSPHRASE] }];",
      "const NOTES = [{ version: '1.0.0', features: [`${process.env.X}`] }];",
      "const NOTES = [{ version: '1.0.0', features: ['a' + 'b'] }];",
      "const NOTES = [{ version: '1.0.0', features: [(() => 'x')()] }];",
      "const NOTES = [{ __proto__: { version: '1.0.0' } }];",
      "const NOTES = [{ version: '1.0.0', features: ['aperta] }];",
      'const ALTRO = [];',
    ]) assert.equal(leggiNote(cattivo), null, cattivo);
    assert.equal(applicaNovita('const NOTES = [;', [{ versione: TOP.version, fixes: ['x'] }]).ok, false);
  });
});

describe('chiediNovita', () => {
  const risposta = (status, body) => async () => ({ status, json: async () => body });

  test('esiti con un nome, mai un’eccezione', async () => {
    const tutte = [{ versione: TOP.version, features: ['a'], fixes: [] }];
    assert.deepEqual(await chiediNovita({ passphrase: 'p', versione: TOP.version, fetchImpl: risposta(200, { ok: true, novita: tutte[0], tutte }) }), { outcome: 'done', novita: tutte[0], tutte, troncato: 0 });
    assert.deepEqual((await chiediNovita({ passphrase: 'p', versione: TOP.version, fetchImpl: risposta(200, { ok: true, novita: tutte[0] }) })).tutte, tutte, 'un server di prima manda solo la sua');
    assert.equal((await chiediNovita({ passphrase: 'p', versione: TOP.version, fetchImpl: risposta(200, { ok: false, reason: 'bad_passphrase' }) })).outcome, 'denied');
    assert.equal((await chiediNovita({ passphrase: 'p', versione: TOP.version, fetchImpl: risposta(404, {}) })).outcome, 'not_deployed');
    assert.equal((await chiediNovita({ passphrase: 'p', versione: TOP.version, fetchImpl: async () => { throw new Error('fetch failed'); } })).outcome, 'unreachable');
    assert.equal((await chiediNovita({ versione: TOP.version })).outcome, 'no_passphrase');
    const appeso = await chiediNovita({ passphrase: 'p', versione: TOP.version, attesaMs: 50, fetchImpl: (_, o) => new Promise((_r, no) => o.signal.addEventListener('abort', () => no(new Error('aborted')))) });
    assert.deepEqual(appeso, { outcome: 'unreachable', reason: 'nessuna risposta in 0 s' });
  });
});

describe('come la lancia la pubblicazione', () => {
  async function server(rispondi) {
    const corpi = [];
    const s = createServer((req, res) => {
      let b = '';
      req.on('data', (c) => { b += c; });
      req.on('end', () => {
        corpi.push(JSON.parse(b || '{}'));
        const [status, body] = rispondi();
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      });
    });
    await new Promise((r) => s.listen(0, '127.0.0.1', r));
    return { url: `http://127.0.0.1:${s.address().port}`, corpi, chiudi: () => new Promise((r) => s.close(r)) };
  }
  function progetto() {
    const dir = cartellaTemporanea('release-novita-');
    mkdirSync(join(dir, 'src', 'shared'), { recursive: true });
    writeFileSync(join(dir, 'src', 'shared', 'patchNotes.js'), SORGENTE);
    return dir;
  }

  test('dallo strumento copiato fuori dalla copia di lavoro: chiede la versione senza «v» e riscrive il registro di quella cartella', async () => {
    const riscrittura = { versione: TOP.version, features: ['Tutto nuovo.'], fixes: [], originali: righeDi(TOP).map(impronta) };
    const s = await server(() => [200, { ok: true, novita: riscrittura, tutte: [riscrittura] }]);
    const dir = progetto();
    const strumenti = cartellaTemporanea('strumenti-');
    try {
      copyFileSync(join(ROOT, 'scripts', 'release-novita.mjs'), join(strumenti, 'release-novita.mjs'));
      const { stdout } = await promisify(execFile)(process.execPath, [join(strumenti, 'release-novita.mjs'), `v${TOP.version}`], {
        cwd: dir, env: { ...process.env, FILO_ROUTINE_API: s.url, FILO_BUILD_PASSPHRASE: 'parola' },
      });
      assert.deepEqual(s.corpi, [{ passphrase: 'parola', versione: TOP.version }]);
      const dopo = note(readFileSync(join(dir, 'src', 'shared', 'patchNotes.js'), 'utf8'));
      assert.deepEqual({ features: dopo[0].features, fixes: dopo[0].fixes }, { features: ['Tutto nuovo.'], fixes: [] });
      assert.match(stdout, /riscritte dal redattore/);
    } finally { await s.chiudi(); togliCartella(dir); togliCartella(strumenti); }
  });

  test('server giù, parola sbagliata o senza parola: esce 0, il registro resta quello e l’avviso lo dice', async () => {
    const s = await server(() => [200, { ok: false, reason: 'bad_passphrase' }]);
    const dir = progetto();
    const righe = [];
    const log = console.log;
    console.log = (t) => righe.push(String(t));
    try {
      assert.equal(await main([TOP.version], { cwd: dir, env: { FILO_BUILD_PASSPHRASE: 'p' }, url: s.url }), 0);
      assert.equal(await main([TOP.version], { cwd: dir, env: { FILO_BUILD_PASSPHRASE: 'p' }, url: 'http://127.0.0.1:9/releaseNovita' }), 0);
      assert.equal(await main([TOP.version], { cwd: dir, env: {}, url: s.url }), 0);
      assert.equal(await main(['vecchia'], { cwd: dir, env: { FILO_BUILD_PASSPHRASE: 'p' }, url: s.url }), 0);
    } finally { console.log = log; await s.chiudi(); }
    try {
      assert.equal(readFileSync(join(dir, 'src', 'shared', 'patchNotes.js'), 'utf8'), SORGENTE);
      assert.equal(righe.length, 4);
      for (const r of righe) assert.match(r, /^::warning::novità: .*Escono le righe dei worker\.$/);
      assert.match(righe[0], /parola d’ordine/);
      assert.match(righe[2], /manca FILO_BUILD_PASSPHRASE/);
    } finally { togliCartella(dir); }
  });

  test('la riscrittura della versione che esce non si mette e il server lo sa, così non torna in una costruzione dopo', async () => {
    const coprealtro = { versione: TOP.version, fixes: ['Anche una riga che qui non c’è.'], originali: [impronta('Fusa dopo.')] };
    const vecchia = { versione: VECCHIO.version, features: ['Vecchia, riscritta.'], fixes: [] };
    const s = await server(() => [200, { ok: true, novita: coprealtro, tutte: [coprealtro, vecchia] }]);
    const dir = progetto();
    const log = console.log;
    console.log = () => {};
    try {
      assert.equal(await main([`v${TOP.version}`], { cwd: dir, env: { FILO_BUILD_PASSPHRASE: 'p' }, url: s.url }), 0);
    } finally { console.log = log; await s.chiudi(); }
    try {
      assert.deepEqual(s.corpi, [{ passphrase: 'p', versione: TOP.version }, { passphrase: 'p', versione: TOP.version, scarta: true }]);
      const dopo = note(readFileSync(join(dir, 'src', 'shared', 'patchNotes.js'), 'utf8'));
      assert.deepEqual(dopo[0], TOP, 'la versione che esce resta con le righe dei worker');
      assert.deepEqual(dopo[5].features, ['Vecchia, riscritta.'], 'le altre si mettono lo stesso');
    } finally { togliCartella(dir); }
  });
});

describe('release.yml', () => {
  const YML = readFileSync(join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
  const lavoro = (nome) => {
    const i = YML.indexOf(`\n  ${nome}:\n`);
    const fine = YML.slice(i + 1).search(/\n {2}[a-z-]+:\n/);
    return YML.slice(i, fine < 0 ? undefined : i + 1 + fine);
  };

  for (const [nome, versione, costruzione, lancio, numero] of [
    ['release', 'name: Applica il numero al commit provato', 'name: Build e upload su GitHub Releases', 'node scripts/release-novita.mjs "$VERSIONE"', 'steps.bump.outputs.version'],
    ['release-mac', "name: Il codice qui e' davvero quello di questa versione", 'name: Build e upload sulla release esistente', 'node "${{ runner.temp }}/strumenti/release-novita.mjs" "$VERSIONE"', 'steps.bersaglio.outputs.versione'],
    ['release-linux', "name: Il codice qui e' davvero quello di questa versione", 'name: Build e upload sulla release esistente', 'node "${{ runner.temp }}/strumenti/release-novita.mjs" "$VERSIONE"', 'steps.bersaglio.outputs.versione'],
  ]) {
    test(`${nome}: le novità del redattore dopo il numero e prima della costruzione, con la parola della costruzione`, () => {
      const l = lavoro(nome);
      const passo = l.indexOf("name: Le novita' del redattore (in locale)");
      assert.ok(passo > l.indexOf(versione) && l.indexOf(versione) > 0, 'dopo il numero');
      assert.ok(passo < l.indexOf(costruzione), 'prima della costruzione');
      const corpo = l.slice(passo, l.indexOf('- name:', passo + 1));
      assert.ok(corpo.includes(lancio), corpo);
      assert.match(corpo, /FILO_BUILD_PASSPHRASE: \$\{\{ secrets\.FILO_BUILD_PASSPHRASE \}\}/);
      assert.ok(corpo.includes(`VERSIONE: \${{ ${numero} }}`), 'il numero entra come variabile');
      assert.doesNotMatch(corpo.slice(corpo.indexOf('run:')).replaceAll('${{ runner.temp }}', ''), /\$\{\{/, 'nello script non si incolla niente: un numero scritto a mano diventerebbe un comando, accanto alla parola');
      if (nome !== 'release') assert.match(l, /cp [^\n]*scripts\/release-novita\.mjs[^\n]*"\$\{\{ runner\.temp \}\}\/strumenti\/"/);
    });
  }
});
