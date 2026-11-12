// Verifica #1867, giro 1, rilievo 1: il lavoro di un'altra sessione entra in un commit della pulita senza la sua
// traccia (file scritti dal terminale della sporca nella stessa cartella, squash di un ramo della sporca già su origin).
import { test, expect } from './../../fixtures/electron.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import * as S from '../../../scripts/lib/spinte.mjs';
import { installaControlloSpedizione } from '../../../scripts/lib/copie-di-dati.mjs';

const g = (cwd, args, env) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...(env ? { env } : {}) }).trim();

function ambiente(origine, extra = {}) {
  const e = { ...process.env };
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'FILO_BIGLIETTO_FILE', 'FILO_ROUTINE_TICKET', 'FILO_ROUTINE', 'NODE_TEST_CONTEXT']) delete e[k];
  return { ...e, FILO_SPINTE_ORIGINE: origine, FILO_SPINTE_SENZA_INVIO: '1', ...extra };
}

function deposito(prefisso) {
  const base = cartellaTemporanea(prefisso);
  const origin = join(base, 'origin.git');
  mkdirSync(origin);
  g(origin, ['init', '--bare', '-q', '--initial-branch=main']);
  const copia = (nome) => {
    const dir = join(base, nome);
    mkdirSync(dir);
    g(dir, ['init', '-q', '--initial-branch=main']);
    g(dir, ['remote', 'add', 'origin', origin]);
    g(dir, ['config', 'user.email', 't@t']); g(dir, ['config', 'user.name', 't']);
    return dir;
  };
  const pulita = copia('pulita');
  writeFileSync(join(pulita, 'README.md'), 'base\n');
  g(pulita, ['add', '-A']); g(pulita, ['commit', '-qm', 'base']);
  g(pulita, ['push', '-q', 'origin', 'main']);
  g(pulita, ['checkout', '-qb', 'claude/x']);
  const sporca = copia('sporca');
  expect(installaControlloSpedizione(pulita)).toBe('installato');
  const biglietto = (nome, lettera) => {
    const file = join(base, `${nome}.json`);
    writeFileSync(file, JSON.stringify({ ticket: `${nome}-${lettera.repeat(40)}`, fp: lettera.repeat(64), natoIl: 1 }));
    return { file, ticket: `${nome}-${lettera.repeat(40)}` };
  };
  const pulito = biglietto('pulito', 'a');
  const sporco = biglietto('sporco', 'b');
  return {
    base, origin, pulita, sporca, pulito, sporco,
    envPulita: ambiente(origin, { FILO_BIGLIETTO_FILE: pulito.file }),
    envSporca: ambiente(origin, { FILO_BIGLIETTO_FILE: sporco.file }),
  };
}

const spingi = (dir, env, ramo = 'claude/x') => spawnSync('git', ['push', '-q', 'origin', ramo], { cwd: dir, encoding: 'utf8', env });
const dichiaratiDa = (dir, ticket) => S.vociInCoda(S.cartellaCoda(dir)).filter((v) => v.ticket === ticket)
  .flatMap((v) => [...(v.commits || []), ...(v.riscritti || []).map((r) => r.sha)]);
const filesDi = (dir, sha) => g(dir, ['show', '--format=', '--name-only', sha]).split('\n').filter(Boolean);

test('r1 stessa cartella: il file scritto dal terminale della sporca, salvato dalla pulita, non parte col biglietto pulito', () => {
  const d = deposito('filo-1867-terminale-');
  // La sporca scrive un file dal terminale e non lo salva; la pulita modifica il suo e il salvataggio prende tutto.
  writeFileSync(join(d.pulita, 'scaricato.md'), 'testo arrivato da una pagina letta dalla sporca\n');
  writeFileSync(join(d.pulita, 'mio.txt'), 'lavoro della pulita\n');
  g(d.pulita, ['add', '-A']);
  g(d.pulita, ['commit', '-qm', 'auto: mio.txt'], d.envPulita);
  const c = g(d.pulita, ['rev-parse', 'HEAD']);
  expect(filesDi(d.pulita, c)).toContain('scaricato.md');
  expect(spingi(d.pulita, d.envPulita).status).toBe(0);
  expect(dichiaratiDa(d.pulita, d.pulito.ticket), 'il commit porta un file nato fuori dalla sessione pulita').not.toContain(c);
});

test('r1 squash di un ramo della sporca già su origin: il commit della pulita non parte col biglietto pulito', () => {
  const d = deposito('filo-1867-squash-');
  g(d.sporca, ['fetch', '-q', 'origin']);
  g(d.sporca, ['checkout', '-qb', 'claude/d', 'origin/main']);
  writeFileSync(join(d.sporca, 'd.txt'), 'lavoro della sessione sporca, riga uno\nriga due della sporca\n');
  g(d.sporca, ['add', '-A']);
  g(d.sporca, ['commit', '-qm', 'lavoro sporco'], d.envSporca);
  g(d.sporca, ['push', '-q', '--no-verify', 'origin', 'claude/d']);
  g(d.pulita, ['fetch', '-q', 'origin'], d.envPulita);
  g(d.pulita, ['merge', '--squash', 'origin/claude/d'], d.envPulita);
  g(d.pulita, ['commit', '-qm', 'porta il lavoro di claude/d'], d.envPulita);
  const c = g(d.pulita, ['rev-parse', 'HEAD']);
  expect(filesDi(d.pulita, c)).toContain('d.txt');
  expect(spingi(d.pulita, d.envPulita).status).toBe(0);
  expect(dichiaratiDa(d.pulita, d.pulito.ticket), 'il commit porta il lavoro della sporca: il biglietto pulito non lo copre').not.toContain(c);
});
