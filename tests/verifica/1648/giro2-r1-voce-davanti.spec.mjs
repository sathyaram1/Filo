// Verifica #1648, giro 2, rilievo 1: dal PC la voce del ramo del server si scrive anche per una punta che filo-security
// non ha (start con la correzione del server non spinta): registro e GitHub divergono e il server dà l'allarme.
import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { avviaConfigRoutinesFinto } from '../../helpers/server-finto.mjs';

const VERIFY = fileURLToPath(new URL('../../../scripts/verify-local.mjs', import.meta.url));
const RAMO = 'claude/prova';
const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const scrivi = (dir, file, testo) => { mkdirSync(resolve(dir, file, '..'), { recursive: true }); writeFileSync(resolve(dir, file), testo, 'utf8'); };
const commit = (dir, file, testo, msg) => { scrivi(dir, file, testo); g(dir, 'add', '-A'); g(dir, 'commit', '-q', '-m', msg); return g(dir, 'rev-parse', 'HEAD'); };
const identita = (dir) => { g(dir, 'config', 'user.email', 't@t'); g(dir, 'config', 'user.name', 't'); };

function scenario() {
  const base = cartellaTemporanea('filo-1648-');
  const work = resolve(base, 'work');
  const server = resolve(base, 'filo-security');
  const origine = resolve(base, 'srv-origin.git');
  mkdirSync(work);
  g(work, 'init', '-q', '-b', 'main');
  identita(work);
  scrivi(work, '.gitignore', '.claude/\n');
  commit(work, 'app.txt', 'app\n', 'app');
  g(work, 'checkout', '-q', '-b', RAMO);
  commit(work, 'lavoro.txt', 'lavoro\n', 'lavoro dell\'app');
  mkdirSync(origine);
  g(origine, 'init', '--bare', '-q', '--initial-branch=main');
  mkdirSync(server);
  g(server, 'init', '-q', '-b', 'main');
  identita(server);
  g(server, 'remote', 'add', 'origin', origine);
  commit(server, 'functions/tools/server-fondi.js', '// finto\n', 'server');
  g(server, 'push', '-q', 'origin', 'refs/heads/main:refs/heads/main');
  g(server, 'checkout', '-q', '-b', RAMO);
  commit(server, 'functions/lavoro.js', 'v1\n', 'lavoro del server');
  g(server, 'push', '-q', '-u', 'origin', `refs/heads/${RAMO}:refs/heads/${RAMO}`);
  return { work, server, origine };
}

test('r1 start con la correzione del server non spinta: nessuna voce per una punta che filo-security non ha', async () => {
  const finto = await avviaConfigRoutinesFinto({ FINTO_CAPS: JSON.stringify({ cap3: 5, cap2: 5, cap1: 2, cap0: 0 }) });
  try {
    const vl = (work, ...args) => {
      const r = spawnSync(process.execPath, [VERIFY, ...args], {
        cwd: work, encoding: 'utf8',
        env: { ...process.env, FILO_REPO_ROOT: work, FILO_ROUTINE_CONFIG_URL: finto.url, FILO_ADMIN_ID_TOKEN: 'finto-id-token' },
      });
      return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
    };
    const sc = scenario();
    expect(vl(sc.work, 'start', 'fai X su app e server').code).toBe(0);
    const critica = vl(sc.work, 'critica', 'Provato il lavoro intero, app e server insieme: l\'app regge, il server no.\n[2i] il server non salva il campo nuovo');
    expect(critica.code, critica.out).toBe(0);
    const v2 = commit(sc.server, 'functions/lavoro.js', 'v2\n', 'correzione del server, non spinta');
    const corretto = vl(sc.work, 'corretto', 'Corretto il salvataggio del campo nuovo nel ramo del server; l\'app non andava toccata, è rimasta com\'era.');
    expect(corretto.code, corretto.out).toBe(0);

    // La verifica successiva parte: la voce del server deve stare con la punta che filo-security ha davvero.
    const giro2 = vl(sc.work, 'start');
    expect(giro2.code, giro2.out).toBe(0);
    const suGithub = g(sc.origine, 'rev-parse', `refs/heads/${RAMO}`);
    if (suGithub !== v2) {
      expect(giro2.out, `start ha scritto la voce di ${v2.slice(0, 8)} con filo-security a ${suGithub.slice(0, 8)}:\n${giro2.out}`)
        .not.toMatch(/Registro del ramo del server: /);
      expect(giro2.out).toMatch(/non aggiornato/);
    }
  } finally {
    finto.kill();
  }
});
