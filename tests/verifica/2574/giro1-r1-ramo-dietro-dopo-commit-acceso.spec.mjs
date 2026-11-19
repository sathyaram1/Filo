// Verifica #2574, giro 1, rilievo 1: dopo che il cancello ha acceso la suite col suo commit vuoto sul ramo del server,
// il ramo sul PC deve poter spingere una correzione (la strada che il messaggio della suite rossa indica) senza rifiuti.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';
import { fusioneDalCancello } from '../../../scripts/server-fondi-pratica.mjs';

const RAMO = 'claude/prova-2574';
const ID = ['-c', 'user.name=prova', '-c', 'user.email=prova@filo.invalid', '-c', 'commit.gpgsign=false'];

function g(cwd, ...args) {
  const r = spawnSync('git', [...ID, ...args], { cwd, encoding: 'utf8' });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}

test('r1 dopo il commit acceso dal cancello la correzione del ramo dal PC si spinge senza rifiuti', async () => {
  const dir = cartellaTemporanea('filo-2574-');
  try {
    const remoto = join(dir, 'remoto.git');
    const pc = join(dir, 'filo-security');
    const cancello = join(dir, 'cancello');
    expect(g(dir, 'init', '-q', '--bare', '-b', 'main', remoto).ok).toBe(true);
    expect(g(dir, 'clone', '-q', remoto, pc).ok).toBe(true);
    mkdirSync(join(pc, 'functions'), { recursive: true });
    writeFileSync(join(pc, 'functions', 'a.js'), 'module.exports = 1;\n');
    g(pc, 'checkout', '-q', '-b', 'main');
    g(pc, 'add', '-A');
    expect(g(pc, 'commit', '-q', '-m', 'base').ok).toBe(true);
    expect(g(pc, 'push', '-q', 'origin', 'main').ok).toBe(true);
    g(pc, 'checkout', '-q', '-b', RAMO);
    writeFileSync(join(pc, 'functions', 'a.js'), 'module.exports = 2;\n');
    g(pc, 'commit', '-q', '-am', 'il lavoro');
    expect(g(pc, 'push', '-q', '-u', 'origin', RAMO).ok).toBe(true);
    const verificato = g(pc, 'rev-parse', 'HEAD').out;

    // Il cancello, da GitHub: il suo commit vuoto marcato sopra lo sha verificato.
    expect(g(dir, 'clone', '-q', '-b', RAMO, remoto, cancello).ok).toBe(true);
    expect(g(cancello, 'commit', '-q', '--allow-empty', '-m', '[suite del server] accesa dal cancello').ok).toBe(true);
    expect(g(cancello, 'push', '-q', 'origin', RAMO).ok).toBe(true);
    const accesa = g(cancello, 'rev-parse', 'HEAD').out;

    const righe = [];
    const k = await fusioneDalCancello(
      { cartella: join(pc, 'functions'), ramo: RAMO, sha: verificato, feedbackId: 'f1' },
      { chiedi: async () => ({ outcome: 'aspetta_suite', sha: verificato, suite: 'accesa', accesa }), log: (s) => righe.push(s), err: (s) => righe.push(s) },
    );
    expect(k).not.toBe(0);

    // La suite sul commit acceso è rossa: «correggi il ramo, spingi e rilancia».
    writeFileSync(join(pc, 'functions', 'a.js'), 'module.exports = 3;\n');
    g(pc, 'commit', '-q', '-am', 'la correzione');
    const spinta = g(pc, 'push', 'origin', RAMO);
    expect(spinta.ok, `spinta della correzione rifiutata:\n${spinta.out}\n${righe.join('\n')}`).toBe(true);
  } finally {
    togliCartella(dir);
  }
});
