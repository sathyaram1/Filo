// #2292 giro 5 r2: le versioni recenti di git hanno `reflog drop` (cancella la storia di un ramo) e `reflog write`
// (scrive nella storia, con la transazione che avvia l'hook reference-transaction). Il classificatore conosce come
// scritture solo expire e delete: le altre restano letture libere. Le letture vere sono show, list ed exists.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
for (const f of ['constants.js', 'contenutoEsterno.js', 'capabilities.js', 'themeTokens.js', 'cmdClassify.js',
  'zoomPagina.js', 'autonomia.js', 'preferences.js', 'actionLevels.js']) {
  require(join(ROOT, 'src', 'shared', f));
}
const C = globalThis.SN_CMD_CLASSIFY;
const A = globalThis.SN_AUTONOMIA;
const AL = globalThis.SN_ACTION_LEVELS;

const LINUX = { cwd: '/home/mario', home: '/home/mario', win: false, shell: 'sh', gitLancia: () => '' };
const PS = { cwd: 'C:\\Users\\Mario', home: 'C:\\Users\\Mario', win: true, maiuscole: true, shell: 'powershell', gitLancia: () => '' };
const ZERO = '0'.repeat(40);

test('r2 git reflog drop e write non sono letture libere', () => {
  for (const ctx of [LINUX, PS]) {
    for (const comando of ['git reflog drop --all', 'git reflog drop HEAD',
      `git reflog write refs/heads/main ${ZERO} ${'a'.repeat(40)} messaggio`]) {
      expect(C.classify(comando, ctx), comando).toBeGreaterThanOrEqual(2);
      const costo = AL.costoFor({ type: 'ESEGUI_COMANDO', comando, _perimetro: ctx });
      const d = A.decideDettaglio({ livello: 'default', stato: 'contaminato', costo, campo: 'terminale' });
      expect(d.risposta, `${comando} non deve partire senza domanda`).not.toBe('si');
    }
  }
  for (const comando of ['git reflog', 'git reflog show', 'git reflog list', 'git reflog exists HEAD']) {
    expect(C.classify(comando, LINUX), comando).toBe(1);
  }
});
