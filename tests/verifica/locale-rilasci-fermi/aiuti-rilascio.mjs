// Aiuti delle prove del giro (ramo claude/rilasci-fermi): un main finto con le date vere dei commit, un `gh` finto
// che risponde con corse e release scritte dalla prova, un buildAlarm finto che applica il contratto delle chiavi.
// Non apre Filo: i passi dei workflow si leggono dai file .yml e si eseguono come li esegue Actions.

import { execFileSync, execFile, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const WIN = process.platform === 'win32';

export const oreFa = (ore) => new Date(Date.now() - ore * 3.6e6).toISOString().replace(/\.\d+Z$/, 'Z');

const git = (cwd, args, env = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } }).trim();

/** Un main lineare: [{ ore, msg }] dal più vecchio; `tag` sul primo. Ritorna gli sha nello stesso ordine. */
export function creaMain(dir, commit, tag) {
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'prova@filo']);
  git(dir, ['config', 'user.name', 'prova']);
  git(dir, ['config', 'core.autocrlf', 'false']);
  const sha = [];
  for (const { ore, msg } of commit) {
    writeFileSync(join(dir, 'f.txt'), `${msg}\n`, { flag: 'a' });
    git(dir, ['add', 'f.txt']);
    const d = oreFa(ore);
    git(dir, ['commit', '-qm', msg], { GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d });
    sha.push(git(dir, ['rev-parse', 'HEAD']));
  }
  if (tag) git(dir, ['tag', tag, sha[0]]);
  writeFileSync(join(dir, '.git', 'info', 'exclude'), 'api\nstato-gh.json\n');
  return sha;
}

// `gh api <percorso>`: su Windows node.exe col nome gh.exe esegue lo script `api` della cartella corrente;
// altrove uno script col suo interprete in testa. Stesso corpo, legge lo stato scritto dalla prova.
const CORPO_GH = `
const fs = require('fs');
const p = process.argv.find((a) => a.startsWith('repos/')) || '';
const s = JSON.parse(fs.readFileSync(process.env.FAKE_GH_STATO, 'utf8'));
if (p.includes('/actions/workflows/suite.yml/runs')) {
  const runs = (s.runs || []).filter((r) => !p.includes('status=success') || r.conclusion === 'success');
  process.stdout.write(JSON.stringify({ total_count: runs.length, workflow_runs: runs }));
} else if (p.includes('/releases/tags/')) {
  process.stdout.write(JSON.stringify({ tag_name: p.split('/').pop(), published_at: s.pubblicata }));
} else { process.stderr.write('percorso non previsto: ' + p + '\\n'); process.exit(1); }
`;

export function preparaGh(tmp, cwd, stato) {
  const bin = join(tmp, 'bin');
  mkdirSync(bin, { recursive: true });
  const fileStato = join(tmp, 'stato-gh.json');
  writeFileSync(fileStato, JSON.stringify(stato));
  if (WIN) {
    const exe = join(bin, 'gh.exe');
    if (!existsSync(exe)) { try { linkSync(process.execPath, exe); } catch { copyFileSync(process.execPath, exe); } }
    writeFileSync(join(cwd, 'api'), CORPO_GH);
  } else {
    writeFileSync(join(bin, 'gh'), `#!${process.execPath}\n${CORPO_GH}`);
    chmodSync(join(bin, 'gh'), 0o755);
  }
  return { PATH: `${bin}${delimiter}${process.env.PATH}`, FAKE_GH_STATO: fileStato };
}

export function corsa(sha, conclusion, ore) {
  return {
    head_sha: sha, conclusion, status: 'completed', event: 'push', head_branch: 'main',
    created_at: oreFa(ore + 1), updated_at: oreFa(ore), html_url: `https://github.com/o/r/actions/runs/${Math.round(ore * 10)}`,
  };
}

/** buildAlarm finto col contratto: una chiave già coperta da un aperto non ne apre un altro. */
export async function serverAllarmi() {
  const richieste = [];
  const aperti = [];
  let seq = 900;
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(b); } catch { /* corpo non JSON: resta vuoto */ }
      richieste.push(body);
      const keys = Array.isArray(body.keys) ? body.keys : [];
      let out;
      if (!keys.length) {
        out = aperti.length ? { ok: true, duplicate: true, num: aperti[0].num } : null;
      } else {
        const coperte = keys.map((k) => ({ key: k, num: aperti.find((a) => a.alarmKeys.includes(k))?.num })).filter((c) => c.num);
        const nuove = keys.filter((k) => !coperte.some((c) => c.key === k));
        if (!nuove.length) out = { ok: true, duplicate: true, num: coperte[0].num, nuove: [], coperte };
        else out = { nuove, coperte };
      }
      if (!out || out.nuove?.length) {
        const num = `#${++seq}`;
        aperti.push({ num, name: body.name, alarmKeys: out?.nuove || [] });
        out = { ok: true, duplicate: false, num, nuove: out?.nuove || [], coperte: out?.coperte || [] };
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, richieste, aperti, chiudi: () => new Promise((r) => server.close(r)) };
}

/** I passi di un job del workflow, letti dal file vero. */
export function passi(workflow, job) {
  const doc = yaml.load(readFileSync(join(ROOT, '.github', 'workflows', workflow), 'utf8'));
  return doc.jobs[job].steps;
}

/** Esegue un comando `node scripts/…` di un passo, con gli script del ramo e la cartella corrente data. Asincrono:
 *  il server finto vive in questo processo e deve poter rispondere. */
export function eseguiNode(riga, cwd, env) {
  const args = riga.trim().split(/\s+/).slice(1).map((a) => (a.startsWith('scripts/') ? join(ROOT, a) : a));
  return new Promise((r) => {
    execFile(process.execPath, args, { cwd, env: { ...process.env, ...env } }, (err, stdout, stderr) => {
      r({ codice: err ? (err.code ?? 1) : 0, stdout, stderr });
    });
  });
}

/** bash per i passi scritti in bash: quello del sistema, o quello di Git su Windows. '' se non c'è. */
export function trovaBash() {
  const candidati = ['bash', ...(WIN ? ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files\\Git\\usr\\bin\\bash.exe'] : [])];
  for (const c of candidati) {
    const r = spawnSync(c, ['-c', 'echo ok'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim() === 'ok') return c;
  }
  return '';
}

/** Un passo bash del workflow, con le espressioni ${{ }} sostituite da `espressioni` e gli script del ramo. */
export function eseguiBash(bash, run, cwd, env, espressioni = {}) {
  const testo = run
    .replace(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_, e) => (e in espressioni ? espressioni[e] : ''))
    .replace(/node scripts\//g, `node "${ROOT.replace(/\\/g, '/')}/scripts/`)
    .replace(/(node "[^"\s]+?\.mjs)(\s)/g, '$1"$2');
  return new Promise((r) => {
    execFile(bash, ['-e', '-o', 'pipefail', '-c', testo], { cwd, env: { ...process.env, ...env } }, (err, stdout, stderr) => {
      r({ codice: err ? (err.code ?? 1) : 0, stdout, stderr });
    });
  });
}
