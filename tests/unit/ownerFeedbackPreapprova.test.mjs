// «--preapprova» e «--chiedi-prima» non ci sono più (#1148): «fondi senza chiedermelo» è sparito, e la fiducia che lo
// sostituisce («Segna fidato») la dà solo l'owner in Gestione. Lo script le rifiuta col perché, prima di credenziali
// e rete, e non offre nessuna strada per segnare fidato.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'owner-feedback.mjs');

function lancia(args, env = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, FILO_ADMIN_REFRESH_TOKEN: '', ...env },
  });
}

test('--preapprova, --chiedi-prima e --segna-fidato si rifiutano col perché, senza toccare niente', () => {
  for (const args of [['900', '--preapprova'], ['900', '--chiedi-prima'], ['900', 'todo', 'nota', '--preapprova'], ['900', '--segna-fidato']]) {
    const r = lancia(args);
    assert.equal(r.status, 1, `${args.join(' ')}: ${r.stderr}`);
    assert.match(r.stderr, /non c'è più/, args.join(' '));
    assert.match(r.stderr, /Segna fidato/, 'rimanda al tasto di Gestione');
    assert.match(r.stderr, /Non ho toccato niente/);
  }
  // Anche passata da npm, che se la mangia nell'ambiente.
  const npm = lancia(['900'], { npm_config_preapprova: 'true' });
  assert.equal(npm.status, 1);
  assert.match(npm.stderr, /--preapprova non c'è più/);
});

test('l’uso non le nomina più, e lo script non esporta strade per il segno o per la fiducia', async () => {
  const r = lancia(['--help']);
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stderr, /preapprova|chiedi-prima/);
  const mod = await import(pathToFileURL(SCRIPT).href);
  for (const nome of ['segnaPreapprovazione', 'segnaFidato', 'FUSIONE_FERMA_DA_GESTIONE']) {
    assert.equal(mod[nome], undefined, nome);
  }
});
