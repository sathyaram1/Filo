// #2237.3: i controlli di fine lavoro fondevano su un main vecchio senza dirlo. In un clone a ramo singolo
// `fetch origin main` muove solo FETCH_HEAD: origin/main deve arrivare alla punta vera, e il commit si stampa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { aggiornaMain, testoBaseMain } from '../../scripts/finish-local.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('in un clone a ramo singolo i controlli portano origin/main alla punta vera prima di confrontare', () => {
  const dir = cartellaTemporanea('main-aggiornato-');
  const g = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    const nudo = join(dir, 'origine.git');
    const autore = join(dir, 'autore');
    const clone = join(dir, 'clone');
    g(dir, 'init', '-q', '--bare', '-b', 'main', nudo);
    g(dir, 'clone', '-q', nudo, autore);
    g(autore, 'config', 'user.email', 't@t'); g(autore, 'config', 'user.name', 't'); g(autore, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(autore, 'a.txt'), '1\n');
    g(autore, 'add', '-A'); g(autore, 'commit', '-qm', 'base'); g(autore, 'push', '-q', 'origin', 'HEAD:main', 'HEAD:lavoro');
    g(dir, 'clone', '-q', '--single-branch', '-b', 'lavoro', nudo, clone);
    g(clone, 'fetch', '-q', 'origin', '+refs/heads/main:refs/remotes/origin/main');
    const vecchio = g(clone, 'rev-parse', 'refs/remotes/origin/main');

    writeFileSync(join(autore, 'a.txt'), '2\n');
    g(autore, 'commit', '-qam', 'main avanti'); g(autore, 'push', '-q', 'origin', 'HEAD:main');
    const nuovo = g(autore, 'rev-parse', 'HEAD');
    g(clone, 'fetch', '-q', 'origin', 'main');
    assert.equal(g(clone, 'rev-parse', 'refs/remotes/origin/main'), vecchio, 'la scena: il fetch senza refspec lascia indietro origin/main');

    const esito = aggiornaMain(clone);
    assert.deepEqual(esito, { fetchOk: true, remoteRefOk: true });
    assert.equal(g(clone, 'rev-parse', 'refs/remotes/origin/main'), nuovo, 'la fusione e la scelta degli spec partono dal main di adesso');
  } finally {
    togliCartella(dir);
  }
});

test('la riga della linea principale dice il commit, e se lo scaricamento non è riuscito', () => {
  const sha = 'abcdef1234567890abcdef1234567890abcdef12';
  const ok = testoBaseMain({ base: 'origin/main', sha, fetchOk: true });
  assert.match(ok, /origin\/main a abcdef12, appena scaricata/);
  const vecchio = testoBaseMain({ base: 'origin/main', sha, fetchOk: false });
  assert.match(vecchio, /abcdef12, NON aggiornata/);
  assert.match(testoBaseMain({ base: 'main', sha: '', fetchOk: false }), /illeggibile/);
});

test('finish:check stampa il commit di main prima di provare la fusione e scegliere gli spec', () => {
  const src = readFileSync(resolve(ROOT, 'scripts', 'finish-local.mjs'), 'utf8');
  const main = src.slice(src.indexOf('async function main('));
  const riga = main.indexOf('testoBaseMain(');
  assert.ok(riga > main.indexOf('aggiornaMain(ROOT)'), 'prima si scarica');
  assert.ok(riga < main.indexOf('provaFusione(base'), 'poi si stampa, prima della prova della fusione');
  assert.ok(riga < main.indexOf('cambiatiPerLaScelta('), 'e prima della scelta degli spec');
  assert.doesNotMatch(main, /git\(\['fetch', 'origin', MAIN\]\)/, 'nessun fetch senza refspec');
  const verifica = readFileSync(resolve(ROOT, 'scripts', 'verify-local.mjs'), 'utf8');
  assert.doesNotMatch(verifica, /\['fetch', 'origin', MAIN\]/, 'nemmeno il riallineamento della verifica locale');
});
