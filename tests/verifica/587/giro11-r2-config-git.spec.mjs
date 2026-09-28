// #587 giro 11, rilievo 2: stampare la configurazione di git o pip (che può portare un token) chiede un OK.
import { test, expect } from '../../fixtures/electron.mjs';

const LINUX = { cwd: '/home/mario', home: '/home/mario', win: false, maiuscole: false };

test('la configurazione con le credenziali non si stampa senza conferma', async ({ app }) => {
  for (const comando of ['git config --list', 'git remote -v', 'pip config list']) {
    const lvl = await app.evaluate((_e, { comando, ctx }) =>
      globalThis.SN_ACTION_LEVELS.levelFor({ type: 'ESEGUI_COMANDO', comando, _perimetro: ctx }), { comando, ctx: LINUX });
    expect(lvl, comando).toBeGreaterThanOrEqual(2);
  }
  for (const comando of ['git status', 'git log --oneline', 'git diff']) {
    const lvl = await app.evaluate((_e, { comando, ctx }) =>
      globalThis.SN_ACTION_LEVELS.levelFor({ type: 'ESEGUI_COMANDO', comando, _perimetro: ctx }), { comando, ctx: LINUX });
    expect(lvl, comando).toBe(1);
  }
});
