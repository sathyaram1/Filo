// #2292 giro 7 r1: una lettura con un'opzione che prende un file (date -f, file -f, --files0-from, tree --fromfile) stampa
// il contenuto di quel file riga per riga, ma il controllo dei file privati guarda solo gli operandi: parte senza domanda.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
for (const f of ['constants.js', 'contenutoEsterno.js', 'capabilities.js', 'themeTokens.js', 'cmdClassify.js']) {
  require(join(ROOT, 'src', 'shared', f));
}
const C = globalThis.SN_CMD_CLASSIFY;
const LINUX = { cwd: '/home/mario', home: '/home/mario', win: false, shell: 'sh' };

test('r1 la chiave SSH letta dal valore di un\'opzione chiede come letta con cat', () => {
  const comeCat = C.classify('cat .ssh/id_rsa', LINUX);
  expect(comeCat).toBeGreaterThanOrEqual(2);
  for (const cmd of ['date -f .ssh/id_rsa', 'date --file=.ssh/id_rsa', 'file -f .ssh/id_rsa', 'file --files-from .ssh/id_rsa',
    'wc --files0-from=.ssh/id_rsa', 'du --files0-from=.ssh/id_rsa', 'tree --fromfile .ssh/id_rsa', 'date -f .aws/credentials']) {
    expect(C.classify(cmd, LINUX), cmd).toBeGreaterThanOrEqual(comeCat);
  }
});
