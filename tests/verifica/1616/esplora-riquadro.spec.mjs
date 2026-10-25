import { test } from '../../fixtures/electron.mjs';
test('esplora riquadro', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<title>R</title><p>ok</p>');
  const r = await page.evaluate(async () => {
    const f = document.createElement('iframe'); document.body.appendChild(f);
    const fw = f.contentWindow; const suo = fw.Function.prototype.toString;
    const p = Object.getPrototypeOf(suo);
    const nat = fw.eval('Object.getOwnPropertyDescriptor(Function.prototype, "toString")'); return { own: Object.getOwnPropertyNames(suo), nome: suo.name, viaFiglioEval: fw.eval('Object.getPrototypeOf(Function.prototype.toString) === Function.prototype'), stessaFn: nat.value === suo, figlio: p === fw.Function.prototype, padre: p === Function.prototype, nulla: p === null, tipo: typeof p, desc: Function.prototype.toString.call(p).slice(0, 50), ugualeTS: suo === Function.prototype.toString };
  });
  console.log('RIQ', JSON.stringify(r));
});
