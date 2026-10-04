// Repo finto per le prove del giro: un origin con main lungo e un ramo nato indietro, clonato poco profondo.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const g = (cwd, args, input) => execFileSync('git', args, { cwd, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] }).trim();

/** origin con `mainN` commit su main e un ramo `feature` di `featN` commit nato su main al commit `forkAt`; poi un clone. */
export function cloneFinto(dir, { mainN = 400, forkAt = 100, featN = 3, clona = ['--depth', '1', '--branch', 'feature'] } = {}) {
  const origin = join(dir, 'origin.git');
  mkdirSync(origin, { recursive: true });
  g(origin, ['init', '-q', '--bare', '-b', 'main']);
  let s = ''; let t = 1700000000; let mark = 0;
  const commit = (ref, from, path, msg) => {
    mark++; t++;
    s += `commit ${ref}\nmark :${mark}\ncommitter T <t@t> ${t} +0000\ndata ${Buffer.byteLength(msg)}\n${msg}\n`;
    if (from) s += `from ${from}\n`;
    s += `M 644 inline ${path}\ndata ${Buffer.byteLength(msg) + 1}\n${msg}\n\n`;
    return `:${mark}`;
  };
  const main = [];
  for (let i = 0; i < mainN; i++) main.push(commit('refs/heads/main', i ? main[i - 1] : null, `m${i}.txt`, `main ${i}`));
  let f = main[forkAt];
  for (let j = 0; j < featN; j++) f = commit('refs/heads/feature', f, `f${j}.txt`, `feat ${j}`);
  g(origin, ['fast-import', '--quiet'], s);
  const clone = join(dir, 'clone');
  g(dir, ['clone', '-q', ...clona, pathToFileURL(origin).href, clone]);
  return { clone, punta: g(clone, ['rev-parse', 'HEAD']) };
}

export const unitFinti = () => ({ ok: true, rossi: [], coda: '' });
