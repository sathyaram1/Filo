// Virgolette ai percorsi con spazi nel terminale della home (#968): incollando un percorso intero che esiste la riga
// le prende prima dell'Invio, e dopo un comando fallito per quelle mancanti c'è la versione giusta. Le virgolette
// sono quelle della shell che gira davvero: qui ogni shell si prova con la sua, su qualunque sistema.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'virgoletteShell.js'));
const V = globalThis.SN_VIRGOLETTE;
const S = require(join(ROOT, 'src', 'main', 'services', 'shellVirgolette.js'));
const T = require(join(ROOT, 'src', 'main', 'services', 'terminal.js'));

// Un disco finto: percorso → 'file' | 'cartella'. Conta le domande, per chi vuole sapere quante.
function disco(voci) {
  const mappa = new Map(Object.entries(voci));
  const chiesti = [];
  const esiste = async (p) => { chiesti.push(p); return mappa.get(p) || null; };
  return { esiste, chiesti };
}

// La riga dopo l'incolla: `prima` + `testo` + `dopo`, e dove sta il testo incollato.
function incollato(prima, testo, dopo = '') {
  return { riga: prima + testo + dopo, inizio: prima.length, fine: prima.length + testo.length };
}

function applica(riga, s) {
  return riga.slice(0, s.inizio) + s.testo + riga.slice(s.fine);
}

// ─────────────── come si scrive un percorso, per ogni shell ───────────────

test('sh e bash: virgolette doppie, la tilde fuori, le singole quando dentro c\'è $ o \\', () => {
  for (const sh of ['sh', 'bash']) {
    assert.equal(V.quota('/home/Nome Cognome', sh), '"/home/Nome Cognome"');
    assert.equal(V.quota('/home/x/l\'archivio', sh), '"/home/x/l\'archivio"');
    assert.equal(V.quota('~/Nome Cognome', sh), '~/"Nome Cognome"', 'fra virgolette sh non espanderebbe la tilde');
    assert.equal(V.quota('/x/costo $5', sh), "'/x/costo $5'");
    assert.equal(V.quota("/x/l'euro $", sh), "'/x/l'\\''euro $'");
    assert.equal(V.quota('/opt/my app/run.sh', sh, { comando: true }), '"/opt/my app/run.sh"', 'sh lancia un percorso fra virgolette così com\'è');
  }
});

test('PowerShell: doppie, singole quando c\'è $ o una virgoletta doppia, e `&` davanti a un programma', () => {
  assert.equal(V.quota('C:\\Users\\Nome Cognome', 'powershell'), '"C:\\Users\\Nome Cognome"');
  assert.equal(V.quota('C:\\Users\\Nome Cognome\\', 'powershell'), '"C:\\Users\\Nome Cognome"',
    'la barra in fondo davanti alla virgoletta, per un programma Windows, diventa una virgoletta scritta');
  assert.equal(V.quota('C:\\x\\costo $5', 'powershell'), "'C:\\x\\costo $5'");
  assert.equal(V.quota('C:\\x\\l\u2019arch $', 'powershell'), "'C:\\x\\l\u2019\u2019arch $'",
    'l\'apostrofo tipografico per PowerShell è una virgoletta: dentro le singole va raddoppiato');
  assert.equal(V.quota('C:\\Program Files\\app.exe', 'powershell', { comando: true }), '& "C:\\Program Files\\app.exe"',
    'senza & PowerShell stamperebbe la stringa invece di lanciarla');
  assert.equal(V.quota('~\\Nome Cognome', 'powershell'), '"~\\Nome Cognome"');
});

test('cmd: sempre doppie, niente & e niente barra in fondo; una shell sconosciuta non scrive niente', () => {
  assert.equal(V.quota('C:\\Users\\Nome Cognome\\', 'cmd'), '"C:\\Users\\Nome Cognome"');
  assert.equal(V.quota('C:\\Program Files\\app.exe', 'cmd', { comando: true }), '"C:\\Program Files\\app.exe"');
  assert.equal(V.quota('~\\x y', 'cmd'), '"~\\x y"', 'cmd non conosce la tilde');
  assert.equal(V.quota('/x y', 'fish'), null);
  assert.equal(V.quota('a\nb', 'sh'), null);
});

test('cosa va protetto dipende dalla shell: l\'apostrofo rompe sh e PowerShell, non cmd', () => {
  assert.equal(V.serveQuotare("l'archivio", 'sh'), true);
  assert.equal(V.serveQuotare('l\u2019archivio', 'powershell'), true);
  assert.equal(V.serveQuotare("l'archivio", 'cmd'), false);
  assert.equal(V.serveQuotare('C:\\Users\\Nome', 'powershell'), false);
  assert.equal(V.serveQuotare('C:\\Users\\Nome Cognome', 'cmd'), true);
});

// ─────────────── incollando nella barra ───────────────

test('incollato nel comando, un percorso con spazi che esiste prende le virgolette della shell', async () => {
  const casi = [
    ['sh', '/home/agenti AI/Nome Cognome', '"/home/agenti AI/Nome Cognome"'],
    ['bash', '/home/agenti AI/Nome Cognome', '"/home/agenti AI/Nome Cognome"'],
    ['powershell', 'C:\\Users\\Nome Cognome', '"C:\\Users\\Nome Cognome"'],
    ['cmd', 'C:\\Users\\Nome Cognome', '"C:\\Users\\Nome Cognome"'],
  ];
  for (const [shell, percorso, atteso] of casi) {
    const { esiste } = disco({ [percorso]: 'cartella' });
    const x = incollato('/cd ', percorso);
    const s = await V.virgoletteIncollando({ ...x, shell }, esiste);
    assert.ok(s, `${shell}: nessuna virgoletta`);
    assert.equal(applica(x.riga, s), `/cd ${atteso}`, shell);
  }
});

test('solo un percorso intero che esiste, solo dentro un comando, mai dentro altre virgolette', async () => {
  const p = 'C:\\Users\\Nome Cognome';
  const { esiste, chiesti } = disco({ [p]: 'cartella', 'Nome Cognome': 'cartella' });
  const no = async (x, perche) => assert.equal(await V.virgoletteIncollando({ ...x, shell: 'powershell' }, esiste), null, perche);
  await no(incollato('/cd ', 'C:\\Users\\Mario Rossi'), 'un percorso che non esiste resta com\'è');
  await no(incollato('', p), 'la barra vuota non è un comando: è un messaggio per Filo');
  await no(incollato('apri ', p), 'una frase per Filo non si tocca');
  await no(incollato('/cd C:\\Users\\', 'Nome Cognome'), 'attaccato a un\'altra parola è un pezzo di percorso');
  await no(incollato('/cd ', p, 'x'), 'seguito da una parola attaccata non è intero');
  await no(incollato('/cd "', p, '"'), 'dentro virgolette già aperte non se ne aggiungono');
  await no(incollato('/cd ', `"${p}"`), 'già fra virgolette');
  await no(incollato('/cd ', 'C:\\Users\\Nome'), 'senza spazi non serve niente');
  assert.ok(!chiesti.includes('C:\\Users\\Nome'), 'per un percorso che non ne ha bisogno il disco non si interroga');
});

test('incollato con l\'a capo o gli spazi intorno, cambia solo il percorso', async () => {
  const p = '/home/Nome Cognome';
  const { esiste } = disco({ [p]: 'cartella' });
  const x = incollato('/ls ', ` ${p}\n`);
  const s = await V.virgoletteIncollando({ ...x, shell: 'sh' }, esiste);
  assert.equal(applica(x.riga, s), `/ls  "${p}"\n`);
});

test('dove la shell aspetta il programma, PowerShell vuole la & davanti (una sola)', async () => {
  const p = 'C:\\Program Files\\Filo\\filo.exe';
  const { esiste } = disco({ [p]: 'file' });
  const prova = async (prima, shell = 'powershell') => {
    const x = incollato(prima, p);
    const s = await V.virgoletteIncollando({ ...x, shell }, esiste);
    return applica(x.riga, s);
  };
  assert.equal(await prova('/'), `/& "${p}"`);
  assert.equal(await prova('/cd C:\\; '), `/cd C:\\; & "${p}"`);
  assert.equal(await prova('/& '), `/& "${p}"`, 'la & scritta dall\'utente basta');
  assert.equal(await prova('/', 'cmd'), `/"${p}"`);
  const q = '/opt/my app/run.sh';
  const x = incollato('/', q);
  const s = await V.virgoletteIncollando({ ...x, shell: 'sh' }, disco({ [q]: 'file' }).esiste);
  assert.equal(applica(x.riga, s), `/"${q}"`);
});

// ─────────────── dopo un comando fallito ───────────────

test('il resto della riga è una cartella che esiste: la proposta la mette fra virgolette', async () => {
  const casi = [
    ['powershell', 'cd C:\\Users\\Nome Cognome', { 'C:\\Users\\Nome Cognome': 'cartella' }, 'cd "C:\\Users\\Nome Cognome"'],
    ['cmd', 'dir C:\\Users\\Nome Cognome', { 'C:\\Users\\Nome Cognome': 'cartella' }, 'dir "C:\\Users\\Nome Cognome"'],
    ['sh', 'cd /home/Nome Cognome', { '/home/Nome Cognome': 'cartella' }, 'cd "/home/Nome Cognome"'],
    ['bash', 'ls -la /home/Nome Cognome/Foto', { '/home/Nome Cognome/Foto': 'cartella' }, 'ls -la "/home/Nome Cognome/Foto"'],
    ['sh', 'cd ~/Nome Cognome', { '~/Nome Cognome': 'cartella' }, 'cd ~/"Nome Cognome"'],
    ['sh', 'cd Nome Cognome', { 'Nome Cognome': 'cartella' }, 'cd "Nome Cognome"'],
  ];
  for (const [shell, comando, voci, atteso] of casi) {
    const p = await V.propostaVirgolette(comando, shell, disco(voci).esiste);
    assert.ok(p, `${shell} «${comando}»: nessuna proposta`);
    assert.equal(p.comando, atteso, shell);
    assert.equal(p.pezzi.map((x) => x.testo).join(''), atteso);
    assert.ok(p.pezzi.some((x) => x.aggiunto && /Nome Cognome/.test(x.testo)), 'il tratto riscritto è segnato');
  }
});

test('più percorsi, operatori, & e apostrofi nel nome', async () => {
  const sh = async (comando, voci) => (await V.propostaVirgolette(comando, 'sh', disco(voci).esiste))?.comando;
  assert.equal(await sh('cp /a b/c.txt /d e', { '/a b/c.txt': 'file', '/d e': 'cartella' }), 'cp "/a b/c.txt" "/d e"');
  assert.equal(await sh('cd /home/Nome Cognome && ls', { '/home/Nome Cognome': 'cartella' }), 'cd "/home/Nome Cognome" && ls');
  assert.equal(await sh('cd /x/Foto & Video', { '/x/Foto & Video': 'cartella' }), 'cd "/x/Foto & Video"');
  assert.equal(await sh("cd l'archivio", { "l'archivio": 'cartella' }), 'cd "l\'archivio"',
    'una virgoletta rimasta aperta è proprio l\'errore: lì è una lettera del nome');
  assert.equal(await sh('cd "/home/Nome Cognome"', { '/home/Nome Cognome': 'cartella' }), undefined, 'già fra virgolette');
  assert.equal(await sh('cd /home/Mario Rossi', {}), undefined, 'niente che esista: niente proposta');
  assert.equal(await sh('echo a\nb', { a: 'file' }), undefined);
});

test('un programma col percorso: PowerShell vuole la &, una cartella al suo posto non si propone', async () => {
  const exe = 'C:\\Program Files\\Filo\\filo.exe';
  const ps = async (comando, voci) => (await V.propostaVirgolette(comando, 'powershell', disco(voci).esiste))?.comando;
  assert.equal(await ps(`${exe} --version`, { [exe]: 'file' }), `& "${exe}" --version`);
  assert.equal(await ps(`& ${exe}`, { [exe]: 'file' }), `& "${exe}"`);
  assert.equal(await ps('C:\\Program Files', { 'C:\\Program Files': 'cartella' }), undefined);
});

test('una riga lunghissima non tiene fermo il disco: le domande hanno un tetto', async () => {
  const { esiste, chiesti } = disco({});
  const riga = `echo ${Array.from({ length: 400 }, (_, i) => `p${i}`).join(' ')}`;
  assert.equal(await V.propostaVirgolette(riga, 'sh', esiste), null);
  assert.ok(chiesti.length <= 2000, `${chiesti.length} domande`);
});

test('il programma della riga, per il colore: un percorso fra virgolette è uno solo', () => {
  assert.equal(V.primoComando('ls -la'), 'ls');
  assert.equal(V.primoComando('"C:\\Program Files\\a.exe" x'), 'C:\\Program Files\\a.exe');
  assert.equal(V.primoComando("& 'C:\\x y\\a.exe'"), 'C:\\x y\\a.exe');
  assert.equal(V.primoComando(" '/opt/my app/run.sh'"), '/opt/my app/run.sh');
  assert.equal(V.primoComando(''), '');
});

// ─────────────── il disco vero, dalla cartella del terminale ───────────────

test('il main guarda il disco dalla cartella del terminale, con la shell che gira davvero', async () => {
  const dir = cartellaTemporanea('filo-virgolette-');
  try {
    mkdirSync(join(dir, 'Nome Cognome'));
    writeFileSync(join(dir, 'Nome Cognome', 'dentro.txt'), 'x');
    const effettiva = T.resolveShell('powershell');
    assert.equal(await S.tipoDelPercorso('Nome Cognome', effettiva, dir), 'cartella');
    assert.equal(await S.tipoDelPercorso(join('Nome Cognome', 'dentro.txt'), effettiva, dir), 'file');
    assert.equal(await S.tipoDelPercorso('Mario Rossi', effettiva, dir), null);
    assert.equal(await S.tipoDelPercorso('~', effettiva, dir), 'cartella', 'la tilde è la casa dell\'utente');
    assert.ok(homedir());

    const p = await S.propostaVirgolette({ comando: 'cd Nome Cognome', shell: 'powershell', cwd: dir });
    assert.equal(p && p.comando, 'cd "Nome Cognome"');

    const assoluto = join(dir, 'Nome Cognome');
    const x = incollato('/ls ', assoluto);
    const s = await S.virgoletteIncollando({ ...x, shell: 'powershell', cwd: dir });
    assert.ok(s, 'il percorso assoluto incollato non ha preso le virgolette');
    assert.equal(applica(x.riga, s), `/ls ${V.quota(assoluto, effettiva)}`);
    assert.ok(/^\/ls ["']/.test(applica(x.riga, s)));
    assert.equal(await S.virgoletteIncollando({ riga: 42, inizio: 0, fine: 1, shell: 'sh', cwd: dir }), null);
    assert.equal(await S.propostaVirgolette({ comando: null, shell: 'sh', cwd: dir }), null);
  } finally {
    togliCartella(dir);
  }
});
