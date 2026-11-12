// Sentinella: il README del repo pubblico è la prima pagina di chi va a controllare, e non deve dire il falso (#875).
// Rossa se cita un percorso del repo che non c'è, un percorso fuori dal repo o di Windows scritto a mano,
// o se tace un sistema per cui package.json costruisce il pacchetto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const README = readFileSync(resolve(ROOT, 'README.md'), 'utf8');
const PROSA = README.replace(/```[\s\S]*?```/g, '');
const RADICE = new Set(readdirSync(ROOT));

function citati() {
  const parole = [...PROSA.matchAll(/`([^`\n]+)`/g)].flatMap((m) => m[1].split(/\s+/));
  const link = [...PROSA.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]).filter((u) => !/^[a-z]+:/i.test(u));
  return [...parole, ...link];
}

test('ogni percorso del repo citato nel README esiste', () => {
  const mancanti = citati()
    .filter((p) => RADICE.has(p.replace(/\/.*$/, '')) && !/[<>*]/.test(p))
    .filter((p) => !existsSync(resolve(ROOT, p)));
  assert.deepEqual(mancanti, [], `il README cita percorsi che nel repo non ci sono: ${mancanti.join(', ')}`);
});

test('il README non cita percorsi fuori dal repo né percorsi di Windows', () => {
  const fuori = citati().filter((p) => p.startsWith('../') || p.startsWith('/'));
  assert.deepEqual(fuori, [], `percorsi fuori dal repo: ${fuori.join(', ')}`);
  assert.doesNotMatch(README, /%[A-Z]+%|[A-Za-z]:\\|\\Users\\/, 'un percorso di Windows scritto a mano vale solo lì: si dice app.getPath(...)');
});

test('il README nomina ogni sistema per cui si costruisce il pacchetto', () => {
  const build = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).build;
  const nomi = { win: 'Windows', mac: 'Mac', linux: 'Linux' };
  const sezione = (README.split(/^## Sistemi e aggiornamenti$/m)[1] || '').split(/^## /m)[0];
  assert.ok(sezione, 'il README ha la sezione «Sistemi e aggiornamenti»');
  for (const [chiave, nome] of Object.entries(nomi)) {
    if (!build[chiave]) continue;
    assert.match(sezione, new RegExp(`\\*\\*${nome}\\.\\*\\*`), `package.json costruisce il pacchetto ${nome}: il README lo descrive`);
  }
  assert.doesNotMatch(README, /non previst/i, 'nessun sistema è dichiarato «non previsto» mentre package.json lo costruisce');
});
