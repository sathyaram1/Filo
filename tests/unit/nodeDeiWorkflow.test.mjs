// Le prove su GitHub girano col Node maggiore che Electron incorpora (#2207): il numero sta solo in `.node-version`, e
// ogni setup-node dei workflow lo legge. Un Electron con un altro Node fa rossa questa prova, non una a caso mesi dopo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeDeiWorkflow } from '../helpers/nodeDeiWorkflow.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CARTELLA = resolve(ROOT, '.github', 'workflows');
const WORKFLOW = readdirSync(CARTELLA).filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ nome: f, testo: readFileSync(resolve(CARTELLA, f), 'utf8') }));
const FILE = resolve(ROOT, '.node-version');

function nodeDiElectron() {
  try {
    const bin = createRequire(import.meta.url)('electron');
    if (typeof bin !== 'string' || !existsSync(bin)) return null;
    const r = spawnSync(bin, ['-p', 'process.versions.node'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', windowsHide: true });
    return r.status === 0 && /^\d+\.\d+\.\d+/.test(r.stdout.trim()) ? r.stdout.trim() : null;
  } catch (_) { return null; }
}
const ELECTRON = nodeDiElectron();

test('.node-version porta solo il numero maggiore', () => {
  assert.match(readFileSync(FILE, 'utf8'), /^\d+\n?$/, 'una riga col solo maggiore: setup-node prende l\'ultimo di quella serie');
});

test('ogni setup-node di ogni workflow prende il Node da .node-version, mai da un numero scritto a mano', () => {
  const tutti = WORKFLOW.flatMap((w) => nodeDeiWorkflow(w.testo).map((x) => ({ ...x, workflow: w.nome })));
  assert.ok(tutti.length >= 10, `trovati solo ${tutti.length} setup-node: la lettura dei workflow si è rotta`);
  const fuori = tutti.filter((x) => !x.fonte.file || basename(x.fonte.file) !== '.node-version');
  assert.deepEqual(fuori.map((x) => `${x.workflow} › ${x.lavoro} › ${x.passo}: ${JSON.stringify(x.fonte)}`), []);
});

test('il numero di .node-version è il Node maggiore che Electron incorpora', { skip: !ELECTRON && 'manca il binario di Electron' }, () => {
  const scritto = readFileSync(FILE, 'utf8').trim();
  const electron = ELECTRON.split('.')[0];
  assert.equal(scritto, electron, `Electron incorpora Node ${ELECTRON}: in .node-version va ${electron}, e le prove su GitHub girano con quello`);
});

test('la lettura riconosce un numero scritto a mano e un passo che non legge il file', () => {
  const wf = (corpo) => `on: push\njobs:\n  uno:\n    runs-on: ubuntu-latest\n    outputs:\n      node: \${{ steps.v.outputs.versione }}\n    steps:\n${corpo}\n  due:\n    needs: uno\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: \${{ needs.uno.outputs.node }}\n`;
  const scritto = nodeDeiWorkflow(wf('      - name: Setup Node\n        uses: actions/setup-node@v4\n        with:\n          node-version: 20'));
  assert.deepEqual(scritto[0].fonte, { letterale: '20' });
  const altrove = nodeDeiWorkflow(wf('      - id: v\n        run: echo "versione=24" >> "$GITHUB_OUTPUT"'));
  assert.ok(altrove[0].fonte.errore, 'un passo che inventa il numero non vale come .node-version');
  const letto = nodeDeiWorkflow(wf('      - id: v\n        run: |\n          V=$(tr -d \'[:space:]\' < .node-version)\n          echo "versione=$V" >> "$GITHUB_OUTPUT"'));
  assert.deepEqual(letto[0].fonte, { file: '.node-version' });
});
