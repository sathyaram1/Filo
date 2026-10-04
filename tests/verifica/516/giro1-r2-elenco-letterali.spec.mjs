// Verifica #516 giro 1, rilievo 2: un elenco di letterali fra parentesi passato a
// un programma esterno arriva come argomenti separati (`git branch ("-D","x")` è
// `git branch -D x`): deve prendere il livello della forma scritta per esteso.
import { test, expect } from '../../fixtures/electron.mjs';

const CTX = { win: true, maiuscole: true, home: 'C:\\Users\\agenti AI', cwd: 'C:\\Users\\agenti AI' };
const livello = (app, cmd) => app.evaluate((_e, { cmd, ctx }) =>
  globalThis.SN_CMD_CLASSIFY.classify(cmd, ctx), { cmd, ctx: CTX });

test('un elenco fra parentesi verso git vale gli argomenti separati che PowerShell gli passa', async ({ app }) => {
  for (const [lista, esteso] of [
    ['git branch ("-D","x")', 'git branch -D x'],
    ['git checkout ("main","--",".")', 'git checkout main -- .'],
    ['git push ("origin","--force")', 'git push origin --force'],
    ['git checkout @("main",".")', 'git checkout main .'],
  ]) {
    const atteso = await livello(app, esteso);
    expect(atteso, esteso).toBe(3);
    expect(await livello(app, lista), lista).toBe(atteso);
  }
});
