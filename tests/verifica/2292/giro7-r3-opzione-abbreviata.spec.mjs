// #2292 giro 7 r3: i programmi GNU accettano un'opzione lunga abbreviata; `file --comp` compila come `file --compile` e
// scrive un file nella cartella, ma resta una lettura.
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

test('r3 file con l\'opzione di compilazione abbreviata scrive come quella intera', () => {
  expect(C.classify('file --compile -m magia', LINUX)).toBeGreaterThanOrEqual(2);
  for (const cmd of ['file --comp -m magia', 'file --co -m magia', 'file --compil']) {
    expect(C.classify(cmd, LINUX), cmd).toBeGreaterThanOrEqual(2);
  }
});
