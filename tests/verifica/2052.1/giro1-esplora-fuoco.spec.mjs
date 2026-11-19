// Verifica #2052.1, giro 1: il testo rimesso in un campo comparso tardi non sposta il cursore di chi scrive altrove.
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

const pagina = (editore, extra = '') => `<!doctype html><meta charset="utf-8"><body style="padding:20px;font:16px sans-serif">
${editore}
<div id="posto"></div>${extra}
<script>${TARDI}</script></body>`;

async function preparaETorna(app, openTab, testServer, html) {
  const page = await testServer.openReady(openTab, html);
  await page.locator('#nota').click({ timeout: 8000 });
  await page.keyboard.type('testo che torna');
  await expect.poll(() => quanti(app), { timeout: 8000 }).toBe(1);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  return page;
}

const torna = (page) => expect.poll(() => page.locator('#nota').inputValue().catch(() => ''), { timeout: 10000 }).toBe('testo che torna');

test('editore ricco nella pagina, con un grassetto in mezzo', async ({ app, openTab, testServer }) => {
  const page = await preparaETorna(app, openTab, testServer, pagina('<div id="ed" contenteditable="true" style="width:400px;min-height:80px;border:1px solid #999"></div>'));
  await page.locator('#ed').click();
  await page.keyboard.type('Primo ');
  await page.keyboard.press('Control+b');
  await page.keyboard.type('pezzo ');
  await torna(page);
  await page.keyboard.type('secondo pezzo');
  await expect.poll(() => page.locator('#ed').innerText()).toBe('Primo pezzo secondo pezzo');
});

test('editore ricco con una parola selezionata quando torna il testo', async ({ app, openTab, testServer }) => {
  const page = await preparaETorna(app, openTab, testServer, pagina('<div id="ed" contenteditable="true" style="width:400px;min-height:80px;border:1px solid #999"></div>'));
  await page.locator('#ed').click();
  await page.keyboard.type('Primo pezzo sbagliato');
  await page.keyboard.press('Shift+Control+ArrowLeft');
  await torna(page);
  await page.keyboard.type('giusto');
  await expect.poll(() => page.locator('#ed').innerText()).toBe('Primo pezzo giusto');
});

test('editore ricco dentro un riquadro della pagina (come i vecchi editor di posta)', async ({ app, openTab, testServer }) => {
  const page = await preparaETorna(app, openTab, testServer, pagina('<iframe id="fr" srcdoc="<body contenteditable=true style=&quot;min-height:60px&quot;></body>" style="width:400px;height:100px"></iframe>'));
  const corpo = page.frameLocator('#fr').locator('body');
  await corpo.click();
  await page.keyboard.type('Primo pezzo ');
  await torna(page);
  await page.keyboard.type('secondo pezzo');
  console.log('DOVE', await page.evaluate(() => [document.activeElement?.id, document.getElementById('nota').value, document.getElementById('fr').contentDocument.activeElement?.tagName, document.getElementById('fr').contentDocument.hasFocus()]));
  await expect.poll(() => corpo.innerText()).toBe('Primo pezzo secondo pezzo');
});

test('editore ricco dentro un componente con la sua ombra', async ({ app, openTab, testServer }) => {
  const extra = `<script>customElements.define('x-ed', class extends HTMLElement { constructor() { super();
    this.attachShadow({ mode: 'open' }).innerHTML = '<div id="dentro" contenteditable="true" style="width:400px;min-height:60px;border:1px solid #999"></div>'; } });</script>`;
  const page = await preparaETorna(app, openTab, testServer, pagina('<x-ed id="ed"></x-ed>', extra));
  const dentro = page.locator('#ed #dentro');
  await dentro.click();
  await page.keyboard.type('Primo pezzo ');
  await torna(page);
  await page.keyboard.type('secondo pezzo');
  await expect.poll(() => dentro.innerText()).toBe('Primo pezzo secondo pezzo');
});

test('il campo tardi sta in un riquadro di un altro sito, si scrive nella pagina', async ({ app, openTab, testServer }) => {
  const dentro = testServer.html(`<!doctype html><body style="margin:0"><div id="posto"></div><script>${TARDI}</script></body>`, { pubblico: true });
  const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:20px">
    <div id="ed" contenteditable="true" style="width:400px;min-height:80px;border:1px solid #999"></div>
    <iframe src="${dentro}" style="width:400px;height:120px"></iframe></body>`);
  const riquadro = () => page.frames().find((f) => f.url() === dentro);
  await expect.poll(() => Boolean(riquadro())).toBe(true);
  await riquadro().locator('#nota').click({ timeout: 8000 });
  await page.keyboard.type('testo che torna');
  await expect.poll(() => quanti(app), { timeout: 8000 }).toBe(1);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await page.locator('#ed').click();
  await page.keyboard.type('Primo pezzo ');
  await expect.poll(() => (riquadro() ? riquadro().locator('#nota').inputValue().catch(() => '') : ''), { timeout: 10000 }).toBe('testo che torna');
  await page.keyboard.type('secondo pezzo');
  await expect.poll(() => page.locator('#ed').innerText()).toBe('Primo pezzo secondo pezzo');
});

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

test('casella normale con il cursore in mezzo', async ({ app, openTab, testServer }) => {
  const page = await preparaETorna(app, openTab, testServer, pagina('<input id="ed" style="width:300px">'));
  await page.locator('#ed').click();
  await page.keyboard.type('Primo  pezzo');
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft');
  await torna(page);
  await page.keyboard.type('vero');
  await expect(page.locator('#ed')).toHaveValue('Primo vero pezzo');
});
