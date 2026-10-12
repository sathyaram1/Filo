// Sonda esplorativa della verifica #429 giro 4: misure stampate, poche attese.
import { test, expect } from '../../fixtures/electron.mjs';
import { captureCompositeElectron } from '../../agent/driver.mjs';

const stato = (shell) => shell.evaluate(() => {
  const s = document.getElementById('tabs');
  const fila = document.querySelector('.tab-row')?.getBoundingClientRect().width;
  return {
    fila, striscia: s.getBoundingClientRect().width, scorre: s.scrollWidth - s.clientWidth,
    schede: [...document.querySelectorAll('#tabs .tab')].map((t) => {
      const ti = t.querySelector('.title'); const r = t.getBoundingClientRect(); const q = ti.getBoundingClientRect();
      return { nome: ti.textContent, att: t.classList.contains('active'), w: Math.round(r.width), posto: ti.clientWidth, testo: ti.scrollWidth,
        vuoto: Math.round(r.right - q.right), bg: getComputedStyle(t).backgroundColor, col: getComputedStyle(ti).color };
    }),
  };
});

test('A gestione chiaro e scuro', async ({ app, shell, openTab }) => {
  const g = await openTab('filo://manage/manage.html');
  await g.waitForLoadState('domcontentloaded');
  await shell.waitForTimeout(2000);
  console.log('A chiaro', JSON.stringify(await stato(shell)), await g.evaluate(() => getComputedStyle(document.body).backgroundColor));
  await captureCompositeElectron(app, 'tests/.shots/429-g4-A-chiaro.png');
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { theme: 'dark' } }));
  await shell.emulateMedia({ colorScheme: 'dark' });
  await shell.waitForTimeout(2500);
  console.log('A scuro', JSON.stringify(await stato(shell)), await g.evaluate(() => getComputedStyle(document.body).backgroundColor));
  await captureCompositeElectron(app, 'tests/.shots/429-g4-A-scuro.png');
});

test('B titoli lunghi', async ({ app, shell, openTab, testServer }) => {
  await openTab(testServer.html('<title>Meteo Italia previsioni del tempo</title><body>x</body>'));
  await openTab(testServer.html('<title>Previsioni meteo per Milano e tutta la Lombardia aggiornate ogni ora con radar</title><body>x</body>'));
  await openTab('filo://manage/manage.html');
  await shell.mouse.move(600, 500);
  await shell.waitForTimeout(2000);
  console.log('B', JSON.stringify(await stato(shell)));
  await captureCompositeElectron(app, 'tests/.shots/429-g4-B.png');
  await shell.evaluate(async () => { for (let i = 0; i < 9; i++) await window.filoShell.tabs.open('filo://newtab/'); });
  await shell.waitForTimeout(2000);
  console.log('B12', JSON.stringify(await stato(shell)));
  await captureCompositeElectron(app, 'tests/.shots/429-g4-B12.png');
});

test('C colore che cambia', async ({ app, shell, openTab, testServer }) => {
  const fondo = () => shell.evaluate(() => getComputedStyle(document.querySelector('.tab.active')).backgroundColor);
  // Tema del sito acceso da una regola CSS legata a una classe, con transizione.
  const p = await openTab(testServer.html(`<title>Tema</title><style>body{margin:0;background:#fff;transition:background .6s}
    html.dark body{background:#121212} @media (prefers-color-scheme: dark){ body.auto{background:#202020} }</style><body class=auto>x</body>`));
  await shell.waitForTimeout(2000);
  console.log('C iniziale', await fondo());
  await p.evaluate(() => document.documentElement.classList.add('dark'));
  await shell.waitForTimeout(1500);
  console.log('C classe+transizione', await fondo());
  await p.evaluate(() => document.documentElement.classList.remove('dark'));
  await shell.waitForTimeout(1500);
  console.log('C tolta', await fondo());
  // Tema di sistema che cambia.
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
  await shell.waitForTimeout(2000);
  console.log('C sistema scuro', await fondo(), await p.evaluate(() => getComputedStyle(document.body).backgroundColor));
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light'; });
  await shell.waitForTimeout(2000);
  // insertRule senza mutazioni del DOM.
  await p.evaluate(() => document.styleSheets[0].insertRule('body{background:#0a3d62 !important}', 0));
  await shell.waitForTimeout(1500);
  console.log('C insertRule', await fondo());
  // Intestazione animata con ritardo.
  const q = await openTab(testServer.html(`<title>Anim</title><style>body{margin:0;background:#fff}@keyframes v{to{background:#1f7a3a}}
    header{height:80px;animation:v .1s 2s forwards}</style><body><header></header>x</body>`));
  await shell.waitForTimeout(4000);
  console.log('C animazione', await fondo());
  // Pagina con intestazione per metà scura e metà bianca.
  await openTab(testServer.html(`<title>Mezzo</title><body style="margin:0;background:#fff"><div style="display:flex;height:60px"><div style="width:30%;background:#202124"></div><div style="flex:1;background:#fff"></div></div>x</body>`));
  await shell.waitForTimeout(2000);
  console.log('C mezzo', await fondo());
  await captureCompositeElectron(app, 'tests/.shots/429-g4-C-mezzo.png');
  // Immagine in cima.
  void q;
});

test('D due schede, scuro e marchi', async ({ app, shell, openTab, testServer }) => {
  const svg = (c) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><rect width='32' height='32' fill='${c}'/></svg>`)}`;
  await openTab(testServer.html(`<title>Rosso su bianco</title><link rel=icon href="${svg('#e00')}"><body style="background:#fff">x</body>`));
  await openTab(testServer.html(`<title>Bianco</title><link rel=icon href="${svg('#fff')}"><body style="background:#fff">x</body>`));
  await openTab(testServer.html(`<title>Nero</title><link rel=icon href="${svg('#000')}"><body style="background:#000">x</body>`));
  await shell.waitForTimeout(3500);
  console.log('D chiaro', JSON.stringify(await stato(shell)));
  await captureCompositeElectron(app, 'tests/.shots/429-g4-D-chiaro.png');
  await shell.locator('.tab', { hasText: 'Rosso su bianco' }).click();
  await shell.waitForTimeout(1500);
  console.log('D rosso attivo', JSON.stringify((await stato(shell)).schede.find((s) => s.att)));
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { theme: 'dark' } }));
  await shell.emulateMedia({ colorScheme: 'dark' });
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
  await shell.waitForTimeout(2500);
  console.log('D scuro', JSON.stringify(await stato(shell)));
  await captureCompositeElectron(app, 'tests/.shots/429-g4-D-scuro.png');
});

test('E stress titoli', async ({ app, shell, openTab, testServer }) => {
  await openTab(testServer.html('<title>   </title><body>x</body>'));
  await openTab(testServer.html('<title>🍕🍕🍕 Pizzeria 🎉 da Mario 🍕</title><body>x</body>'));
  await openTab(testServer.html(`<title>${'Lunghissimo '.repeat(400)}</title><body>x</body>`));
  await openTab(testServer.html('<title>&lt;b&gt;grassetto&lt;/b&gt;</title><body>x</body>'));
  await shell.mouse.move(600, 500);
  await shell.waitForTimeout(2000);
  const s = await stato(shell);
  console.log('E', JSON.stringify({ ...s, schede: s.schede.map((x) => ({ ...x, nome: x.nome.slice(0, 40) })) }));
  await captureCompositeElectron(app, 'tests/.shots/429-g4-E.png');
  // apri e chiudi in fretta
  await shell.evaluate(async () => {
    for (let i = 0; i < 6; i++) await window.filoShell.tabs.open('filo://newtab/');
    const ids = [...document.querySelectorAll('#tabs .tab')].map((t) => t.dataset.id);
    for (const id of ids.slice(-6)) window.filoShell.tabs.close(id);
  });
  await shell.waitForTimeout(2000);
  const s2 = await stato(shell);
  console.log('E dopo', JSON.stringify({ ...s2, schede: s2.schede.map((x) => ({ ...x, nome: x.nome.slice(0, 40) })) }));
});
