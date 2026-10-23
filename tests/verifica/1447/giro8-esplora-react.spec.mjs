// Esplorazione del giro 8 di verifica #1447: una textarea controllata da React (le chat fatte con React).
import fs from 'node:fs';
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDelMenu } from '../../helpers/menuContestuale.mjs';

const LIB = process.env.LIB_EDITORI;
const leggi = (p) => fs.readFileSync(`${LIB}/${p}`, 'utf8');
const PAGINA = () => `<!doctype html><meta charset="utf-8"><body style="padding:20px;font:22px sans-serif" lang="it">
<div id="m"></div>
<script>${leggi('react-16.14.0/package/umd/react.production.min.js')}</script>
<script>${leggi('react-dom-16.14.0/package/umd/react-dom.production.min.js')}</script>
<script>
function App() {
  const [v, set] = React.useState('');
  const [inviati, setInviati] = React.useState([]);
  window.stato = () => v;
  window.inviati = () => inviati;
  return React.createElement('div', null,
    React.createElement('textarea', { id: 'ta', value: v, style: { width: 700, height: 100, font: '22px monospace' },
      onChange: (e) => set(e.target.value),
      onKeyDown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); setInviati([...inviati, v]); set(''); } } }));
}
ReactDOM.render(React.createElement(App), document.getElementById('m'));
</script></body>`;

test('esplora react', async ({ app, openTab, testServer }) => {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ featureFlags: { spellcheck: true, spellcheckContext: false }, correttore: { modelloErrori: false, automatica: true } });
  });
  const page = await testServer.openReady(openTab, PAGINA(), { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
  await page.locator('#ta').click();
  await page.keyboard.type('Ciao marco come va, non so perchè ok');
  await page.waitForTimeout(300);
  console.log('stato react:', JSON.stringify(await page.evaluate(() => window.stato())), 'valore:', JSON.stringify(await page.locator('#ta').inputValue()));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  console.log('inviato:', JSON.stringify(await page.evaluate(() => window.inviati())));
  await page.keyboard.type('Vedo marco ');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  console.log('dopo annulla stato:', JSON.stringify(await page.evaluate(() => window.stato())), 'valore:', JSON.stringify(await page.locator('#ta').inputValue()));
  await page.keyboard.type('ok');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  console.log('inviato 2:', JSON.stringify(await page.evaluate(() => window.inviati())));
});
