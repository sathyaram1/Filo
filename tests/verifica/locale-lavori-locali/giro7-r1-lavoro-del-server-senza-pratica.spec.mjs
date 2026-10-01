// Verifica locale «lavori locali», giro 7, rilievo 1: anche il lavoro sul server ha la sua pratica. Il comando che
// porta un ramo del server su main deve chiederla (o accettarla) come la chiusura del lavoro nell'app. Solo a vuoto.
import { test, expect } from './../../fixtures/electron.mjs';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

function cartellaDelServer() {
  let d = join(import.meta.dirname, '..', '..', '..');
  for (let i = 0; i < 6; i++) {
    const c = join(dirname(d), 'filo-security', 'functions', 'tools', 'server-fondi.js');
    if (existsSync(c)) return dirname(dirname(c));
    d = dirname(d);
  }
  return '';
}

test('server:fondi non porta su main un lavoro locale senza la sua pratica', async () => {
  const funzioni = cartellaDelServer();
  test.skip(!funzioni, 'checkout del server non trovato accanto al repo');
  const lancia = (...a) => spawnSync(process.execPath, [join('tools', 'server-fondi.js'), 'claude/lavori-locali', ...a, '--dry-run'], { cwd: funzioni, encoding: 'utf8', timeout: 120000 });
  const senza = lancia();
  const conPratica = lancia('--feedback', '910');
  const testoSenza = `${senza.stdout}\n${senza.stderr}`;
  const accettata = conPratica.status !== 2 && !/argomenti non capiti/.test(`${conPratica.stdout}${conPratica.stderr}`);
  expect(/pratica|--feedback/i.test(testoSenza) || accettata, `senza pratica:\n${testoSenza}\ncon --feedback 910:\n${conPratica.stdout}${conPratica.stderr}`).toBe(true);
});
