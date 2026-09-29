// Giro locale «ruoli-attriti», giro 1 — i comandi di chiusura del controllo di
// sicurezza, dopo il cancello di fusione, si eseguono così come arrivano.
//
// Gli strumenti si fissano fuori dal progetto come fa il giro vero, la ricetta
// la consegna la copia fissata, e i comandi degli esiti 0 e 10 si lanciano
// alla lettera (tolti solo i segnaposto) contro un server finto.

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const RADICE = fileURLToPath(new URL('../../../', import.meta.url));

function fintoServer() {
  const ricevuti = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let j = {};
      try { j = body ? JSON.parse(body) : {}; } catch (_) { /* lo scoprono gli assert */ }
      ricevuti.push({ url: String(req.url || ''), body: j });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, id: 'IDSEC', num: '#900' }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, ricevuti, port: srv.address().port })));
}

async function strumentiFissati() {
  const dest = resolve(cartellaTemporanea('filo-ruoli-attriti-pin-'), 'strumenti');
  const { pinTools } = await import(pathToFileURL(resolve(RADICE, 'scripts/lib/tools-pin.mjs')).href);
  const r = pinTools(RADICE, { dest });
  expect(r.ok, r.why).toBe(true);
  return r.dir;
}

// La ricetta come la consegna la copia fissata (è lei che gira in cloud).
function ricettaSecaudit(pin) {
  const out = spawnSync(process.execPath, ['--input-type=module', '-e',
    `const m = await import(${JSON.stringify(pathToFileURL(resolve(pin, 'scripts/dispatch.mjs')).href)});`
    + 'process.stdout.write(m.readRoleInstructions("secaudit"));'],
  { encoding: 'utf8', env: { ...process.env, FILO_NO_BEAT: '1', FILO_TOOLS_ROOT: '', FILO_REPO_ROOT: '' } });
  expect(out.status, out.stderr).toBe(0);
  return out.stdout;
}

// I comandi fra apici inversi della voce di un esito del gate. Un comando che
// va a capo nel testo si legge su una riga sola, come lo riscrive chi lo lancia.
function comandiDellEsito(testo, esito) {
  const i = testo.indexOf(`- \`${esito}\` →`);
  expect(i, `la ricetta deve avere la voce per l'esito ${esito} del gate`).toBeGreaterThan(-1);
  const resto = testo.slice(i + 1);
  const fine = resto.search(/\n\s*- `\d+` →/);
  const voce = fine === -1 ? resto : resto.slice(0, fine);
  return [...voce.matchAll(/`([^`]+)`/g)].map((m) => m[1].replace(/\s*\n\s*/g, ' ').trim())
    .filter((c) => /^node\s/.test(c));
}

function parole(comando) {
  return (comando.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((w) => w.replace(/^(['"])(.*)\1$/, '$2'));
}

function lancia(argv, env, cwd) {
  return new Promise((r) => execFile(argv[0] === 'node' ? process.execPath : argv[0], argv.slice(1), { env, cwd },
    (err, so, se) => r({ status: err ? (err.code ?? 1) : 0, stdout: String(so || ''), stderr: String(se || '') })));
}

function progetto(fuori) {
  const dir = resolve(fuori, 'progetto');
  mkdirSync(dir, { recursive: true });
  const g = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g(['init', '-q', '--initial-branch=main']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  writeFileSync(resolve(dir, 'a.txt'), 'base\n', 'utf8');
  g(['add', '-A']);
  g(['commit', '-qm', 'base']);
  g(['checkout', '-qb', 'claude/lavoro']);
  return dir;
}

const SEGNAPOSTO = {
  '<riga>': 'fuso su main',
  '<spiegazione>': 'il cancello ha fermato un ritocco alle regole del database',
  '<branch>': 'claude/lavoro',
  '<id>': 'IDSEC',
};
const riempi = (w) => SEGNAPOSTO[w] ?? w;

for (const caso of [
  { esito: '0', status: 'done', notes: 'fuso su main', reason: undefined },
  { esito: '10', status: 'design', notes: 'il cancello ha fermato un ritocco alle regole del database', reason: 'l5' },
]) {
  test(`dopo il gate, esito ${caso.esito}: i comandi della ricetta nominano lo strumento fissato e consegnano davvero`, async () => {
    const pin = await strumentiFissati();
    const ricetta = ricettaSecaudit(pin);
    const comandi = comandiDellEsito(ricetta, caso.esito);
    expect(comandi.length, `l'esito ${caso.esito} deve dire con quale comando si chiude`).toBeGreaterThan(0);

    const fuori = cartellaTemporanea('filo-ruoli-attriti-sec-');
    const dir = progetto(fuori);
    const statoDir = resolve(fuori, 'stato');
    mkdirSync(statoDir, { recursive: true });
    writeFileSync(resolve(statoDir, 'IDSEC.json'), JSON.stringify({ id: 'IDSEC', branch: 'claude/lavoro' }) + '\n', 'utf8');

    const { srv, ricevuti, port } = await fintoServer();
    const env = {
      ...process.env,
      FILO_REPO_ROOT: dir,
      FILO_TOOLS_ROOT: '',
      FILO_DISPATCH_STATE_DIR: statoDir,
      FILO_NO_BEAT: '1',
      FILO_ROUTINE_TICKET: 'biglietto-finto',
      FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
    };
    try {
      for (const c of comandi) {
        const argv = parole(c).map(riempi);
        expect(argv[0]).toBe('node');
        // Lo strumento è nominato per intero, e porta alla copia fissata, non al ramo.
        const script = argv[1].replace(/\\/g, '/');
        expect(script.startsWith(pin.replace(/\\/g, '/') + '/scripts/'), `«${c}» deve portare agli strumenti fissati`).toBe(true);
        const r = await lancia(argv, env, dir);
        expect(r.status, `«${c}»\n${r.stdout}\n${r.stderr}`).toBe(0);
      }
      const consegne = ricevuti.filter((x) => x.body && x.body.intent === 'status');
      expect(consegne.length, 'una consegna di stato, una sola').toBe(1);
      const data = consegne[0].body.data || {};
      expect(data.status).toBe(caso.status);
      expect(data.notes).toBe(caso.notes);
      if (caso.reason) {
        expect(data.reason).toBe(caso.reason);
        expect(data.branch).toBe('claude/lavoro');
      }
      if (caso.esito === '0') {
        expect(existsSync(resolve(statoDir, 'IDSEC.json')), 'dopo la fusione lo stato locale va tolto').toBe(false);
      }
    } finally {
      srv.close();
    }
  });
}
