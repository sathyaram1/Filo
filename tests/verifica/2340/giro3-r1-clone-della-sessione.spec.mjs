// Verifica #2340 giro 3: nelle routine il manutentore lavora nel clone del giro, non nella cartella della sessione,
// e il clone di filo-security della sessione sta accanto a quella: rami e incroci devono trovarlo lo stesso.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const M = await import('../../../scripts/manutentore.mjs');

function repo(dir, rami) {
  mkdirSync(dir, { recursive: true });
  const g = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'ignore' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  writeFileSync(join(dir, 'x.txt'), 'x'); g('add', '-A'); g('commit', '-qm', 'inizio');
  g('update-ref', 'refs/remotes/origin/main', 'HEAD');
  for (const [ramo, file, msg] of rami) {
    g('checkout', '-q', '-B', 'tmp', 'main');
    mkdirSync(join(dir, file, '..'), { recursive: true });
    writeFileSync(join(dir, file), ramo); g('add', '-A'); g('commit', '-qm', msg);
    g('update-ref', `refs/remotes/origin/${ramo}`, 'HEAD');
  }
  g('checkout', '-q', 'main');
}

test('r1 dal clone del giro, rami e incroci leggono il clone di filo-security che la sessione ha accanto alla sua cartella', async () => {
  const base = cartellaTemporanea('verifica-2340-giro3');
  try {
    // La sessione cloud: /home/user/Filo e, accanto, /home/user/filo-security col suo lavoro del server.
    const sessione = join(base, 'sessione');
    mkdirSync(join(sessione, 'Filo'), { recursive: true });
    const server = join(sessione, 'filo-security');
    repo(server, [['claude/uno', 'functions/src/x.js', '#31 uno']]);
    mkdirSync(join(server, 'functions', 'tools'), { recursive: true });
    writeFileSync(join(server, 'functions', 'tools', 'server-fondi.js'), '');
    // Il clone del giro (/tmp/filo-lavori/1) col suo segno, che dice qual è la cartella della sessione.
    const lavoro = join(base, 'lavori', '1');
    repo(lavoro, [['claude/app', 'src/a.js', 'auto: #30']]);
    mkdirSync(join(lavoro, '.claude'), { recursive: true });
    writeFileSync(join(lavoro, '.claude', 'filo-worker.json'), JSON.stringify({ indice: 1, paralleli: 0, principale: join(sessione, 'Filo') }));

    const out = [];
    const [l, e] = [console.log, console.error];
    console.log = (...a) => out.push(a.join(' ')); console.error = (...a) => out.push(a.join(' '));
    let esito;
    try {
      // Il clone dei lavori server (/root/filo-security) nella sessione del manutentore non c'è.
      esito = await M.main(['rami', '--senza-fetch'], { root: lavoro, env: { FILO_SERVER_CLONE: join(base, 'assente') } });
    } finally { console.log = l; console.error = e; }
    const testo = out.join('\n');
    expect(esito).toBe(0);
    expect(testo).not.toMatch(/Rami del server NON letti/);
    expect(testo).toMatch(/^claude\/uno sul server \(#31\)/m);
  } finally { togliCartella(base); }
});
