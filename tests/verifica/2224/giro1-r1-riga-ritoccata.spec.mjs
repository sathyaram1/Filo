// #2224 giro 1, rilievo 1: nel rebase il registro delle novità si ferma ancora quando un commit successivo del ramo
// ritocca la riga che il ramo stesso aveva scritto (il salvataggio automatico ne fa un commit per ogni modifica).

import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';
import { SCRIPT, ensureDriverNovita } from '../../../scripts/lib/driver-novita.mjs';
import { registroDa } from '../../../scripts/lib/novita-in-cima.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const NOVITA = 'src/shared/patchNotes.js';
const fatte = [];
test.afterAll(() => { for (const d of fatte) togliCartella(d); });

function sorgente(blocchi) {
  const corpo = blocchi.map((b) => {
    let s = `    {\n      version: '${b.v}', date: '2026-11-01',\n`;
    for (const k of ['features', 'fixes']) if (b[k]) s += `      ${k}: [\n${b[k].map((r) => `        '${r}',\n`).join('')}      ],\n`;
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
function scrivi(dir, rel, testo) { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), testo, 'utf8'); }
const committa = (dir, msg) => { git(dir, ['add', '-A']); git(dir, ['commit', '-qm', msg]); };

// origin con main alla 0.2.10 e il blocco 0.2.11 in cima; `work` preparato come il clone di un worker, col driver.
function scena() {
  const casa = cartellaTemporanea('verifica-2224-');
  fatte.push(casa);
  const origin = join(casa, 'origin.git');
  const work = join(casa, 'work');
  const altro = join(casa, 'altro');
  mkdirSync(origin);
  mkdirSync(work);
  git(origin, ['init', '--bare', '-q', '--initial-branch=main']);
  git(work, ['init', '-q', '--initial-branch=main']);
  git(work, ['config', 'user.email', 'prova@filo.invalid']);
  git(work, ['config', 'user.name', 'prova']);
  git(work, ['remote', 'add', 'origin', origin]);
  copyFileSync(join(REPO, '.gitattributes'), join(work, '.gitattributes'));
  for (const f of [SCRIPT, 'scripts/lib/driver-novita.mjs', 'src/shared/novitaFusione.js']) scrivi(work, f, readFileSync(join(REPO, f), 'utf8'));
  scrivi(work, 'package.json', '{\n  "name": "filo",\n  "version": "0.2.10"\n}\n');
  scrivi(work, NOVITA, sorgente([{ v: '0.2.11', features: ['a'] }, { v: '0.2.10', features: ['vecchia'] }]));
  committa(work, 'inizio');
  git(work, ['push', '-q', 'origin', 'main']);
  expect(ensureDriverNovita(work).ok).toBe(true);
  git(origin, ['clone', '-q', origin, altro]);
  git(altro, ['config', 'user.email', 'altro@filo.invalid']);
  git(altro, ['config', 'user.name', 'altro']);
  const suMain = (testo) => { scrivi(altro, NOVITA, testo); committa(altro, 'fusione di un altro ramo'); git(altro, ['push', '-q', 'origin', 'main']); };
  return { work, suMain };
}

test('r1 la riga del ramo scritta e poi ritoccata in un secondo commit: il rebase va liscio e tiene le righe dei due lati', () => {
  const s = scena();
  git(s.work, ['checkout', '-qb', 'worker/ritocco']);
  scrivi(s.work, NOVITA, sorgente([{ v: '0.2.11', features: ['a', 'del ramo'] }, { v: '0.2.10', features: ['vecchia'] }]));
  committa(s.work, 'auto: src/shared/patchNotes.js');
  scrivi(s.work, NOVITA, sorgente([{ v: '0.2.11', features: ['a', 'del ramo, ritoccata'] }, { v: '0.2.10', features: ['vecchia'] }]));
  committa(s.work, 'auto: src/shared/patchNotes.js');
  s.suMain(sorgente([{ v: '0.2.11', features: ['a', 'di main'] }, { v: '0.2.10', features: ['vecchia'] }]));
  git(s.work, ['fetch', '-q', 'origin', 'main']);
  const r = git(s.work, ['rebase', 'origin/main'], { ok: false });
  expect(r.status, r.out).toBe(0);
  expect(blocchi(readFileSync(join(s.work, NOVITA), 'utf8'))).toEqual([
    ['0.2.11', ['a', 'di main', 'del ramo, ritoccata'], []],
    ['0.2.10', ['vecchia'], []],
  ]);
});

test('r1 un ramo già riallineato col commit che ha portato la sua riga in cima: il rebase seguente va liscio', () => {
  const s = scena();
  s.suMain(sorgente([{ v: '0.2.12', features: ['di main'] }, { v: '0.2.11', features: ['a'] }, { v: '0.2.10', features: ['vecchia'] }]));
  git(s.work, ['fetch', '-q', 'origin', 'main']);
  git(s.work, ['checkout', '-qb', 'worker/riallineato', 'origin/main']);
  scrivi(s.work, NOVITA, sorgente([{ v: '0.2.12', features: ['di main'] }, { v: '0.2.11', features: ['a', 'del ramo'] }, { v: '0.2.10', features: ['vecchia'] }]));
  committa(s.work, 'il lavoro, riallineato con la riga rimasta sotto la versione uscita');
  scrivi(s.work, NOVITA, sorgente([{ v: '0.2.12', features: ['di main', 'del ramo'] }, { v: '0.2.11', features: ['a'] }, { v: '0.2.10', features: ['vecchia'] }]));
  committa(s.work, 'novità: una riga del ramo da versioni uscite al blocco 0.2.12');
  s.suMain(sorgente([{ v: '0.2.12', features: ['di main', 'altra'] }, { v: '0.2.11', features: ['a'] }, { v: '0.2.10', features: ['vecchia'] }]));
  git(s.work, ['fetch', '-q', 'origin', 'main']);
  const r = git(s.work, ['rebase', 'origin/main'], { ok: false });
  expect(r.status, r.out).toBe(0);
  expect(blocchi(readFileSync(join(s.work, NOVITA), 'utf8'))).toEqual([
    ['0.2.12', ['di main', 'altra', 'del ramo'], []],
    ['0.2.11', ['a'], []],
    ['0.2.10', ['vecchia'], []],
  ]);
});
