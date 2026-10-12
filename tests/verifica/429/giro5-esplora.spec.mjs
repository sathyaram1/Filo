// Esplorazione giro 5 (#429): si cancella prima della critica.
import { test, expect } from '../../fixtures/electron.mjs';
import { captureCompositeElectron } from '../../agent/driver.mjs';

const stato = (shell) => shell.evaluate(() => {
  const fila = document.querySelector('.tab-row').getBoundingClientRect();
  const st = document.querySelector('.tabs');
  return {
    fila: Math.round(fila.width), striscia: Math.round(st.getBoundingClientRect().width), scroll: st.scrollWidth - st.clientWidth,
    schede: [...document.querySelectorAll('#tabs .tab')].map((t) => {
      const ti = t.querySelector('.title'); const r = t.getBoundingClientRect();
      const cs = getComputedStyle(t); const ct = getComputedStyle(ti);
      return { nome: ti.textContent.slice(0, 40), att: t.classList.contains('active'), x: Math.round(r.left), w: Math.round(r.width), posto: ti.clientWidth, testo: ti.scrollWidth, bg: cs.backgroundColor, fg: ct.color, vis: ct.display };
    }),
  };
});
const log = (t, v) => console.log(t, JSON.stringify(v, null, 0));

test('gestione chiaro e scuro, home prima scheda', async ({ app, shell, openTab }) => {
  const g = await openTab('filo://manage/manage.html');
  await shell.waitForTimeout(2500);
  log('cima gestione', await g.evaluate(() => { const e = document.elementFromPoint(innerWidth / 2, 5); return [e.tagName, e.className, getComputedStyle(document.body).backgroundColor]; }));
  log('chiaro', await stato(shell));
  await captureCompositeElectron(app, 'tests/.shots/g5-gestione-chiaro.png');
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { theme: 'dark' } }));
  await shell.emulateMedia({ colorScheme: 'dark' });
  await shell.waitForTimeout(2500);
  log('cima gestione scuro', await g.evaluate(() => getComputedStyle(document.body).backgroundColor));
  log('scuro', await stato(shell));
  await captureCompositeElectron(app, 'tests/.shots/g5-gestione-scuro.png');
  await shell.locator('#tabs .tab').first().click();
  await shell.waitForTimeout(2500);
  log('home attiva scuro', await stato(shell));
  await captureCompositeElectron(app, 'tests/.shots/g5-home-scuro.png');
});

test('pagina nera in chiaro: leggibilita del nome', async ({ app, shell, openTab, testServer }) => {
  await openTab(testServer.html('<title>Pagina nera di prova</title><body style="margin:0;background:#000;color:#fff">x</body>'));
  await shell.waitForTimeout(2500);
  log('nera', await stato(shell));
  await openTab(testServer.html('<title>Pagina gialla</title><body style="margin:0;background:#ffd400">x</body>'));
  await shell.waitForTimeout(2500);
  log('gialla', await stato(shell));
  await captureCompositeElectron(app, 'tests/.shots/g5-nera-gialla.png');
});

test('stress: molte schede, titoli strani, apri e chiudi in fretta', async ({ app, shell, openTab, testServer }) => {
  await openTab(testServer.html('<title>😀😀 emoji 🍕 titolo &lt;b&gt;grassetto&lt;/b&gt;</title><body>x</body>'));
  await openTab(testServer.html(`<title>${'Lunghissimo '.repeat(800)}</title><body>x</body>`));
  await openTab(testServer.html('<title>   </title><body>x</body>'));
  await shell.waitForTimeout(2000);
  log('strani', await stato(shell));
  await captureCompositeElectron(app, 'tests/.shots/g5-strani.png');
  await shell.evaluate(async () => { for (let i = 0; i < 22; i++) window.filoShell.tabs.open('filo://newtab/'); });
  await shell.waitForTimeout(3000);
  log('25', await stato(shell));
  await captureCompositeElectron(app, 'tests/.shots/g5-25.png');
  // chiudi tutte le nuove schede in fretta
  for (let i = 0; i < 22; i++) { await shell.keyboard.press('Control+w'); }
  await shell.waitForTimeout(3000);
  log('dopo chiusura', await stato(shell));
  await captureCompositeElectron(app, 'tests/.shots/g5-dopo-chiusura.png');
});

test('titolo che cambia col mouse sulla fila, poi esce dalla finestra', async ({ app, shell, openTab, testServer }) => {
  const p = await openTab(testServer.html('<title>Corto</title><body>x</body>'));
  await openTab('filo://manage/manage.html');
  await shell.waitForTimeout(1500);
  const r = await shell.locator('#tabs .tab').nth(1).boundingBox();
  await shell.mouse.move(r.x + 10, r.y + 10);
  await p.evaluate(() => { document.title = 'Un titolo molto molto più lungo del primo arrivato tardi'; });
  await shell.waitForTimeout(800);
  log('trattenuto', await stato(shell));
  await shell.mouse.move(600, 500);
  await shell.waitForTimeout(1500);
  log('rilasciato', await stato(shell));
  await captureCompositeElectron(app, 'tests/.shots/g5-trattenuto.png');
});
