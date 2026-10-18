// #785 giro 2 — la pubblicazione intera con lo script vero e un gh finto che risponde come GitHub (digest compresi):
// Windows sulla bozza, poi Mac e Linux NELLO STESSO MOMENTO, poi una ripubblicazione Linux. Alla fine una riga per file.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const sha = (t) => createHash('sha256').update(t).digest('hex');
const C1 = 'a'.repeat(40);
const corsa = (n) => `https://github.com/sathyaram1/Filo/actions/runs/${n}`;

test.skip(process.platform === 'win32', 'il gh finto è uno script POSIX');

function righeTabella(body) {
  return [...body.matchAll(/^\| `([^`]+)` \| `([0-9a-f]{64})` \|/gm)].map((m) => [m[1], m[2]]);
}

test('quattro file da tre lavori, due in parallelo, e una ripubblicazione: la pagina li porta tutti, con l\'impronta del file vero', async () => {
  test.setTimeout(60_000);
  const base = cartellaTemporanea('filo-785-g2-');
  try {
    copyFileSync(join(ROOT, 'scripts', 'release-impronte.mjs'), join(base, 'release-impronte.mjs'));
    const bin = join(base, 'bin');
    mkdirSync(bin);
    const stato = join(base, 'release.json');
    const allegati = join(base, 'allegati');
    mkdirSync(allegati);
    // GitHub: il corpo l'ha scritto qualcuno a mano dal sito (CRLF), gli allegati portano il loro digest.
    writeFileSync(stato, JSON.stringify({ body: 'Note della versione.\r\nSeconda riga.', isDraft: true }));
    writeFileSync(join(bin, 'gh'), `#!/usr/bin/env node
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const a = process.argv.slice(2);
const dorme = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const s = JSON.parse(fs.readFileSync(${JSON.stringify(stato)}, 'utf8'));
if (a[1] === 'view') {
  const dir = ${JSON.stringify(allegati)};
  s.assets = fs.readdirSync(dir).map((name) => ({ name, digest: 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex') }));
  dorme(300);
  process.stdout.write(JSON.stringify(s)); process.exit(0);
}
if (a[1] === 'edit') {
  const nuovo = fs.readFileSync(a[a.indexOf('--notes-file') + 1], 'utf8');
  dorme(300);
  const ora = JSON.parse(fs.readFileSync(${JSON.stringify(stato)}, 'utf8'));
  ora.body = nuovo; fs.writeFileSync(${JSON.stringify(stato)}, JSON.stringify(ora)); process.exit(0);
}
process.exit(3);
`);
    chmodSync(join(bin, 'gh'), 0o755);
    const riassunto = join(base, 'riassunto.md');
    writeFileSync(riassunto, '');

    const costruisci = (piatt, file) => {
      const dist = join(base, 'dist-' + piatt + '-' + Math.random().toString(36).slice(2));
      mkdirSync(dist);
      for (const [nome, contenuto] of Object.entries(file)) {
        writeFileSync(join(dist, nome), contenuto);
        writeFileSync(join(allegati, nome), contenuto);
      }
      return dist;
    };
    const lancia = (piatt, dist, n, dopo) => new Promise((ok) => {
      const args = [join(base, 'release-impronte.mjs'), '--piattaforma', piatt, '--cartella', dist, '--versione', 'v0.2.240',
        '--repo', 'sathyaram1/Filo', '--commit', C1, '--corsa', corsa(n), ...(dopo ? ['--verifica-dopo', String(dopo)] : [])];
      const p = spawn(process.execPath, args, { env: { ...process.env, PATH: bin + delimiter + process.env.PATH, GITHUB_STEP_SUMMARY: riassunto } });
      let out = '';
      p.stdout.on('data', (d) => { out += d; });
      p.stderr.on('data', (d) => { out += d; });
      p.on('close', (code) => ok({ code, out }));
    });

    const w = await lancia('Windows', costruisci('w', { 'Filo-Setup.exe': 'exe-1' }), 100);
    expect(w.code, w.out).toBe(0);
    const [m, l] = await Promise.all([
      lancia('Mac', costruisci('m', { 'Filo-Mac.dmg': 'dmg-1', 'Filo-Mac.zip': 'zip-1' }), 100, 1),
      lancia('Linux', costruisci('l', { 'Filo-Linux.AppImage': 'app-1' }), 100, 1),
    ]);
    expect(m.code, m.out).toBe(0);
    expect(l.code, l.out).toBe(0);
    let body = JSON.parse(readFileSync(stato, 'utf8')).body;
    expect(righeTabella(body)).toEqual([
      ['Filo-Setup.exe', sha('exe-1')], ['Filo-Mac.dmg', sha('dmg-1')], ['Filo-Mac.zip', sha('zip-1')], ['Filo-Linux.AppImage', sha('app-1')],
    ]);
    expect(body).toContain(C1);
    expect(body).toContain(corsa(100));
    expect(body.startsWith('Note della versione.\r\nSeconda riga.')).toBe(true);
    expect(body.match(/## Verifica/g)).toHaveLength(1);

    // Ripubblicazione a mano di Linux da un'altra corsa: la sua riga cambia, le altre restano.
    const r = await lancia('Linux', costruisci('l2', { 'Filo-Linux.AppImage': 'app-2' }), 200, 1);
    expect(r.code, r.out).toBe(0);
    body = JSON.parse(readFileSync(stato, 'utf8')).body;
    expect(righeTabella(body)).toEqual([
      ['Filo-Setup.exe', sha('exe-1')], ['Filo-Mac.dmg', sha('dmg-1')], ['Filo-Mac.zip', sha('zip-1')], ['Filo-Linux.AppImage', sha('app-2')],
    ]);
    expect(body).toContain(corsa(200));
    expect(body).toMatch(/Get-FileHash .*-Algorithm SHA256/);
    expect(body).toMatch(/shasum -a 256/);
    expect(body).toMatch(/sha256sum/);

    const sommario = readFileSync(riassunto, 'utf8');
    for (const t of ['exe-1', 'dmg-1', 'zip-1', 'app-1', 'app-2']) expect(sommario).toContain(sha(t));

    // Un allegato che su GitHub è rimasto vecchio: il passo si ferma e la pagina non cambia.
    const prima = JSON.parse(readFileSync(stato, 'utf8')).body;
    const dist = costruisci('w2', { 'Filo-Setup.exe': 'exe-2' });
    writeFileSync(join(allegati, 'Filo-Setup.exe'), 'exe-1');
    const male = await lancia('Windows', dist, 300);
    expect(male.code).toBe(1);
    expect(male.out).toMatch(/::error::/);
    expect(JSON.parse(readFileSync(stato, 'utf8')).body).toBe(prima);
  } finally {
    togliCartella(base);
  }
});
