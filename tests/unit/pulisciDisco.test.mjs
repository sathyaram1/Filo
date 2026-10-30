// Sentinella della pulizia del disco (#1409): toglie solo cartelle di lavoro fuse, pulite e ferme e i resti delle prove
// vecchi di un giorno; il node_modules di tutti e il lavoro non salvato restano. Repo veri, in una temporanea sua.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cartellaTemporanea, collegaCartella, togliCartella } from '../helpers/percorsi.mjs';
import { cartellaSessioni, leggiArgomenti, leggiStato, main } from '../../scripts/pulisci-disco.mjs';
import { nomeDiProva } from '../../scripts/lib/nomi-temporanee.mjs';

const ORA = 60 * 60 * 1000;
const ADESSO = Date.now() + 10 * 24 * ORA;
const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const scrivi = (p, testo = 'x') => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, testo); return p; };
const giovane = (p) => { utimesSync(p, new Date(ADESSO - ORA), new Date(ADESSO - ORA)); return p; };

function repo(base, nome, file) {
  const origine = join(base, `${nome}.git`);
  const dir = join(base, nome);
  mkdirSync(origine);
  g(origine, 'init', '-q', '--bare');
  g(origine, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  g(base, 'clone', '-q', origine, dir);
  g(dir, 'config', 'user.email', 't@t');
  g(dir, 'config', 'user.name', 't');
  g(dir, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  for (const [p, t] of Object.entries(file)) scrivi(join(dir, p), t);
  g(dir, 'add', '-A');
  g(dir, 'commit', '-q', '-m', 'primo');
  g(dir, 'push', '-q', 'origin', 'main');
  return dir;
}

function albero(radice, nome, moduli = 'node_modules') {
  const dir = join(radice, '.claude', 'worktrees', nome);
  g(radice, 'worktree', 'add', '-q', '-b', `claude/${nome}`, dir, 'origin/main');
  collegaCartella(join(radice, moduli), join(dir, moduli));
  return dir;
}

function scena() {
  const base = cartellaTemporanea('filo-pulisci-');
  const ignora = 'node_modules\ntests/.shots/\ntests/agent/.env\n*.log\n.claude/worktrees/\n';
  const filo = repo(base, 'Filo', { '.gitignore': ignora, 'a.txt': 'a' });
  scrivi(join(filo, 'node_modules', 'segno.txt'));
  const server = repo(base, 'filo-security', { '.gitignore': ignora, 'functions/tools/server-fondi.js': '' });
  scrivi(join(server, 'functions', 'node_modules', 'segno.txt'));

  const wt = Object.fromEntries(['fusa', 'avanti', 'nuova', 'modificata', 'chiave', 'recente', 'sessione', 'bloccata', 'orchestra', 'sparita']
    .map((n) => [n, albero(filo, n)]));
  scrivi(join(wt.fusa, 'tests', '.shots', 'x.png'), 'p'.repeat(5000));
  scrivi(join(wt.fusa, '.claude', 'settings.local.json'), '{}');
  scrivi(join(wt.fusa, 'errore.log'));
  scrivi(join(wt.avanti, 'b.txt'));
  g(wt.avanti, 'add', '-A');
  g(wt.avanti, 'commit', '-q', '-m', 'non ancora fuso');
  scrivi(join(wt.nuova, 'appunti.txt'));
  scrivi(join(wt.modificata, 'a.txt'), 'cambiato');
  scrivi(join(wt.chiave, 'tests', 'agent', '.env'), 'OPENROUTER_API_KEY=x');
  giovane(join(wt.recente, 'a.txt'));
  const claude = join(base, 'claude');
  giovane(scrivi(join(cartellaSessioni(wt.sessione, claude), 'x.jsonl')));
  g(filo, 'worktree', 'lock', wt.bloccata);
  const note = join(base, 'orchestratore');
  scrivi(join(note, 'stato.json'), JSON.stringify({ coda: [77], pratiche: { 77: { num: 77, slug: 'orchestra', fase: 'lavoro' } } }));
  assert.ok(togliCartella(wt.sparita), 'la cartella da far sparire è ancora lì');
  const wtServer = albero(server, 'fusa', join('functions', 'node_modules'));

  const temp = join(base, 'tmp');
  const casa = join(base, 'casa');
  const fuori = join(base, 'fuori');
  scrivi(join(fuori, 'segno.txt'));
  const via = [join(temp, 'filo-bake-AbC123'), join(temp, 'filo-bake-con spazio-XyZ789'), join(temp, 'filo-consegna-0123456789ab'),
    join(casa, 'filo-x-con spazio-AbC123')];
  for (const d of via) scrivi(join(d, 'pezzo'), 'r'.repeat(1000));
  collegaCartella(fuori, join(via[0], 'collegato'));
  const restano = [join(temp, 'filo-lavori'), join(temp, 'filo-copie'), join(temp, 'filo-strumenti-1'), join(temp, 'altro-AbC123'),
    join(casa, 'filo-bake-AbC123')];
  for (const d of restano) mkdirSync(d, { recursive: true });
  mkdirSync(join(temp, 'filo-bake-Gi0v4n'));
  restano.push(giovane(join(temp, 'filo-bake-Gi0v4n')));
  restano.push(scrivi(join(temp, 'filo-bake-F1le00')));
  // Il resto di una prova sulla fusione: la sua cartella di lavoro non è fusa, ma è della prova, e se ne va con lei.
  const fusione = join(temp, 'filo-fusione-Ab12Cd');
  const prova = join(fusione, 'albero');
  g(filo, 'worktree', 'add', '-q', '--detach', prova, 'origin/main');
  scrivi(join(prova, 'c.txt'));
  g(prova, 'add', '-A');
  g(prova, 'commit', '-q', '-m', 'prova sulla fusione');
  collegaCartella(join(filo, 'node_modules'), join(fusione, 'node_modules'));
  via.push(fusione);

  const righe = [];
  const P = { radice: filo, serverRadice: server, note, wt: (s) => join(filo, '.claude', 'worktrees', s), wtServer: (s) => join(server, '.claude', 'worktrees', s) };
  const dep = (statfs) => ({ percorsi: P, claude, temp, casa, adesso: ADESSO, statfs, log: (r) => righe.push(r) });
  return { filo, server, wt, wtServer, via, restano, fuori, righe, dep };
}

const DISCO_PIENO = () => ({ bavail: 2, bsize: 1024 ** 3, blocks: 476 });
const DISCO_LARGO = () => ({ bavail: 200, bsize: 1024 ** 3, blocks: 476 });
const riga = (righe, pezzo) => righe.find((r) => r.includes(pezzo)) || '';
const rel = (...p) => join('.claude', 'worktrees', ...p);

test('senza --togli elenca cosa toglierebbe e perché il resto resta, e non tocca niente', async () => {
  const s = scena();
  assert.equal(await main([], s.dep(DISCO_PIENO)), 0, s.righe.join('\n'));
  for (const d of [...Object.values(s.wt).filter((d) => d !== s.wt.sparita), s.wtServer, ...s.via, ...s.restano]) {
    assert.ok(existsSync(d), `un elenco ha tolto ${d}`);
  }
  assert.match(s.righe.join('\n'), /da togliere, 1 \(/);
  assert.match(riga(s.righe, rel('fusa')), /claude\/fusa · \d/);
  const attesi = {
    avanti: /non ancora su main/,
    nuova: /file nuovi non salvati: appunti\.txt/,
    modificata: /modifiche non salvate: a\.txt/,
    chiave: /file fuori da git che non si rifanno da soli: tests\/agent\/\.env/,
    recente: /usata il .*meno di 2 giorni fa/,
    sessione: /usata il .*sessione aperta/,
    bloccata: /bloccata/,
    orchestra: /lavoro #77 dell'orchestratore non chiuso/,
  };
  for (const [n, re] of Object.entries(attesi)) assert.match(riga(s.righe, rel(n)), re, `${n}:\n${s.righe.join('\n')}`);
  assert.match(riga(s.righe, '1 senza più la cartella'), /git le dimentica/);
  assert.match(riga(s.righe, 'delle prove, dentro'), /^ {2}1 delle prove, dentro i loro resti: se ne vanno con loro$/);
  assert.equal(riga(s.righe, 'filo-fusione-Ab12Cd'), '', 'la cartella di lavoro di una prova giudicata come quella di una sessione');
  assert.match(riga(s.righe, 'Resti delle prove'), /: 5 \(/);
  assert.match(riga(s.righe, 'Libero adesso'), /2 GB su 476 GB \(0%\); dopo la pulizia circa/);
  assert.match(riga(s.righe, 'Sotto il 5%'), /anche dopo: il resto del disco non sono file di Filo/);
  assert.match(s.righe.at(-1), /npm run pulisci:disco -- --togli/);
});

test('con --togli toglie le cartelle fuse, pulite e ferme e i resti vecchi, senza svuotare quello a cui puntano', async () => {
  const s = scena();
  assert.equal(await main(['--togli'], s.dep(DISCO_PIENO)), 0, s.righe.join('\n'));
  assert.ok(!existsSync(s.wt.fusa), 'la cartella fusa, pulita e ferma è rimasta');
  assert.ok(!existsSync(s.wtServer), 'quella del server è rimasta');
  for (const d of s.via) assert.ok(!existsSync(d), `resto delle prove rimasto: ${d}`);
  for (const d of ['avanti', 'nuova', 'modificata', 'chiave', 'recente', 'sessione', 'bloccata', 'orchestra']) {
    assert.ok(existsSync(s.wt[d]), `tolta una cartella che doveva restare: ${d}`);
  }
  for (const d of s.restano) assert.ok(existsSync(d), `tolta una cosa che non è un resto delle prove: ${d}`);
  assert.ok(existsSync(join(s.wt.nuova, 'appunti.txt')) && existsSync(join(s.wt.chiave, 'tests', 'agent', '.env')));
  assert.ok(existsSync(join(s.filo, 'node_modules', 'segno.txt')), 'svuotato il node_modules di Filo');
  assert.ok(existsSync(join(s.server, 'functions', 'node_modules', 'segno.txt')), 'svuotato il node_modules del server');
  assert.ok(existsSync(join(s.fuori, 'segno.txt')), 'svuotata la cartella a cui puntava un collegamento dentro un resto');
  const elenco = g(s.filo, 'worktree', 'list', '--porcelain');
  assert.ok(!/worktrees[\\/](fusa|sparita)\b|filo-fusione/.test(elenco), `git ricorda ancora le cartelle tolte:\n${elenco}`);
  assert.match(g(s.filo, 'branch', '--list', 'claude/fusa'), /claude\/fusa/, 'il ramo resta: si può riaprire la cartella');
  assert.match(riga(s.righe, 'Tolti: '), /1 cartella di lavoro di Filo, 1 cartella di lavoro del server, 5 resti delle prove; liberati \d/);
  assert.match(riga(s.righe, 'Libero alla fine'), /2 GB su 476 GB/);
  assert.match(riga(s.righe, 'Sotto il 5%:'), /il resto del disco non sono file di Filo, va liberato a mano/);
});

test('sopra il 5% libero non chiede di liberare altro', async () => {
  const s = scena();
  assert.equal(await main(['--togli'], s.dep(DISCO_LARGO)), 0, s.righe.join('\n'));
  assert.match(riga(s.righe, 'Libero alla fine'), /200 GB su 476 GB \(42%\)/);
  assert.equal(riga(s.righe, 'Sotto il'), '');
});

test('git status si legge col suo formato: lo spazio in testa, le rinomine e i nomi con gli spazi', () => {
  assert.deepEqual(leggiStato(' M a.txt\u0000R  nuovo.txt\u0000vecchio.txt\u0000?? b c.txt\u0000!! node_modules\u0000'),
    { modifiche: ['a.txt', 'nuovo.txt'], nuovi: ['b c.txt'], ignorati: ['node_modules'] });
});

test('i resti delle prove si riconoscono dal nome, e i nomi di chi lavora no', () => {
  for (const n of ['filo-bake-AbC123', 'filo-bake-642-con spazio-AbC123', 'filo-consegna-1801ebd5e609', 'filo-corsa-Q1w2E3',
    'copia-con spazio-AbC123', 'filo-fusione-Ab12Cd']) assert.ok(nomeDiProva(n), n);
  for (const n of ['filo-lavori', 'filo-strumenti', 'filo-strumenti-1', 'filo-copie', 'filo-feedback', 'filo-security', 'altro-AbC123',
    'filo-bake-AbC12', 'Filo']) assert.ok(!nomeDiProva(n), n);
});

test('gli argomenti sbagliati si rifiutano col perché', async () => {
  assert.match(leggiArgomenti(['--giorni', '0']).errore, /da 1 in su/);
  assert.match(leggiArgomenti(['--tutto']).errore, /non conosco: --tutto/);
  assert.deepEqual(leggiArgomenti(['--togli', '--giorni', '5']), { togli: true, giorni: 5 });
  const righe = [];
  assert.equal(await main(['--giorni'], { log: (r) => righe.push(r) }), 2);
  assert.match(righe.join('\n'), /Uso: npm run pulisci:disco/);
});
