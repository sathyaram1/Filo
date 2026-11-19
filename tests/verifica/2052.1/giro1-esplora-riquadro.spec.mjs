// Verifica #2052.1, giro 1: esplorazione, un campo che compare tardi in un riquadro di un altro sito.
import { test, expect } from '../../fixtures/electron.mjs';

function quanti(app) {
  return app.evaluate(async () => {
    const rq = process.mainModule.require;
    const T = rq(rq('node:path').join(process.cwd(), 'src/main/services/testoDeiCampi.js'));
    return (await T.stato()).campi;
  });
}

const TARDI = `setTimeout(() => { const t = document.createElement('textarea'); t.name = 'nota'; t.id = 'nota';
  t.style.cssText = 'width:300px;height:60px'; document.getElementById('posto').appendChild(t); }, 2500);`;

test('campo tardi in un riquadro di un altro sito, senza scrivere altrove', async ({ app, openTab, testServer }) => {
  const dentro = testServer.html(`<!doctype html><body style="margin:0"><div id="posto"></div><script>${TARDI}</script></body>`, { pubblico: true });
  const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:20px"><iframe src="${dentro}" style="width:400px;height:120px"></iframe></body>`);
  const riquadro = () => page.frames().find((f) => f.url() === dentro);
  await expect.poll(() => Boolean(riquadro())).toBe(true);
  await riquadro().locator('#nota').click({ timeout: 8000 });
  await page.keyboard.type('testo che torna');
  await expect.poll(() => quanti(app), { timeout: 8000 }).toBe(1);
  await page.reload();
  await expect.poll(() => (riquadro() ? riquadro().locator('#nota').inputValue().catch(() => '') : ''), { timeout: 15000 }).toBe('testo che torna');
});
