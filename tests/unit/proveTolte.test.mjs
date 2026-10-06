// Chi corregge non può cancellare una prova del giro ancora rossa: la consegna la rilancia e si ferma.
// Le prove dei rilievi messi da parte escono prima, nella pulizia. Playwright qui è finto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import {
  proveTolte, percorsoRipristino, esitoProveTolte, controllaProveTolte, controllaPulizia, baseDelConfronto,
  PREFISSO_RIPRISTINO, testoPuliziaFuoriNumero, numeriDelNome, nomeNumeratoStorto, numeraRilievi, puliziaDelPass,
} from '../../scripts/lib/prove-tolte.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const preparaFinto = (cmd, args) => ({ ok: true, cmd, args, env: undefined, nota: '' });

test('contano solo le prove raccolte dentro una cartella di giro', () => {
  assert.deepEqual(proveTolte([
    'tests/verifica/679/giro1-a.spec.mjs',
    'tests/verifica/679/helpers/banco.mjs',
    'tests/verifica/584/giro1-regole-motore-vero.mjs',
    'tests/boot.spec.mjs',
    'tests/verifica/a.spec.mjs',
    `tests/verifica/${PREFISSO_RIPRISTINO}679-1/giro1-a.spec.mjs`,
    'tests\\verifica\\locale-x\\sub\\b.spec.js',
  ]), ['tests/verifica/679/giro1-a.spec.mjs', 'tests/verifica/locale-x/sub/b.spec.js']);
});

test('la copia rimessa sta alla stessa profondità, così gli import relativi risolvono uguali', () => {
  const p = percorsoRipristino('tests/verifica/679/sub/a.spec.mjs', '42');
  assert.equal(p, `tests/verifica/${PREFISSO_RIPRISTINO}679-42/sub/a.spec.mjs`);
  assert.equal(p.split('/').length, 'tests/verifica/679/sub/a.spec.mjs'.split('/').length);
});

test('la cartella delle copie è gitignorata: il salvataggio automatico non la committa', () => {
  const out = execFileSync('git', ['check-ignore', '-q', '--no-index', `tests/verifica/${PREFISSO_RIPRISTINO}679-1/a.spec.mjs`], { cwd: ROOT, stdio: 'ignore' });
  assert.equal(out, null);
});

test('una prova tolta ancora rossa ferma la consegna, sempre: niente eccezione per i rilievi messi da parte', () => {
  const e = esitoProveTolte({ rosse: ['tests/verifica/679/a.spec.mjs'], shaPrima: 'abcdef1234567890' });
  assert.equal(e.ferma, true);
  assert.match(e.testo, /tests\/verifica\/679\/a\.spec\.mjs/);
  assert.match(e.testo, /git checkout abcdef123456 -- <file>/);
  // Il vecchio lasciapassare non esiste più: un argomento in più non lo riapre.
  assert.equal(esitoProveTolte({ rosse: ['tests/verifica/679/a.spec.mjs'], messiDaParte: 2 }).ferma, true);
  assert.deepEqual(esitoProveTolte({ rosse: [] }), { ferma: false, testo: '' });
});

test('senza pulizia registrata la consegna si ferma lo stesso, ma non racconta una pulizia che non c\'è stata', () => {
  const rosse = ['tests/verifica/679/b.spec.mjs'];
  const senza = esitoProveTolte({ rosse, shaPrima: 'abcdef1234567890', conPulizia: false, messi: 1 });
  assert.equal(senza.ferma, true);
  assert.doesNotMatch(senza.testo, /nel commit della pulizia/);
  assert.match(senza.testo, /Nessuna pulizia è stata registrata/);
  assert.match(senza.testo, /lasciala lì/);
  const niente = esitoProveTolte({ rosse, shaPrima: 'abcdef1234567890', conPulizia: false, messi: 0 });
  assert.equal(niente.ferma, true);
  assert.doesNotMatch(niente.testo, /pulizia|messo da parte/);
  assert.match(esitoProveTolte({ rosse, conPulizia: true }).testo, /nel commit della pulizia/);
});

// ─── Il numero del rilievo nel nome: la pulizia sa quale prova va con quale rilievo ───

test('il nome di una prova del giro dice quali rilievi riproduce', () => {
  assert.deepEqual(numeriDelNome('tests/verifica/9/giro2-r3-salva.spec.mjs'), [3]);
  assert.deepEqual(numeriDelNome('tests\\verifica\\9\\giro2-r1-r3-salva.spec.mjs'), [1, 3]);
  assert.deepEqual(numeriDelNome('giro10-r12.spec.mjs'), [12]);
  for (const senza of ['giro2-salva.spec.mjs', 'giro2-rotto.spec.mjs', 'giro2-r2d2.spec.mjs', 'verify-495-rottura.spec.mjs', 'giro2-r0-x.spec.mjs']) {
    assert.deepEqual(numeriDelNome(senza), [], senza);
  }
  for (const storto of ['giro2-r0-x.spec.mjs', 'giro2-R3-x.spec.mjs', 'giro2-salva-r3.spec.mjs', 'r3-giro2-x.spec.mjs', 'giro2-r1-salva-r3.spec.mjs']) {
    assert.equal(nomeNumeratoStorto(storto), true, storto);
  }
  for (const dritto of ['giro2-r1-r3-salva.spec.mjs', 'giro2-salva.spec.mjs', 'giro2-rotto-round2.spec.mjs']) {
    assert.equal(nomeNumeratoStorto(dritto), false, dritto);
  }
});

test('il numero di un rilievo è il suo posto nella critica, interni ed esterni insieme', () => {
  const tutti = [
    { level: 2, sede: 'i', text: 'a' }, { level: 1, sede: 'i', text: 'b', decision: true },
    { level: 1, sede: 'i', text: 'c' }, { level: 1, sede: 'e', text: 'x' }, { level: 1, sede: 'i', text: 'c' },
  ];
  const n = (parte) => numeraRilievi(tutti, parte).map((f) => f.n);
  assert.deepEqual(n([{ level: 1, sede: 'e', text: 'x', priority: 1, num: '#9.1' }, { level: 1, sede: 'i', text: 'b', decision: true }]), [4, 2]);
  assert.deepEqual(n([{ level: 1, sede: 'i', text: 'c' }, { level: 1, sede: 'i', text: 'c' }]), [3, 5], 'due rilievi uguali, due numeri');
  assert.deepEqual(n([{ level: 2, sede: 'i', text: 'non c\'è' }]), [null]);
});

test('la pulizia accetta solo prove coi soli numeri dei rilievi messi da parte', () => {
  const p = (nome) => `tests/verifica/9/${nome}.spec.mjs`;
  assert.equal(testoPuliziaFuoriNumero({ cancellate: [p('giro1-r2-b'), p('giro1-r2-r4-bx')] }, [2, 4]), '');
  const rossa = testoPuliziaFuoriNumero({ cancellate: [p('giro1-r2-b'), p('giro1-r3-c')] }, [2]);
  assert.match(rossa, /giro1-r3-c\.spec\.mjs: r3 non è fra i rilievi messi da parte/);
  assert.doesNotMatch(rossa, /giro1-r2-b\.spec\.mjs:/);
  assert.match(testoPuliziaFuoriNumero({ cancellate: [p('giro1-b')] }, [2]), /giro1-b\.spec\.mjs: il nome non porta il numero/);
  assert.match(testoPuliziaFuoriNumero({ cancellate: [p('giro1-r2-r3-bc')] }, [2]), /copre anche r3[\s\S]*solo il caso/,
    'un file che copre anche un rilievo da correggere non si cancella intero');
  assert.equal(testoPuliziaFuoriNumero({ cambiate: [p('giro1-r2-r3-bc')] }, [2]), '', 'gli si toglie il caso del messo da parte');
  assert.match(testoPuliziaFuoriNumero({ cambiate: [p('giro1-r3-c')] }, [2]), /r3 non è fra/);
  assert.match(testoPuliziaFuoriNumero({ cancellate: [p('giro1-r2-b')], vecchie: [p('giro1-r2-b')] }, [2]), /critica passata/);
  assert.match(testoPuliziaFuoriNumero({ cancellate: [p('giro1-r2-b')] }, [null]), /nessuno porta un numero/);
  assert.equal(testoPuliziaFuoriNumero({ cancellate: ['tests/verifica/9/helpers/banco.mjs'] }, [2]), '', 'un aiuto non è una prova');
});

test('in un repo vero la pulizia sa quali prove ha tolto, come, e quali c\'erano già prima della verifica', () => {
  const dir = cartellaTemporanea('pulizia-per-numero-');
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const scrivi = (f, t) => writeFileSync(resolve(dir, 'tests', 'verifica', '9', f), t);
  try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'prova');
    git('config', 'user.email', 'prova@example.invalid');
    mkdirSync(resolve(dir, 'tests', 'verifica', '9'), { recursive: true });
    scrivi('giro1-r2-vecchia.spec.mjs', '// di un giro passato\n');
    git('add', '-A'); git('commit', '-qm', 'giro prima');
    const avvio = git('rev-parse', 'HEAD');
    scrivi('giro2-r2-b.spec.mjs', '// b\n');
    scrivi('giro2-r2-r3-bc.spec.mjs', 'caso b\ncaso c\n');
    git('add', '-A'); git('commit', '-qm', 'critica');
    const critica = git('rev-parse', 'HEAD');
    git('rm', '-q', 'tests/verifica/9/giro2-r2-b.spec.mjs', 'tests/verifica/9/giro1-r2-vecchia.spec.mjs');
    scrivi('giro2-r2-r3-bc.spec.mjs', 'caso c\n');
    git('commit', '-qam', 'pulizia');
    const c = controllaPulizia({ shaCritica: critica, root: dir, avvio });
    assert.equal(c.ok, true, c.motivo);
    assert.deepEqual(c.cancellate.sort(), ['tests/verifica/9/giro1-r2-vecchia.spec.mjs', 'tests/verifica/9/giro2-r2-b.spec.mjs']);
    assert.deepEqual(c.cambiate, ['tests/verifica/9/giro2-r2-r3-bc.spec.mjs']);
    assert.deepEqual(c.vecchie, ['tests/verifica/9/giro1-r2-vecchia.spec.mjs'], 'il suo r2 è di una critica passata');
    assert.match(testoPuliziaFuoriNumero(c, [2]), /giro1-r2-vecchia[^\n]*critica passata/);
    assert.equal(controllaPulizia({ shaCritica: critica, root: dir }).vecchie, null, 'senza avvio non lo si sa');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function repoConProve() {
  const dir = cartellaTemporanea('prove-tolte-');
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const scrivi = (f, t) => { mkdirSync(dirname(resolve(dir, f)), { recursive: true }); writeFileSync(resolve(dir, f), t); };
  g('init', '-q', '-b', 'lavoro');
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  scrivi('tests/verifica/679/giro1-rossa.spec.mjs', 'ROSSA\n');
  scrivi('tests/verifica/679/giro1-verde.spec.mjs', 'VERDE\n');
  scrivi('tests/verifica/679/helpers/banco.mjs', 'AIUTO\n');
  scrivi('src/x.js', '1\n');
  g('add', '-A'); g('commit', '-qm', 'critica');
  const critica = g('rev-parse', 'HEAD');
  return { dir, g, scrivi, critica };
}

// Il finto Playwright legge la copia rimessa: rosso se dice ROSSA. Registra cosa c'era accanto.
function playwrightFinto(dir, visti) {
  return (cmd, args) => {
    const file = args.find((a) => a.endsWith('.spec.mjs'));
    const pieno = resolve(dir, file);
    visti.push({ file, aiuto: existsSync(resolve(dirname(pieno), 'helpers', 'banco.mjs')), cmd, args });
    return { status: readFileSync(pieno, 'utf8').startsWith('ROSSA') ? 1 : 0 };
  };
}

test('la consegna rilancia solo le prove tolte, com\'erano, e respinge quella ancora rossa', () => {
  const { dir, g, scrivi, critica } = repoConProve();
  try {
    scrivi('src/x.js', 'corretto\n');
    g('rm', '-q', 'tests/verifica/679/giro1-rossa.spec.mjs', 'tests/verifica/679/giro1-verde.spec.mjs');
    g('commit', '-qam', 'correzione');
    const visti = [];
    const e = controllaProveTolte({ shaPrima: critica, root: dir, lancia: playwrightFinto(dir, visti), prepara: preparaFinto, log: () => {} });
    assert.equal(e.ferma, true);
    assert.match(e.testo, /giro1-rossa\.spec\.mjs/);
    assert.doesNotMatch(e.testo, /giro1-verde/);
    assert.equal(visti.length, 2, 'una corsa per prova tolta, niente di più');
    assert.ok(visti.every((v) => v.aiuto), 'la cartella torna intera: gli aiuti accanto alla prova ci sono');
    assert.ok(visti.every((v) => v.args.includes('--retries=1')));
    assert.deepEqual(readdirSync(resolve(dir, 'tests', 'verifica')), ['679'], 'le copie se ne vanno dopo la corsa');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cancellare una prova diventata verde passa, e senza prove tolte non si lancia niente', () => {
  const { dir, g, critica } = repoConProve();
  try {
    const visti = [];
    const lancia = playwrightFinto(dir, visti);
    assert.deepEqual(controllaProveTolte({ shaPrima: critica, root: dir, lancia, prepara: preparaFinto }), { ferma: false, testo: '' });
    g('rm', '-q', 'tests/verifica/679/giro1-verde.spec.mjs'); g('commit', '-qm', 'tolta la verde');
    assert.deepEqual(controllaProveTolte({ shaPrima: critica, root: dir, lancia, prepara: preparaFinto, log: () => {} }), { ferma: false, testo: '' });
    assert.equal(visti.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('togliere il caso rosso e tenere il file ferma la consegna come cancellare la prova', () => {
  const { dir, g, scrivi, critica } = repoConProve();
  try {
    scrivi('tests/verifica/679/giro1-rossa.spec.mjs', 'VERDE: il caso rosso non c\'è più\n');
    scrivi('tests/verifica/679/giro1-verde.spec.mjs', 'VERDE, con un commento in più\n');
    g('commit', '-qam', 'correzione che toglie il caso');
    const visti = [];
    const e = controllaProveTolte({ shaPrima: critica, root: dir, lancia: playwrightFinto(dir, visti), prepara: preparaFinto, log: () => {} });
    assert.equal(e.ferma, true, 'la prova com\'era è ancora rossa: la porta è aperta');
    assert.match(e.testo, /giro1-rossa\.spec\.mjs/);
    assert.doesNotMatch(e.testo, /giro1-verde/, 'una prova cambiata che com\'era è verde non ferma niente');
    assert.equal(visti.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('senza schermo e senza xvfb la consegna si ferma e dice perché, invece di passare', () => {
  const { dir, g, critica } = repoConProve();
  try {
    g('rm', '-q', 'tests/verifica/679/giro1-rossa.spec.mjs'); g('commit', '-qm', 'tolta');
    const e = controllaProveTolte({
      shaPrima: critica, root: dir, prepara: () => ({ ok: false, motivo: 'xvfb-run non c\'è' }), lancia: () => { throw new Error('non doveva partire'); },
    });
    assert.equal(e.ferma, true);
    assert.match(e.testo, /xvfb-run non c'è/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Critica sulla vecchia base; poi main cambia e cancella prove di un altro lavoro, e il ramo si riallinea.
function riallineatoDopoLaCritica() {
  const dir = cartellaTemporanea('prove-tolte-riallineo-');
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const scrivi = (f, t) => { mkdirSync(dirname(resolve(dir, f)), { recursive: true }); writeFileSync(resolve(dir, f), t); };
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  scrivi('tests/verifica/99/giro1-cambiata.spec.mjs', 'ROSSA\n');
  scrivi('tests/verifica/99/giro1-cancellata.spec.mjs', 'ROSSA\n');
  g('add', '-A'); g('commit', '-qm', 'main: un altro lavoro');
  g('checkout', '-q', '-b', 'lavoro');
  scrivi('tests/verifica/679/giro1-rossa.spec.mjs', 'ROSSA\n');
  scrivi('tests/verifica/679/giro1-verde.spec.mjs', 'VERDE\n');
  scrivi('src/x.js', '1\n');
  g('add', '-A'); g('commit', '-qm', 'critica');
  const critica = g('rev-parse', 'HEAD');
  g('checkout', '-q', 'main');
  scrivi('tests/verifica/99/giro1-cambiata.spec.mjs', 'VERDE: l\'altro lavoro ha tolto il suo caso\n');
  g('rm', '-q', 'tests/verifica/99/giro1-cancellata.spec.mjs');
  g('commit', '-qam', 'main: l\'altro lavoro svuota la sua cartella');
  g('checkout', '-q', 'lavoro');
  g('rebase', '-q', 'main');
  return { dir, g, scrivi, critica };
}

test('dopo un riallineamento le prove che ha cambiato main non entrano nel rilancio; quelle del ramo sì', () => {
  const { dir, g, scrivi, critica } = riallineatoDopoLaCritica();
  try {
    scrivi('src/x.js', 'corretto\n');
    g('commit', '-qam', 'correzione che non tocca prove');
    const visti = [];
    const lancia = playwrightFinto(dir, visti);
    assert.deepEqual(controllaProveTolte({ shaPrima: critica, root: dir, lancia, prepara: preparaFinto, log: () => {} }), { ferma: false, testo: '' });
    assert.equal(visti.length, 0, 'le prove dell\'altro lavoro non sono state rilanciate');
    g('rm', '-q', 'tests/verifica/679/giro1-rossa.spec.mjs'); g('commit', '-qm', 'tolta la rossa');
    const e = controllaProveTolte({ shaPrima: critica, root: dir, lancia, prepara: preparaFinto, log: () => {} });
    assert.equal(e.ferma, true, 'la prova rossa tolta dal ramo ferma ancora la consegna');
    assert.match(e.testo, /679\/giro1-rossa\.spec\.mjs/);
    assert.doesNotMatch(e.testo, /tests\/verifica\/99\//);
    assert.deepEqual(visti.map((v) => v.file.split('/').pop()), ['giro1-rossa.spec.mjs']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dopo un riallineamento una prova già su main che il ramo cambia entra ancora nel rilancio', () => {
  const { dir, g, scrivi, critica } = riallineatoDopoLaCritica();
  try {
    scrivi('tests/verifica/99/giro1-cambiata.spec.mjs', 'VERDE: ritoccata anche dal ramo\n');
    g('commit', '-qam', 'il ramo tocca una prova che main aveva già cambiato');
    const visti = [];
    controllaProveTolte({ shaPrima: critica, root: dir, lancia: playwrightFinto(dir, visti), prepara: preparaFinto, log: () => {} });
    assert.deepEqual(visti.map((v) => v.file.split('/').pop()), ['giro1-cambiata.spec.mjs']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('le due consegne, locale e routine, passano da questo controllo, con la pulizia come base', () => {
  const locale = readFileSync(resolve(ROOT, 'scripts', 'verify-local.mjs'), 'utf8');
  const routine = readFileSync(resolve(ROOT, 'scripts', 'dispatch.mjs'), 'utf8');
  assert.match(locale, /baseDelConfronto\(aperto\.pending\.sha, aperto\.pending\.shaPulizia/);
  assert.match(locale, /controllaProveTolte\(\{ shaPrima: base, root: ROOT,/);
  assert.match(routine, /baseDelConfronto\(shaCritica, guard\.state\?\.puliziaSha \|\| puliziaPass/);
  assert.match(routine, /verifierVerdict === 'pass' \? puliziaDelPass\(shaCritica, guard\.state\?\.checkpoints/, 'dopo un pass la base è la pulizia sigillata (#880)');
  assert.match(routine, /controllaProveTolte\(\{\s*shaPrima: baseTolte/);
  assert.doesNotMatch(`${locale}\n${routine}`, /messiDaParte:/, 'nessuna delle due passa più un lasciapassare');
});

// ─── La pulizia: le prove dei rilievi messi da parte escono prima della correzione ───

test('la pulizia accetta solo prove o casi tolti, da una cartella del giro', () => {
  const { dir, g, scrivi, critica } = repoConProve();
  try {
    assert.match(controllaPulizia({ shaCritica: critica, root: dir }).motivo, /nessun commit dopo la critica/);
    g('rm', '-q', 'tests/verifica/679/giro1-rossa.spec.mjs'); g('commit', '-qm', 'pulizia');
    const ok = controllaPulizia({ shaCritica: critica, root: dir, cartella: 'tests/verifica/679' });
    assert.equal(ok.ok, true, ok.motivo);
    assert.equal(ok.sha, g('rev-parse', 'HEAD'));
    assert.deepEqual(ok.files, ['tests/verifica/679/giro1-rossa.spec.mjs']);
    assert.equal(controllaPulizia({ shaCritica: critica, root: dir, cartella: 'tests/verifica/locale-altro' }).ok, false,
      'una cartella che non è quella del giro non si pulisce da qui');
    scrivi('src/x.js', 'una correzione infilata nella pulizia\n');
    g('commit', '-qam', 'correzione');
    const no = controllaPulizia({ shaCritica: critica, root: dir });
    assert.equal(no.ok, false);
    assert.match(no.motivo, /solo togliere prove del giro[\s\S]*src\/x\.js/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('una riga aggiunta a una prova del giro non è una pulizia', () => {
  const { dir, g, scrivi, critica } = repoConProve();
  try {
    scrivi('tests/verifica/679/giro1-rossa.spec.mjs', 'ROSSA\ntest.fail(true)\n');
    g('commit', '-qam', 'marcatore');
    assert.equal(controllaPulizia({ shaCritica: critica, root: dir }).ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dopo la pulizia la base è lei: la prova messa da parte non si rilancia, una rossa tolta dopo ferma', () => {
  const { dir, g, scrivi, critica } = repoConProve();
  try {
    scrivi('tests/verifica/679/giro1-messa-da-parte.spec.mjs', 'ROSSA\n');
    g('add', '-A'); g('commit', '-qm', 'critica, con la prova di un rilievo che il server mette da parte');
    const critica2 = g('rev-parse', 'HEAD');
    g('rm', '-q', 'tests/verifica/679/giro1-messa-da-parte.spec.mjs'); g('commit', '-qm', 'pulizia');
    const pulizia = g('rev-parse', 'HEAD');
    assert.equal(baseDelConfronto(critica2, pulizia, dir), pulizia);
    assert.equal(baseDelConfronto(critica2, '', dir), critica2);
    assert.equal(baseDelConfronto(pulizia, critica, dir), pulizia, 'una pulizia di un giro vecchio non sposta la base');
    scrivi('src/x.js', 'corretto\n'); g('commit', '-qam', 'correzione');
    const visti = [];
    const lancia = playwrightFinto(dir, visti);
    assert.deepEqual(controllaProveTolte({ shaPrima: pulizia, root: dir, lancia, prepara: preparaFinto, log: () => {} }), { ferma: false, testo: '' });
    assert.equal(visti.length, 0, 'la prova uscita nella pulizia non è della correzione');
    g('rm', '-q', 'tests/verifica/679/giro1-rossa.spec.mjs'); g('commit', '-qm', 'tolta anche una rossa');
    const e = controllaProveTolte({ shaPrima: pulizia, root: dir, lancia, prepara: preparaFinto, log: () => {} });
    assert.equal(e.ferma, true);
    assert.match(e.testo, /giro1-rossa\.spec\.mjs/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// #880 (il caso di #591): verifica superata sulla vecchia base, la pulizia toglie la prova del rilievo diventato
// feedback (rossa per costruzione), il rilascio la sigilla, poi main va avanti e il ramo si riallinea.
function riallineatoDopoIlPass({ primaDelRebase = null } = {}) {
  const dir = cartellaTemporanea('prove-tolte-pass-');
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const scrivi = (f, t) => { mkdirSync(dirname(resolve(dir, f)), { recursive: true }); writeFileSync(resolve(dir, f), t); };
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  scrivi('src/main.js', '1\n');
  g('add', '-A'); g('commit', '-qm', 'main');
  g('checkout', '-q', '-b', 'lavoro');
  scrivi('src/x.js', 'lavoro\n');
  scrivi('tests/verifica/591/giro2-r1-diventato-feedback.spec.mjs', 'ROSSA\n');
  scrivi('tests/verifica/591/giro1-rotta-dal-rebase.spec.mjs', 'ROSSA\n');
  g('add', '-A'); g('commit', '-qm', 'critica: verifica superata');
  const critica = g('rev-parse', 'HEAD');
  g('rm', '-q', 'tests/verifica/591/giro2-r1-diventato-feedback.spec.mjs'); g('commit', '-qm', 'via le prove dei rilievi diventati feedback');
  const pulizia = g('rev-parse', 'HEAD');
  if (primaDelRebase) primaDelRebase({ g, scrivi });
  g('checkout', '-q', 'main');
  scrivi('src/main.js', '2\n'); g('commit', '-qam', 'main va avanti');
  g('checkout', '-q', 'lavoro');
  g('rebase', '-q', 'main');
  const punti = [{ sha: critica, by: 'verifier:pass' }, { sha: pulizia, by: 'release:verifier' }];
  return { dir, g, scrivi, critica, pulizia, punti };
}

test('#880: dopo un pass la pulizia sigillata è la base del riallineamento, e la prova del rilievo diventato feedback non si rilancia', () => {
  const { dir, critica, pulizia, punti } = riallineatoDopoIlPass();
  try {
    assert.throws(() => execFileSync('git', ['merge-base', '--is-ancestor', critica, 'HEAD'], { cwd: dir, stdio: 'ignore' }), undefined, 'il rebase ha riscritto il ramo');
    assert.equal(puliziaDelPass(critica, punti, dir), pulizia);
    assert.equal(baseDelConfronto(critica, puliziaDelPass(critica, punti, dir), dir), pulizia);
    const visti = [];
    const lancia = playwrightFinto(dir, visti);
    assert.deepEqual(controllaProveTolte({ shaPrima: pulizia, root: dir, lancia, prepara: preparaFinto, conPulizia: true, shaCritica: critica, log: () => {} }),
      { ferma: false, testo: '' });
    assert.equal(visti.length, 0, 'la prova uscita dopo il pass non si rilancia');
    // Senza la pulizia come base, è il blocco di #591: la prova rossa per costruzione ferma ogni riallineamento.
    const vecchio = controllaProveTolte({ shaPrima: critica, root: dir, lancia, prepara: preparaFinto, conPulizia: false, log: () => {} });
    assert.equal(vecchio.ferma, true);
    assert.match(vecchio.testo, /giro2-r1-diventato-feedback/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#880 senza riaprire #679: una prova rossa tolta da chi riallinea, prima o dopo il rebase, ferma ancora la consegna', () => {
  const dopo = riallineatoDopoIlPass();
  try {
    dopo.g('rm', '-q', 'tests/verifica/591/giro1-rotta-dal-rebase.spec.mjs'); dopo.g('commit', '-qm', 'riallineamento: tolta la rossa');
    const visti = [];
    const e = controllaProveTolte({ shaPrima: puliziaDelPass(dopo.critica, dopo.punti, dopo.dir), root: dopo.dir, lancia: playwrightFinto(dopo.dir, visti), prepara: preparaFinto, conPulizia: true, shaCritica: dopo.critica, log: () => {} });
    assert.equal(e.ferma, true);
    assert.match(e.testo, /giro1-rotta-dal-rebase/);
    assert.doesNotMatch(e.testo, /giro2-r1-diventato-feedback/);
    assert.deepEqual(visti.map((v) => v.file.split('/').pop()), ['giro1-rotta-dal-rebase.spec.mjs']);
  } finally {
    rmSync(dopo.dir, { recursive: true, force: true });
  }
  // Un commit che toglie solo prove, fatto da chi riallinea prima del rebase, non diventa la base nemmeno se il suo
  // rilascio (o quello di chiunque non sia il verificatore) lo sigilla.
  let diChiRiallinea = '';
  const prima = riallineatoDopoIlPass({ primaDelRebase: ({ g }) => { g('rm', '-q', 'tests/verifica/591/giro1-rotta-dal-rebase.spec.mjs'); g('commit', '-qm', 'tolta prima del rebase'); diChiRiallinea = g('rev-parse', 'HEAD'); } });
  try {
    assert.equal(puliziaDelPass(prima.critica, prima.punti, prima.dir), prima.pulizia);
    for (const by of ['release:fixer', 'release', 'fixer:checkout', 'deliver:status', 'pulizia']) {
      assert.equal(puliziaDelPass(prima.critica, [...prima.punti, { sha: diChiRiallinea, by }], prima.dir), prima.pulizia, `sigillo «${by}»`);
      assert.equal(puliziaDelPass(prima.critica, [prima.punti[0], { sha: diChiRiallinea, by }], prima.dir), '', `sigillo «${by}» senza pulizia del verificatore`);
    }
    const e = controllaProveTolte({ shaPrima: prima.pulizia, root: prima.dir, lancia: playwrightFinto(prima.dir, []), prepara: preparaFinto, conPulizia: true, shaCritica: prima.critica, log: () => {} });
    assert.equal(e.ferma, true);
    assert.match(e.testo, /giro1-rotta-dal-rebase/);
  } finally {
    rmSync(prima.dir, { recursive: true, force: true });
  }
});

test('#880: è pulizia del pass solo un punto fermo che discende dalla critica e ne toglie soltanto prove del giro', () => {
  const { dir, g, scrivi, critica, pulizia, punti } = riallineatoDopoIlPass();
  try {
    const riallineato = g('rev-parse', 'HEAD');
    assert.equal(puliziaDelPass(critica, [...punti, { sha: riallineato, by: 'release:verifier' }], dir), pulizia, 'il ramo riscritto dal rebase non discende dalla critica');
    assert.equal(puliziaDelPass(critica, [punti[0]], dir), '', 'senza il sigillo della pulizia non c\'è base nuova');
    g('checkout', '-q', critica);
    scrivi('src/x.js', 'cambiato dopo il verdetto\n');
    g('rm', '-q', 'tests/verifica/591/giro2-r1-diventato-feedback.spec.mjs'); g('commit', '-qam', 'pulizia con del codice dentro');
    assert.equal(puliziaDelPass(critica, [punti[0], { sha: g('rev-parse', 'HEAD'), by: 'release:verifier' }], dir), '', 'una riga di codice non è una pulizia');
    for (const storto of [[], null, [{}], [{ sha: 'non-uno-sha' }]]) assert.equal(puliziaDelPass(critica, storto, dir), '');
    assert.equal(puliziaDelPass('', punti, dir), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Il caso di tests/verifica/locale-attriti-verifica/giro1: un rilievo esterno nel giro non apre più la porta.
// Processo vero di verify-local, npx finto che risponde rosso a ogni prova.
function giroLocaleAperto({ external = [], derived = [] } = {}) {
  const dir = cartellaTemporanea('giro-locale-prove-tolte-');
  const g = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const scrivi = (f, t) => { mkdirSync(dirname(resolve(dir, f)), { recursive: true }); writeFileSync(resolve(dir, f), t); };
  const ramo = 'claude/prova-giro';
  const cartella = 'tests/verifica/locale-prova-giro';
  g('init', '-q', '-b', ramo);
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  scrivi('.gitignore', '.claude/\ntests/verifica/_tolte-*/\nbin/\n');
  scrivi(`${cartella}/giro1-rilievo.spec.mjs`, 'rossa\n');
  scrivi(`${cartella}/giro1-r2-messo-da-parte.spec.mjs`, 'rossa\n');
  g('add', '-A'); g('commit', '-qm', 'critica');
  const critica = g('rev-parse', 'HEAD');
  scrivi('bin/npx.cmd', '@echo prova rossa\r\n@exit /b 1\r\n');
  scrivi('bin/npx', '#!/bin/sh\necho prova rossa\nexit 1\n');
  chmodSync(resolve(dir, 'bin', 'npx'), 0o755);
  const stato = (extra = {}) => writeFileSync(resolve(dir, '.claude', 'verify-local.json'), JSON.stringify({
    [ramo]: {
      request: 'correggi il pulsante', verdict: 'fix-pending', rounds: [{ outcome: '' }],
      critique: 'Provato il pulsante.\n[2i] Il pulsante non salva col titolo vuoto\n[1i] Il bordo è freddo',
      pending: {
        sha: critica, at: new Date().toISOString(), budgets: null, derived, external,
        findings: [{ level: 2, sede: 'i', text: 'Il pulsante non salva col titolo vuoto' }], ...extra,
      },
    },
  }));
  mkdirSync(resolve(dir, '.claude'), { recursive: true });
  stato();
  const vl = (...args) => {
    const r = spawnSync(process.execPath, [resolve(ROOT, 'scripts', 'verify-local.mjs'), ...args], {
      cwd: dir, encoding: 'utf8',
      env: { ...process.env, FILO_REPO_ROOT: dir, DISPLAY: process.env.DISPLAY || ':0', PATH: `${resolve(dir, 'bin')}${delimiter}${process.env.PATH}` },
    });
    const entry = JSON.parse(readFileSync(resolve(dir, '.claude', 'verify-local.json'), 'utf8'))[ramo];
    return { status: r.status, testo: `${r.stdout}\n${r.stderr}`, entry };
  };
  return { dir, g, scrivi, cartella, critica, vl };
}

const REPORT = 'Corretto il rilievo del giro: il pulsante ora salva anche col titolo vuoto, provato a mano e con la prova.';

test('con un rilievo esterno nel giro, una prova cancellata ancora rossa ferma lo stesso la consegna', () => {
  const { dir, g, scrivi, cartella, vl } = giroLocaleAperto({ external: [{ level: 1, sede: 'e', text: 'Il bordo del menu è grigio' }] });
  try {
    g('rm', '-q', `${cartella}/giro1-rilievo.spec.mjs`);
    scrivi('codice.js', 'module.exports = 1;\n');
    g('add', '-A'); g('commit', '-qm', 'correzione');
    const r = vl('corretto', REPORT);
    assert.notEqual(r.status, 0, r.testo);
    assert.match(r.testo, /giro1-rilievo\.spec\.mjs/);
    assert.equal(r.entry.verdict, 'fix-pending', 'la consegna respinta non chiude il giro');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('in locale la pulizia si registra, e la consegna dopo non rilancia la prova messa da parte', () => {
  const derived = [{ level: 1, sede: 'i', text: 'Il bordo è freddo', priority: 1 }];
  const { dir, g, scrivi, cartella, vl } = giroLocaleAperto({ derived });
  try {
    g('rm', '-q', `${cartella}/giro1-r2-messo-da-parte.spec.mjs`); g('commit', '-qm', 'pulizia del giro');
    const pulizia = g('rev-parse', 'HEAD');
    const p = vl('pulizia');
    assert.equal(p.status, 0, p.testo);
    assert.equal(p.entry.pending.shaPulizia, pulizia);
    scrivi('codice.js', 'module.exports = 1;\n');
    g('add', '-A'); g('commit', '-qm', 'correzione');
    const c = vl('corretto', REPORT);
    assert.equal(c.status, 0, c.testo);
    assert.equal(c.entry.verdict, 'fixed');
    assert.equal(c.entry.chiusura.shaPrima, pulizia, 'la verifica dopo guarda la correzione, non la pulizia');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('in locale la pulizia si rifiuta senza rilievi messi da parte, o se il commit porta altro', () => {
  const { dir, g, scrivi, cartella, vl } = giroLocaleAperto();
  try {
    g('rm', '-q', `${cartella}/giro1-rilievo.spec.mjs`); g('commit', '-qm', 'tolta la rossa da correggere');
    const p = vl('pulizia');
    assert.notEqual(p.status, 0);
    assert.match(p.testo, /non ha messo da parte nessun rilievo/);
    assert.equal(p.entry.pending.shaPulizia, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const altro = giroLocaleAperto({ derived: [{ level: 1, sede: 'i', text: 'x', priority: 1 }] });
  try {
    altro.g('rm', '-q', `${altro.cartella}/giro1-r2-messo-da-parte.spec.mjs`);
    altro.scrivi('codice.js', 'una correzione\n');
    altro.g('add', '-A'); altro.g('commit', '-qm', 'pulizia e correzione insieme');
    const p = altro.vl('pulizia');
    assert.notEqual(p.status, 0);
    assert.match(p.testo, /codice\.js/);
  } finally {
    rmSync(altro.dir, { recursive: true, force: true });
  }
});

// Il caso del giro 2 su claude/prove-rosse-blocco: un rilievo messo da parte senza una prova sua (una domanda, un
// esterno) non lascia più uscire nella pulizia la prova rossa di un rilievo da correggere. verify-local vero, npx finto.
const { withRequest, withCritique } = await import('../../scripts/verify-local.mjs');

// Il finto Playwright: una prova è rossa se uno dei file di stato che nomina dice ancora «rotto».
const NPX_FINTO = [
  "import { readFileSync } from 'node:fs';",
  "const f = process.argv.find((a) => /\\.spec\\.mjs$/.test(a));",
  "const rotti = [...readFileSync(f, 'utf8').matchAll(/stato-([a-z])\\.txt/g)]",
  "  .filter((m) => readFileSync(`stato-${m[1]}.txt`, 'utf8').includes('rotto'));",
  "console.log(rotti.length ? `prova rossa: ${f}` : `prova verde: ${f}`);",
  'process.exit(rotti.length ? 1 : 0);',
  '',
].join('\n');

function giroCriticato({ prove, critica }) {
  const dir = cartellaTemporanea('pulizia-per-numero-giro-');
  const g = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const scrivi = (f, t) => { mkdirSync(dirname(resolve(dir, f)), { recursive: true }); writeFileSync(resolve(dir, f), t); };
  const ramo = 'claude/prova-giro';
  const cartella = 'tests/verifica/locale-prova-giro';
  g('init', '-q', '-b', ramo);
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  scrivi('.gitignore', '.claude/\ntests/verifica/_tolte-*/\nbin/\n');
  scrivi('bin/npx.mjs', NPX_FINTO);
  scrivi('bin/npx.cmd', `@"${process.execPath}" "%~dp0npx.mjs" %*\r\n`);
  scrivi('bin/npx', `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/npx.mjs" "$@"\n`);
  chmodSync(resolve(dir, 'bin', 'npx'), 0o755);
  scrivi('codice.js', 'module.exports = 0;\n');
  g('add', '-A'); g('commit', '-qm', 'avvio della verifica');
  const avvio = g('rev-parse', 'HEAD');
  const caso = (x) => `test('rilievo ${x}', () => { expect(readFileSync('stato-${x}.txt', 'utf8')).toContain('corretto'); });`;
  for (const [nome, rilievi] of Object.entries(prove)) {
    scrivi(`${cartella}/${nome}.spec.mjs`, `${rilievi.map(caso).join('\n')}\n`);
    for (const x of rilievi) scrivi(`stato-${x}.txt`, 'rotto\n');
  }
  g('add', '-A'); g('commit', '-qm', 'prove del giro');
  const shaCritica = g('rev-parse', 'HEAD');
  const r = withCritique(withRequest({}, ramo, { request: 'richiesta di prova', sha: avvio }), ramo, {
    critique: critica, sha: shaCritica, caps: { cap3: 2, cap2: 2, cap1: 1, cap0: 0 },
  });
  assert.equal(r.outcome, 'fix', r.reason);
  mkdirSync(resolve(dir, '.claude'), { recursive: true });
  writeFileSync(resolve(dir, '.claude', 'verify-local.json'), JSON.stringify(r.state));
  const vl = (...args) => {
    const p = spawnSync(process.execPath, [resolve(ROOT, 'scripts', 'verify-local.mjs'), ...args], {
      cwd: dir, encoding: 'utf8',
      env: { ...process.env, FILO_REPO_ROOT: dir, DISPLAY: process.env.DISPLAY || ':0', PATH: `${resolve(dir, 'bin')}${delimiter}${process.env.PATH}` },
    });
    const entry = JSON.parse(readFileSync(resolve(dir, '.claude', 'verify-local.json'), 'utf8'))[ramo];
    return { status: p.status, testo: `${p.stdout}\n${p.stderr}`, entry };
  };
  const corretto = (...x) => { for (const k of x) scrivi(`stato-${k}.txt`, 'corretto\n'); g('commit', '-qam', `corretti ${x.join(', ')}`); };
  return { dir, g, scrivi, cartella, shaCritica, vl, corretto };
}

test('una domanda per l\'owner senza prova sua non lascia uscire la prova rossa di un rilievo da correggere', () => {
  const { dir, g, cartella, vl, corretto } = giroCriticato({
    prove: { 'giro1-r1-a': ['a'], 'giro1-r3-c': ['c'] },
    critica: 'Provato il giro, riassunto.\n[2i] la cosa a non funziona.\n[1i?] il bordo è freddo: scelta di gusto?\n[1i] la cosa c non funziona.',
  });
  try {
    g('rm', '-q', `${cartella}/giro1-r3-c.spec.mjs`); g('commit', '-qm', 'pulizia del giro');
    const p = vl('pulizia');
    assert.notEqual(p.status, 0, p.testo);
    assert.match(p.testo, /giro1-r3-c\.spec\.mjs: r3 non è fra i rilievi messi da parte/);
    assert.match(p.testo, /messi da parte: r2\)/);
    assert.equal(p.entry.pending.shaPulizia, undefined);
    corretto('a');
    const c = vl('corretto', REPORT);
    assert.notEqual(c.status, 0, 'senza pulizia registrata la consegna rilancia la prova tolta, ancora rossa');
    assert.match(c.testo, /giro1-r3-c\.spec\.mjs/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('un rilievo esterno non allarga la pulizia fino alla prova rossa di un rilievo da correggere', () => {
  const { dir, g, cartella, shaCritica, vl } = giroCriticato({
    prove: { 'giro1-r1-a': ['a'], 'giro1-r2-b': ['b'], 'giro1-r3-c': ['c'] },
    critica: 'Provato il giro, riassunto.\n[2i] la cosa a non funziona.\n[1i?] scelta di gusto sulla b.\n[1i] la cosa c non funziona.\n[1e] un difetto di un altro lavoro.',
  });
  try {
    g('rm', '-q', `${cartella}/giro1-r2-b.spec.mjs`, `${cartella}/giro1-r3-c.spec.mjs`); g('commit', '-qm', 'pulizia larga');
    const larga = vl('pulizia');
    assert.notEqual(larga.status, 0, larga.testo);
    assert.match(larga.testo, /messi da parte: r2, r4\)/);
    assert.match(larga.testo, /giro1-r3-c\.spec\.mjs: r3/);
    assert.doesNotMatch(larga.testo, /giro1-r2-b\.spec\.mjs:/);
    g('checkout', shaCritica, '--', `${cartella}/giro1-r3-c.spec.mjs`); g('commit', '-qm', 'rimessa la prova di c');
    const giusta = vl('pulizia');
    assert.equal(giusta.status, 0, giusta.testo);
    assert.equal(giusta.entry.pending.shaPulizia, g('rev-parse', 'HEAD'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a una prova che copre anche un rilievo da correggere si toglie solo il caso, e la consegna rilancia il resto', () => {
  const { dir, g, scrivi, cartella, shaCritica, vl, corretto } = giroCriticato({
    prove: { 'giro1-r1-a': ['a'], 'giro1-r2-r3-bc': ['b', 'c'] },
    critica: 'Provato il giro, riassunto.\n[2i] la cosa a non funziona.\n[1i?] scelta di gusto sulla b.\n[1i] la cosa c non funziona.',
  });
  const file = `${cartella}/giro1-r2-r3-bc.spec.mjs`;
  try {
    g('rm', '-q', file); g('commit', '-qm', 'pulizia che cancella tutto il file');
    const intera = vl('pulizia');
    assert.notEqual(intera.status, 0, intera.testo);
    assert.match(intera.testo, /copre anche r3/);
    g('checkout', shaCritica, '--', file);
    scrivi(file, readFileSync(resolve(dir, file), 'utf8').split('\n').filter((l) => !l.includes('stato-b')).join('\n'));
    g('add', '-A'); g('commit', '-qm', 'pulizia: tolto solo il caso di b');
    const p = vl('pulizia');
    assert.equal(p.status, 0, p.testo);
    corretto('a');
    const rossa = vl('corretto', REPORT);
    assert.notEqual(rossa.status, 0, 'il caso di c è rimasto ed è rosso: la consegna si ferma anche se il file non è stato toccato');
    assert.match(rossa.testo, /il caso che resta[\s\S]*giro1-r2-r3-bc\.spec\.mjs/);
    assert.equal(rossa.entry.verdict, 'fix-pending');
    corretto('c');
    const verde = vl('corretto', REPORT);
    assert.equal(verde.status, 0, verde.testo);
    assert.equal(verde.entry.verdict, 'fixed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
