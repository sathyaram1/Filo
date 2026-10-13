// #1159 giro 3 — il giro del PC (fusioni-server, quello che parte con avvia) porta su main del server i lavori server
// passati delle routine anche quando main del server si è mosso dopo la nascita del loro ramo. Server e app finti in
// una cartella temporanea; lo strumento del server è quello vero, preso dal checkout del server di questo ramo.
// Le prove di fiducia della pratica (rete) qui passano: al loro posto il PC lancia direttamente lo strumento del server.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';
import { cartellaDelServer, checkoutDelRamo } from '../../../scripts/lib/ramo-server.mjs';
import { fusioniServer } from '../../../scripts/lib/fusioni-server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, env: ENV, encoding: 'utf8' });
  return { code: r.status ?? 1, out: `${r.stdout || ''}${r.stderr || ''}` };
}
function ok(cwd, args) {
  const r = git(cwd, args);
  if (r.code !== 0) throw new Error(`git ${args.join(' ')}: ${r.out}`);
  return r.out.trim();
}

// Gli strumenti del server di questo lavoro: il checkout di filo-security sullo stesso ramo, o quello accanto al repo.
function strumentiDelServer() {
  const funzioni = cartellaDelServer(ROOT);
  if (!funzioni) return '';
  const ramo = ok(ROOT, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const gemello = checkoutDelRamo(git(dirname(funzioni), ['worktree', 'list', '--porcelain']).out, ramo);
  const t = join(gemello || dirname(funzioni), 'functions', 'tools');
  return existsSync(join(t, 'server-fondi.js')) ? t : '';
}

function commit(cwd, file, testo, msg) {
  writeFileSync(join(cwd, file), testo);
  ok(cwd, ['add', '-A']);
  ok(cwd, ['commit', '-q', '-m', msg]);
}

// filo-security finto: main con gli strumenti veri e prove che passano, node_modules già al suo posto.
function serverFinto(dir, tools) {
  ok(dir, ['init', '-q', '--bare', '-b', 'main', 'server.git']);
  ok(dir, ['clone', '-q', 'server.git', 'filo-security']);
  const s = join(dir, 'filo-security');
  mkdirSync(join(s, 'functions'), { recursive: true });
  cpSync(tools, join(s, 'functions', 'tools'), { recursive: true });
  writeFileSync(join(s, 'functions', 'package.json'), '{"name":"finto","version":"0.0.0","scripts":{"test":"node -e 0"}}\n');
  writeFileSync(join(s, 'functions', 'package-lock.json'), '{"lockfileVersion":3}\n');
  writeFileSync(join(s, '.gitignore'), 'node_modules\n');
  commit(s, 'functions/base.txt', 'base\n', 'M0');
  ok(s, ['push', '-q', 'origin', 'main']);
  mkdirSync(join(s, 'functions', 'node_modules'), { recursive: true });
  return s;
}

// Un lavoro server delle routine: lo stesso ramo worker/… sul server e nell'app, ognuno con un commit suo.
function lavoro(server, app, ramo, file) {
  ok(server, ['checkout', '-q', '-b', ramo, 'origin/main']);
  commit(server, `functions/${file}`, `${ramo}\n`, `server ${ramo}`);
  ok(server, ['push', '-q', 'origin', ramo]);
  ok(server, ['checkout', '-q', 'main']);
  ok(app, ['checkout', '-q', '-b', ramo, 'origin/main']);
  commit(app, `${file}`, `${ramo}\n`, `app ${ramo}`);
  ok(app, ['push', '-q', 'origin', ramo]);
  ok(app, ['checkout', '-q', 'main']);
}

function appFinta(dir) {
  ok(dir, ['init', '-q', '--bare', '-b', 'main', 'app.git']);
  ok(dir, ['clone', '-q', 'app.git', 'Filo']);
  const a = join(dir, 'Filo');
  commit(a, 'README', 'app\n', 'A0');
  ok(a, ['push', '-q', 'origin', 'main']);
  return a;
}

// Il PC come lo monta l'orchestratore, con server:fondi lanciato davvero nel server finto.
function pc(app, server, pratiche) {
  const tornate = [];
  const dep = {
    attese: async () => pratiche,
    radice: app,
    log: () => {},
    fineAttesa: async (id, opz) => { tornate.push({ id, opz }); return { ok: true }; },
    pubblica: async () => ({ code: 0, out: 'deploy finto' }),
    esegui: async (cmd, args, { cwd } = {}) => {
      if (cmd === 'git') return git(cwd || app, args);
      if (cmd === 'node' && /server-fondi-pratica\.mjs$/.test(args[0])) {
        const ramo = args[1];
        const id = args[args.indexOf('--feedback') + 1];
        const r = spawnSync(process.execPath, [join('tools', 'server-fondi.js'), ramo], {
          cwd: join(server, 'functions'), env: { ...ENV, FILO_SERVER_PRATICA: `#${id}` }, encoding: 'utf8', timeout: 120_000,
        });
        return { code: r.status ?? 1, out: `${r.stdout || ''}${r.stderr || ''}` };
      }
      return { code: 1, out: `comando inatteso: ${cmd}` };
    },
  };
  return { dep, tornate };
}

const dentroMain = (server, file) => git(server, ['cat-file', '-e', `origin/main:functions/${file}`]).code === 0;

test.describe('lavori server delle routine: la fusione dal PC', () => {
  test.setTimeout(240_000);
  let dir = '';
  test.afterEach(() => { if (dir) togliCartella(dir); dir = ''; });

  test('r1 due lavori server passati nati dallo stesso main: il giro del PC li porta su main tutti e due', async () => {
    const tools = strumentiDelServer();
    expect(tools, 'accanto al repo serve il checkout di filo-security').not.toBe('');
    dir = cartellaTemporanea('fusioni-1159-');
    const server = serverFinto(dir, tools);
    const app = appFinta(dir);
    lavoro(server, app, 'worker/primo-20261013T100000Z', 'primo.txt');
    lavoro(server, app, 'worker/secondo-20261013T110000Z', 'secondo.txt');
    ok(server, ['fetch', '-q', 'origin']);
    const P = (id, branch) => ({ feedbackId: id, seq: id === 'f1' ? 7001 : 7002, subSeq: 0, branch, parti: {} });
    const { dep, tornate } = pc(app, server, [P('f1', 'worker/primo-20261013T100000Z'), P('f2', 'worker/secondo-20261013T110000Z')]);

    const esito = await fusioniServer(dep);

    ok(server, ['fetch', '-q', 'origin']);
    expect(esito.ferme, JSON.stringify(esito.ferme)).toEqual([]);
    expect(dentroMain(server, 'primo.txt')).toBe(true);
    expect(dentroMain(server, 'secondo.txt')).toBe(true);
    expect(tornate.map((t) => t.id).sort()).toEqual(['f1', 'f2']);
  });

  test('r1 main del server mosso da un altro lavoro dopo la nascita del ramo: il giro del PC lo porta su main', async () => {
    const tools = strumentiDelServer();
    expect(tools, 'accanto al repo serve il checkout di filo-security').not.toBe('');
    dir = cartellaTemporanea('fusioni-1159-');
    const server = serverFinto(dir, tools);
    const app = appFinta(dir);
    lavoro(server, app, 'worker/lavoro-20261013T100000Z', 'lavoro.txt');
    // Un lavoro locale sul server fuso nel frattempo: main va avanti.
    commit(server, 'functions/altro.txt', 'altro\n', 'un altro lavoro sul server');
    ok(server, ['push', '-q', 'origin', 'main']);
    const { dep, tornate } = pc(app, server, [{ feedbackId: 'f3', seq: 7003, subSeq: 0, branch: 'worker/lavoro-20261013T100000Z', parti: {} }]);

    const esito = await fusioniServer(dep);

    ok(server, ['fetch', '-q', 'origin']);
    expect(esito.ferme, JSON.stringify(esito.ferme)).toEqual([]);
    expect(dentroMain(server, 'lavoro.txt')).toBe(true);
    expect(dentroMain(server, 'altro.txt')).toBe(true);
    expect(tornate.map((t) => t.id)).toEqual(['f3']);
  });
});
