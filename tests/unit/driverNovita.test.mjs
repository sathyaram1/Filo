// Nel rebase di chi riallinea un ramo un conflitto sul solo registro delle novità si risolve da sé, con la regola del
// cancello (#2224): prima ogni fusione su main costava un giro di correzione per una riga di changelog.

import '../helpers/senzaSessione.mjs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { COMANDO, NOME, SCRIPT, ensureDriverNovita, etichettaDaFatti, unisciNelRebase } from '../../scripts/lib/driver-novita.mjs';
import { registroDa } from '../../scripts/lib/novita-in-cima.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NOVITA = 'src/shared/patchNotes.js';
const fatte = [];
after(() => { for (const d of fatte) togliCartella(d); });

const scritta = (r) => (typeof r === 'string' ? `'${r}'` : `{ testo: '${r.testo}', segnalazione: ${r.segnalazione} }`);
function sorgente(blocchi) {
  const corpo = blocchi.map((b) => {
    let s = `    {\n      version: '${b.v}', date: '2026-11-01',\n`;
    for (const k of ['features', 'fixes']) if (b[k]) s += `      ${k}: [\n${b[k].map((r) => `        ${scritta(r)},\n`).join('')}      ],\n`;
    return `${s}    },\n`;
  }).join('');
  return `(function (global) {\n  'use strict';\n\n  const NOTES = [\n${corpo}  ];\n\n  global.SN_PATCH_NOTES = { NOTES };\n})(typeof globalThis !== 'undefined' ? globalThis : self);\n`;
}
const blocchi = (src) => JSON.parse(JSON.stringify(registroDa(src))).map((n) => [n.version, n.features || [], n.fixes || []]);

function git(cwd, args, { ok = true } = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (ok && r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr || r.stdout}`);
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}
function scrivi(dir, rel, testo) {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), testo, 'utf8');
}
const committa = (dir, msg) => { git(dir, ['add', '-A']); git(dir, ['commit', '-qm', msg]); };
const leggi = (dir) => readFileSync(join(dir, NOVITA), 'utf8');
const inConflitto = (dir) => git(dir, ['diff', '--name-only', '--diff-filter=U']).out.split('\n').filter(Boolean).sort();

/**
 * origin con main alla 0.2.10 e il blocco 0.2.11 in cima, e un clone `work` preparato come quelli dei worker. `strumenti`:
 * l'albero porta il driver vero (falso = un albero vecchio, nato prima del driver).
 */
function scena({ driver = true, strumenti = true } = {}) {
  const casa = cartellaTemporanea('driver-novita-');
  fatte.push(casa);
  const origin = join(casa, 'origin.git');
  const work = join(casa, 'work');
  const altro = join(casa, 'altro');
  mkdirSync(origin);
  mkdirSync(work);
  git(origin, ['init', '--bare', '-q', '--initial-branch=main']);
  git(work, ['init', '-q', '--initial-branch=main']);
  for (const d of [work]) { git(d, ['config', 'user.email', 'prova@filo.invalid']); git(d, ['config', 'user.name', 'prova']); }
  git(work, ['remote', 'add', 'origin', origin]);
  copyFileSync(join(REPO, '.gitattributes'), join(work, '.gitattributes'));
  if (strumenti) {
    for (const f of [SCRIPT, 'scripts/lib/driver-novita.mjs', 'src/shared/novitaFusione.js']) scrivi(work, f, readFileSync(join(REPO, f), 'utf8'));
  }
  scrivi(work, 'package.json', '{\n  "name": "filo",\n  "version": "0.2.10"\n}\n');
  scrivi(work, 'valore.txt', 'uno\n');
  scrivi(work, NOVITA, sorgente([{ v: '0.2.11', features: ['a'] }, { v: '0.2.10', features: ['vecchia'] }]));
  committa(work, 'inizio');
  git(work, ['push', '-q', 'origin', 'main']);
  if (driver) assert.deepEqual(ensureDriverNovita(work), { ok: true, cambiato: true });
  git(origin, ['clone', '-q', origin, altro]);
  git(altro, ['config', 'user.email', 'altro@filo.invalid']);
  git(altro, ['config', 'user.name', 'altro']);
  /** Una fusione arrivata su main da un'altra sessione mentre il ramo aspettava. */
  const suMain = (fai, msg = 'fusione di un altro ramo') => { git(altro, ['pull', '-q', '--ff-only']); fai(altro); committa(altro, msg); git(altro, ['push', '-q', 'origin', 'main']); };
  return { work, altro, suMain };
}

test('il caso della segnalazione: due rami scrivono nello stesso blocco, il rebase del secondo va liscio e tiene le due righe', () => {
  const s = scena();
  git(s.work, ['checkout', '-qb', 'worker/secondo']);
  scrivi(s.work, NOVITA, sorgente([{ v: '0.2.11', features: ['a', 'del secondo'] }, { v: '0.2.10', features: ['vecchia'] }]));
  scrivi(s.work, 'nuovo.txt', 'lavoro\n');
  committa(s.work, 'il lavoro del secondo');
  s.suMain((d) => scrivi(d, NOVITA, sorgente([{ v: '0.2.11', features: ['a', 'del primo'], fixes: ['correzione del primo'] }, { v: '0.2.10', features: ['vecchia'] }])));
  git(s.work, ['fetch', '-q', 'origin', 'main']);
  const r = git(s.work, ['rebase', 'origin/main'], { ok: false });
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(blocchi(leggi(s.work)), [['0.2.11', ['a', 'del primo', 'del secondo'], ['correzione del primo']], ['0.2.10', ['vecchia'], []]]);
  assert.equal(git(s.work, ['status', '--porcelain']).out, '');
  assert.equal(git(s.work, ['merge-base', '--is-ancestor', 'origin/main', 'HEAD'], { ok: false }).status, 0, 'il ramo sta sopra main');
  assert.equal(git(s.work, ['diff', '--name-only', 'origin/main', 'HEAD']).out.split('\n').filter(Boolean).sort().join(','), `nuovo.txt,${NOVITA}`);
});

test('più commit del ramo sul registro e una riga già arrivata su main: nessuna riga persa, nessun doppione', () => {
  const s = scena();
  git(s.work, ['checkout', '-qb', 'worker/lungo']);
  scrivi(s.work, NOVITA, sorgente([{ v: '0.2.11', features: ['a', 'uno'] }, { v: '0.2.10', features: ['vecchia'] }]));
  committa(s.work, 'prima riga');
  scrivi(s.work, NOVITA, sorgente([{ v: '0.2.11', features: ['a', 'uno', 'due'] }, { v: '0.2.10', features: ['vecchia'] }]));
  committa(s.work, 'seconda riga');
  s.suMain((d) => scrivi(d, NOVITA, sorgente([{ v: '0.2.11', features: ['a', 'di main', 'due'] }, { v: '0.2.10', features: ['vecchia'] }])));
  git(s.work, ['fetch', '-q', 'origin', 'main']);
  const r = git(s.work, ['rebase', 'origin/main'], { ok: false });
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(blocchi(leggi(s.work))[0], ['0.2.11', ['a', 'di main', 'due', 'uno'], []]);
});

// Il salvataggio automatico fa un commit per ogni modifica: la riga scritta e poi ritoccata arriva come due commit.
test('la riga del ramo scritta e poi ritoccata in un altro commit: il rebase va liscio e tiene la versione ritoccata', () => {
  const s = scena();
  git(s.work, ['checkout', '-qb', 'worker/ritocco']);
  scrivi(s.work, NOVITA, sorgente([{ v: '0.2.11', features: ['a', 'del ramo'] }, { v: '0.2.10', features: ['vecchia'] }]));
  committa(s.work, 'auto: src/shared/patchNotes.js');
  scrivi(s.work, NOVITA, sorgente([{ v: '0.2.11', features: ['a', 'del ramo, ritoccata'] }, { v: '0.2.10', features: ['vecchia'] }]));
  committa(s.work, 'auto: src/shared/patchNotes.js');
  s.suMain((d) => scrivi(d, NOVITA, sorgente([{ v: '0.2.11', features: ['a', 'di main'] }, { v: '0.2.10', features: ['vecchia'] }])));
  git(s.work, ['fetch', '-q', 'origin', 'main']);
  const r = git(s.work, ['rebase', 'origin/main'], { ok: false });
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(blocchi(leggi(s.work)), [['0.2.11', ['a', 'di main', 'del ramo, ritoccata'], []], ['0.2.10', ['vecchia'], []]]);
  // Il rebase seguente rigioca gli stessi due commit: non si ferma di nuovo.
  s.suMain((d) => scrivi(d, NOVITA, sorgente([{ v: '0.2.11', features: ['a', 'di main', 'ancora di main'] }, { v: '0.2.10', features: ['vecchia'] }])));
  git(s.work, ['fetch', '-q', 'origin', 'main']);
  const di = git(s.work, ['rebase', 'origin/main'], { ok: false });
  assert.equal(di.status, 0, di.out);
  assert.deepEqual(blocchi(leggi(s.work))[0], ['0.2.11', ['a', 'di main', 'ancora di main', 'del ramo, ritoccata'], []]);
});

test('un ramo già riallineato col commit che ha portato la sua riga in cima: il rebase seguente va liscio', () => {
  const s = scena();
  s.suMain((d) => {
    scrivi(d, 'package.json', '{\n  "name": "filo",\n  "version": "0.2.11"\n}\n');
    scrivi(d, NOVITA, sorgente([{ v: '0.2.12', features: ['di main'] }, { v: '0.2.11', features: ['a'] }, { v: '0.2.10', features: ['vecchia'] }]));
  }, 'esce la 0.2.11');
  git(s.work, ['fetch', '-q', 'origin', 'main']);
  git(s.work, ['checkout', '-qb', 'worker/riallineato', 'origin/main']);
  scrivi(s.work, NOVITA, sorgente([{ v: '0.2.12', features: ['di main'] }, { v: '0.2.11', features: ['a', 'del ramo'] }, { v: '0.2.10', features: ['vecchia'] }]));
  committa(s.work, 'il lavoro, riallineato con la riga rimasta sotto la versione uscita');
  scrivi(s.work, NOVITA, sorgente([{ v: '0.2.12', features: ['di main', 'del ramo'] }, { v: '0.2.11', features: ['a'] }, { v: '0.2.10', features: ['vecchia'] }]));
  committa(s.work, 'novità: una riga del ramo da versioni uscite al blocco 0.2.12');
  s.suMain((d) => scrivi(d, NOVITA, sorgente([{ v: '0.2.12', features: ['di main', 'altra'] }, { v: '0.2.11', features: ['a'] }, { v: '0.2.10', features: ['vecchia'] }])));
  git(s.work, ['fetch', '-q', 'origin', 'main']);
  const r = git(s.work, ['rebase', 'origin/main'], { ok: false });
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(blocchi(leggi(s.work)).map((b) => [b[0], b[1]]), [['0.2.12', ['di main', 'altra', 'del ramo']], ['0.2.11', ['a']], ['0.2.10', ['vecchia']]]);
});

test('main intanto ha pubblicato il blocco del ramo: nel rebase la riga va nel blocco della prossima versione', () => {
  const s = scena();
  git(s.work, ['checkout', '-qb', 'worker/tardi']);
  scrivi(s.work, NOVITA, sorgente([{ v: '0.2.11', features: ['a', 'del ramo'] }, { v: '0.2.10', features: ['vecchia'] }]));
  committa(s.work, 'il lavoro');
  s.suMain((d) => {
    scrivi(d, 'package.json', '{\n  "name": "filo",\n  "version": "0.2.11"\n}\n');
    scrivi(d, NOVITA, sorgente([{ v: '0.2.12', features: ['di main'] }, { v: '0.2.11', features: ['a', 'uscita'] }, { v: '0.2.10', features: ['vecchia'] }]));
  }, 'esce la 0.2.11');
  git(s.work, ['fetch', '-q', 'origin', 'main']);
  const r = git(s.work, ['rebase', 'origin/main'], { ok: false });
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(blocchi(leggi(s.work)).map((b) => [b[0], b[1]]), [['0.2.12', ['di main', 'del ramo']], ['0.2.11', ['a', 'uscita']], ['0.2.10', ['vecchia']]]);
});

test('un conflitto in un altro file ferma ancora il rebase, e solo su quel file', () => {
  const s = scena();
  git(s.work, ['checkout', '-qb', 'worker/due']);
  scrivi(s.work, NOVITA, sorgente([{ v: '0.2.11', features: ['a', 'del ramo'] }, { v: '0.2.10', features: ['vecchia'] }]));
  scrivi(s.work, 'valore.txt', 'tre\n');
  committa(s.work, 'il lavoro');
  s.suMain((d) => {
    scrivi(d, NOVITA, sorgente([{ v: '0.2.11', features: ['a', 'di main'] }, { v: '0.2.10', features: ['vecchia'] }]));
    scrivi(d, 'valore.txt', 'quattro\n');
  });
  git(s.work, ['fetch', '-q', 'origin', 'main']);
  const r = git(s.work, ['rebase', 'origin/main'], { ok: false });
  assert.notEqual(r.status, 0, 'il conflitto vero resta un conflitto');
  assert.deepEqual(inConflitto(s.work), ['valore.txt']);
  assert.deepEqual(blocchi(leggi(s.work))[0], ['0.2.11', ['a', 'di main', 'del ramo'], []]);
  git(s.work, ['rebase', '--abort']);
});

test('una riga uscita riscritta dal ramo non si unisce a macchina: il rebase si ferma coi marcatori di git', () => {
  const s = scena();
  git(s.work, ['checkout', '-qb', 'worker/riscritta']);
  scrivi(s.work, NOVITA, sorgente([{ v: '0.2.11', features: ['A riscritta'] }, { v: '0.2.10', features: ['vecchia'] }]));
  committa(s.work, 'riscrive una riga');
  s.suMain((d) => scrivi(d, NOVITA, sorgente([{ v: '0.2.11', features: ['A di main'] }, { v: '0.2.10', features: ['vecchia'] }])));
  git(s.work, ['fetch', '-q', 'origin', 'main']);
  const sha = git(s.work, ['rev-parse', '--short', 'HEAD']).out.trim();
  const r = git(s.work, ['rebase', 'origin/main'], { ok: false });
  assert.notEqual(r.status, 0);
  assert.deepEqual(inConflitto(s.work), [NOVITA]);
  const testo = leggi(s.work);
  assert.match(testo, /^<<<<<<< HEAD$/m);
  assert.match(testo, new RegExp(`^>>>>>>> ${sha} \\(riscrive una riga\\)$`, 'm'), 'i lati si chiamano come li chiama git');
  assert.match(testo, /'A riscritta'/);
  assert.match(testo, /'A di main'/);
  git(s.work, ['rebase', '--abort']);
});

test('fuori dal rebase (la fusione di prova degli unit, quella di un ramo) il driver fa la fusione di testo di git', () => {
  const s = scena();
  git(s.work, ['checkout', '-qb', 'worker/fusione']);
  scrivi(s.work, NOVITA, sorgente([{ v: '0.2.11', features: ['a', 'del ramo'] }, { v: '0.2.10', features: ['vecchia'] }]));
  committa(s.work, 'il lavoro');
  s.suMain((d) => scrivi(d, NOVITA, sorgente([{ v: '0.2.11', features: ['a', 'di main'] }, { v: '0.2.10', features: ['vecchia'] }])));
  git(s.work, ['fetch', '-q', 'origin', 'main']);
  git(s.work, ['checkout', '-q', '--detach', 'origin/main']);
  const r = git(s.work, ['merge', '--no-ff', '--no-edit', 'worker/fusione'], { ok: false });
  assert.notEqual(r.status, 0, 'la prova sulla fusione vede il conflitto e lo risolve con la regola del server');
  assert.deepEqual(inConflitto(s.work), [NOVITA]);
  assert.match(leggi(s.work), /^<<<<<<< HEAD$/m);
  git(s.work, ['merge', '--abort']);
});

test('dove il driver non è impostato (Actions, GitHub) l’attributo non cambia niente: il conflitto è quello di git', () => {
  const s = scena({ driver: false });
  git(s.work, ['checkout', '-qb', 'worker/senza']);
  scrivi(s.work, NOVITA, sorgente([{ v: '0.2.11', features: ['a', 'del ramo'] }, { v: '0.2.10', features: ['vecchia'] }]));
  committa(s.work, 'il lavoro');
  s.suMain((d) => scrivi(d, NOVITA, sorgente([{ v: '0.2.11', features: ['a', 'di main'] }, { v: '0.2.10', features: ['vecchia'] }])));
  git(s.work, ['fetch', '-q', 'origin', 'main']);
  const r = git(s.work, ['rebase', 'origin/main'], { ok: false });
  assert.notEqual(r.status, 0);
  assert.deepEqual(inConflitto(s.work), [NOVITA]);
  assert.match(leggi(s.work), /^<<<<<<< HEAD$/m);
  git(s.work, ['rebase', '--abort']);
});

test('un albero senza lo script del driver non resta mai col lato di main muto: conflitto coi marcatori', () => {
  const s = scena({ strumenti: false });
  git(s.work, ['checkout', '-qb', 'worker/vecchio']);
  scrivi(s.work, NOVITA, sorgente([{ v: '0.2.11', features: ['a', 'del ramo'] }, { v: '0.2.10', features: ['vecchia'] }]));
  committa(s.work, 'il lavoro');
  s.suMain((d) => scrivi(d, NOVITA, sorgente([{ v: '0.2.11', features: ['a', 'di main'] }, { v: '0.2.10', features: ['vecchia'] }])));
  git(s.work, ['fetch', '-q', 'origin', 'main']);
  const r = git(s.work, ['rebase', 'origin/main'], { ok: false });
  assert.notEqual(r.status, 0);
  assert.deepEqual(inConflitto(s.work), [NOVITA]);
  assert.match(leggi(s.work), /'del ramo'[\s\S]*>>>>>>>|>>>>>>>[\s\S]*'del ramo'/);
  assert.match(leggi(s.work), /'di main'/);
  git(s.work, ['rebase', '--abort']);
});

test('uno script del driver che non arriva in fondo (node che non parte, un errore) lascia i marcatori, mai il solo lato di main', () => {
  const s = scena();
  git(s.work, ['checkout', '-qb', 'worker/rotto']);
  scrivi(s.work, NOVITA, sorgente([{ v: '0.2.11', features: ['a', 'del ramo'] }, { v: '0.2.10', features: ['vecchia'] }]));
  committa(s.work, 'il lavoro');
  s.suMain((d) => {
    scrivi(d, SCRIPT, "throw new Error('driver rotto');\n");
    scrivi(d, NOVITA, sorgente([{ v: '0.2.11', features: ['a', 'di main'] }, { v: '0.2.10', features: ['vecchia'] }]));
  });
  git(s.work, ['fetch', '-q', 'origin', 'main']);
  const r = git(s.work, ['rebase', 'origin/main'], { ok: false });
  assert.notEqual(r.status, 0);
  assert.deepEqual(inConflitto(s.work), [NOVITA]);
  const testo = leggi(s.work);
  assert.match(testo, /^<<<<<<< /m);
  assert.match(testo, /'del ramo'/, 'la riga del ramo resta davanti a chi risolve');
  assert.match(testo, /'di main'/);
  git(s.work, ['rebase', '--abort']);
});

test('la config: idempotente, e il comando è quello del modulo', () => {
  const s = scena();
  assert.deepEqual(ensureDriverNovita(s.work), { ok: true, cambiato: false });
  assert.equal(git(s.work, ['config', '--get', `merge.${NOME}.driver`]).out.trim(), COMANDO);
  git(s.work, ['config', '--add', `merge.${NOME}.driver`, 'un altro']);
  assert.deepEqual(ensureDriverNovita(s.work), { ok: true, cambiato: true });
  assert.equal(git(s.work, ['config', '--get-all', `merge.${NOME}.driver`]).out.trim(), COMANDO);
});

test('il repo dichiara il driver sul registro, e lo imposta ovunque nasce una copia di lavoro', () => {
  const attributi = readFileSync(join(REPO, '.gitattributes'), 'utf8');
  assert.match(attributi, new RegExp(`^${NOVITA.replace(/[.]/g, '\\.')} merge=${NOME}$`, 'm'));
  const chiamate = {
    'scripts/lib/clone-worker.mjs': /preparaCopia\(dir\);/,
    'scripts/lib/branch-integrity.mjs': /preparaCopia\(root\);/,
    'scripts/orchestratore-locale.mjs': /\[P\.radice, P\.serverRadice\]\.filter\(Boolean\)\) preparaCopia\(radice\);/,
    '.claude/hooks/session-start.sh': /node scripts\/prepara-copia\.mjs/,
  };
  for (const [f, re] of Object.entries(chiamate)) assert.match(readFileSync(join(REPO, f), 'utf8'), re, f);
});

// Una strada nuova che preparasse una copia col solo carattere di commento lascerebbe il rebase senza driver.
test('i due pezzi della config della copia li chiama solo il passo unico', () => {
  const ammessi = new Set(['scripts/lib/prepara-copia.mjs', 'scripts/lib/carattere-commento.mjs', 'scripts/lib/driver-novita.mjs']);
  const visti = [];
  const giro = (dir) => {
    for (const e of readdirSync(join(REPO, dir), { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) { if (e.name !== 'node_modules') giro(p); continue; }
      if (!/\.(mjs|js|cjs|sh)$/.test(e.name) || ammessi.has(p)) continue;
      if (/\b(ensureCommentChar|ensureDriverNovita)\b/.test(readFileSync(join(REPO, p), 'utf8'))) visti.push(p);
    }
  };
  for (const d of ['scripts', '.claude/hooks', 'routines']) giro(d);
  assert.deepEqual(visti, []);
});

test('l’unione nel rebase: «ours» è la base nuova, «theirs» il commit del ramo', () => {
  const base = sorgente([{ v: '0.2.11', features: ['a'] }]);
  const r = unisciNelRebase({
    base,
    ours: sorgente([{ v: '0.2.11', features: ['a', 'di main'] }]),
    theirs: sorgente([{ v: '0.2.11', features: ['a', 'del ramo'] }]),
    manifesto: { version: '0.2.10' },
    oggi: '2026-11-17',
  });
  assert.equal(r.ok, true, r.motivo);
  assert.deepEqual(blocchi(r.src)[0], ['0.2.11', ['a', 'di main', 'del ramo'], []]);
  assert.equal(unisciNelRebase({ base, ours: base, theirs: 'non è un registro', manifesto: { version: '0.2.10' }, oggi: '2026-11-17' }).ok, false);
});

test('il nome del commit in corso si legge dall’elenco del rebase', () => {
  assert.equal(etichettaDaFatti('pick 1234567 primo\npick abcdef0 # il secondo\n'), 'abcdef0 (il secondo)');
  assert.equal(etichettaDaFatti('pick abcdef0 titolo con (parentesi)\n'), 'abcdef0 (titolo con (parentesi))');
  assert.equal(etichettaDaFatti(''), 'theirs');
});
