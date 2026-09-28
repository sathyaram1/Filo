// #587 giro 11, rilievo 1: una lettura riservata scritta in una forma che la shell accetta chiede lo stesso OK.
import { test, expect } from '../../fixtures/electron.mjs';

const LINUX = { cwd: '/home/mario', home: '/home/mario', win: false, maiuscole: false };
const WIN = { cwd: 'C:\\Users\\Mario', home: 'C:\\Users\\Mario', win: true, maiuscole: true };

const CASI = [
  [WIN, 'Get-Content -Path:.ssh\\config'],
  [WIN, 'Get-ChildItem -Path:env:'],
  [WIN, 'Get-Content Documenti\\a.txt,.ssh\\config'],
  [LINUX, "cat $'.ssh/config'"],
];

test('le forme equivalenti di una lettura riservata chiedono conferma', async ({ app }) => {
  for (const [ctx, comando] of CASI) {
    const lvl = await app.evaluate((_e, { comando, ctx }) =>
      globalThis.SN_ACTION_LEVELS.levelFor({ type: 'ESEGUI_COMANDO', comando, _perimetro: ctx }), { comando, ctx });
    expect(lvl, comando).toBeGreaterThanOrEqual(2);
  }
  // La lettura di tutti i giorni resta libera.
  const libero = await app.evaluate((_e, ctx) =>
    globalThis.SN_ACTION_LEVELS.levelFor({ type: 'ESEGUI_COMANDO', comando: 'Get-Content -Path Documenti\\a.txt', _perimetro: ctx }), WIN);
  expect(libero).toBe(1);
});
