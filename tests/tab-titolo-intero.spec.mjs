// #429: con la fila delle schede mezza vuota ogni scheda mostra il titolo intero, e la scheda di Gestione
// aperta ha il colore della cima della pagina, in chiaro e in scuro. Le misure si leggono dentro le attese:
// la striscia si ridisegna quando il main annuncia le schede, e prima di quel frame le larghezze sono zero.

import { test, expect } from './fixtures/electron.mjs';
import { captureCompositeElectron } from './agent/driver.mjs';

async function verdettoTitoli(shell) {
  return shell.evaluate(() => {
    const fila = document.querySelector('.tab-row').getBoundingClientRect().width;
    const striscia = document.querySelector('.tabs').getBoundingClientRect().width;
    const schede = [...document.querySelectorAll('.tab')].map((el) => {
      const t = el.querySelector('.title');
      return {
        titolo: t.textContent,
        attiva: el.classList.contains('active'),
        w: el.getBoundingClientRect().width,
        testo: t.scrollWidth,
        posto: t.clientWidth,
      };
    });
    if (schede.length < 3 || schede.some((s) => !(s.w > 0))) return 'striscia non ancora disegnata';
    if (!(striscia + 100 < fila)) return `fila senza posto: striscia ${striscia} su ${fila}`;
    const tagliati = schede.filter((s) => s.testo > s.posto + 0.5);
    if (tagliati.length) return `titoli tagliati: ${tagliati.map((s) => `«${s.titolo}» ${s.posto}/${s.testo}`).join(', ')}`;
    // Un nome lungo dietro può fare la sua scheda più larga dell'attiva: l'attiva stacca dalla scheda tipica.
    const attiva = schede.find((s) => s.attiva);
    if (!schede.some((s) => !s.attiva && s.w < attiva.w)) return `attiva non più larga: ${schede.map((s) => s.w).join(' ')}`;
    return 'titoli interi';
  });
}

// Le prove sulla divisione della fila guardano titoli più larghi del massimo di serie (#1493): lo alzano fuori portata.
const senzaMassimo = (shell) => shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { themeTokens: { 'tab.larghezza': '1000px' } } }));

const fondoAttiva = (shell) => shell.evaluate(() => getComputedStyle(document.querySelector('.tab.active')).backgroundColor);
const cimaPagina = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test('#429 — con la fila libera nessun titolo resta a metà, e Gestione continua nella sua scheda', async ({ app, shell, openTab, testServer }) => {
  await openTab(testServer.html('<title>Memoria del sito di prova</title><body>ciao</body>'));
  const gestione = await openTab('filo://manage/manage.html');
  await gestione.waitForLoadState('domcontentloaded');

  await expect.poll(() => verdettoTitoli(shell), { timeout: 10_000 }).toBe('titoli interi');

  // Passare a un'altra scheda non stringe le altre fino a tagliarne il titolo.
  await shell.locator('.tab', { hasText: 'Memoria del sito di prova' }).click();
  await expect(shell.locator('.tab.active .title')).toHaveText('Memoria del sito di prova');
  await expect.poll(() => verdettoTitoli(shell), { timeout: 10_000 }).toBe('titoli interi');

  await shell.locator('.tab', { hasText: 'Gestione' }).click();
  await expect(shell.locator('.tab.active .title')).toHaveText('Gestione');
  const chiaro = await cimaPagina(gestione);
  await expect.poll(() => fondoAttiva(shell), { timeout: 10_000 }).toBe(chiaro);
  await captureCompositeElectron(app, 'tests/.shots/tab-titolo-intero-chiaro.png');

  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { theme: 'dark' } }));
  await expect.poll(() => cimaPagina(gestione), { timeout: 10_000 }).not.toBe(chiaro);
  // Playwright tiene la shell in chiaro per conto suo: lo scuro glielo chiede lui.
  await shell.emulateMedia({ colorScheme: 'dark' });
  const scuro = await cimaPagina(gestione);
  await expect.poll(() => fondoAttiva(shell), { timeout: 10_000 }).toBe(scuro);
  await expect.poll(() => verdettoTitoli(shell), { timeout: 10_000 }).toBe('titoli interi');
  await captureCompositeElectron(app, 'tests/.shots/tab-titolo-intero-scuro.png');
});

// Il nodo letto può essere quello che un ridisegno ha appena tolto (misura zero): si rilegge finché è a schermo.
async function rettangolo(shell, testo) {
  let r = null;
  await expect.poll(async () => {
    r = await shell.locator('.tab', { hasText: testo })
      .evaluate((el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left), w: Math.round(b.width) }; });
    return r.w;
  }, { timeout: 5_000 }).toBeGreaterThan(0);
  return r;
}

// Le schede si dividono la fila a parti uguali: il titolo più lungo che si accorcia le stringerebbe tutte, e quella
// sotto il puntatore gli scapperebbe da sotto. Si adattano quando il puntatore lascia la fila.
test('#429 — un titolo che cambia non sposta la scheda sotto il puntatore, poi la fila si adatta', async ({ app, shell, openTab, testServer }) => {
  await senzaMassimo(shell);
  await openTab(testServer.html('<title>Gestione</title><body>uno</body>'));
  const url = testServer.html('<title>Una pagina col titolo più lungo di tutti</title><body>due</body>');
  await openTab(url);
  // openTab cerca la vista per nome di host, e le due pagine stanno sullo stesso: quella giusta la dice l'indirizzo.
  let lunga = null;
  await expect.poll(() => { lunga = app.windows().find((w) => w.url().startsWith(url)); return Boolean(lunga); }).toBe(true);
  await expect(shell.locator('.tab .title', { hasText: 'titolo più lungo' })).toBeVisible();
  await expect.poll(() => verdettoTitoli(shell), { timeout: 10_000 }).toBe('titoli interi');

  await shell.locator('.tab', { hasText: 'Gestione' }).click();
  await expect(shell.locator('.tab.active .title')).toHaveText('Gestione');
  const prima = await rettangolo(shell, 'titolo più lungo');
  await shell.mouse.move(prima.x + 12, 24);

  await lunga.evaluate(() => { document.title = 'Corto'; });
  await expect(shell.locator('.tab .title', { hasText: 'Corto' })).toBeVisible();
  expect(await rettangolo(shell, 'Corto')).toEqual(prima);

  await shell.mouse.move(600, 500);
  await expect.poll(async () => (await rettangolo(shell, 'Corto')).w, { timeout: 5_000 }).toBeLessThan(prima.w);
  await expect.poll(() => verdettoTitoli(shell), { timeout: 10_000 }).toBe('titoli interi');
});

// Le schede dietro non tengono il posto di una X che non mostrano: con la fila piena il nome tagliato arriva al
// bordo, e la X che compare al passaggio non stringe il nome sotto il puntatore.
test('#429 — con la fila piena il nome tagliato arriva al bordo, e il mouse non glielo stringe', async ({ app, shell, testServer }) => {
  const url = testServer.html('<title>Cronologia delle ricerche</title><body>x</body>');
  await shell.evaluate(async (u) => {
    for (let i = 0; i < 13; i++) await window.filoShell.tabs.open(u);
  }, url);
  await expect(shell.locator('#tabs .tab')).toHaveCount(14, { timeout: 15_000 });
  const dietro = () => shell.evaluate(() => [...document.querySelectorAll('#tabs .tab:not(.active)')].slice(1, 4).map((t) => {
    const ti = t.querySelector('.title');
    return { posto: ti.clientWidth, testo: ti.scrollWidth, vuoto: Math.round(t.getBoundingClientRect().right - ti.getBoundingClientRect().right) };
  }));
  await expect.poll(async () => (await dietro()).every((s) => s.posto > 0 && s.testo > s.posto && s.vuoto <= 10), { timeout: 10_000 }).toBe(true);
  await shell.waitForTimeout(1000);
  const prima = (await dietro())[1];
  await shell.hover('#tabs .tab:nth-child(3) .favicon');
  await expect(shell.locator('#tabs .tab:nth-child(3) .close')).toHaveCSS('opacity', '1');
  expect((await dietro())[1].posto).toBe(prima.posto);
  await captureCompositeElectron(app, 'tests/.shots/tab-titolo-intero-piena.png');

  // Nella finestra più stretta, con otto schede, ognuna mostra ancora l'inizio del nome.
  await shell.mouse.move(600, 500);
  await shell.evaluate(async () => {
    for (const el of [...document.querySelectorAll('#tabs .tab')].slice(1, 7)) await window.filoShell.tabs.close(el.dataset.id);
  });
  await expect(shell.locator('#tabs .tab')).toHaveCount(8, { timeout: 10_000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs).setSize(720, 600));
  await expect.poll(async () => (await dietro()).every((s) => s.posto > 8), { timeout: 10_000 }).toBe(true);
});

test('#429 — col massimo lontano un titolo lungo si legge intero finché la fila ha posto, e l\'attiva resta più larga', async ({ shell, openTab, testServer }) => {
  await senzaMassimo(shell);
  const lungo = 'Previsioni meteo per Milano e tutta la Lombardia aggiornate ogni ora';
  await openTab(testServer.html(`<title>${lungo}</title><body>x</body>`));
  await openTab('filo://manage/manage.html');
  await expect.poll(() => verdettoTitoli(shell), { timeout: 10_000 }).toBe('titoli interi');
  await shell.locator('.tab', { hasText: 'Previsioni meteo' }).click();
  await shell.mouse.move(600, 500);
  await expect.poll(() => verdettoTitoli(shell), { timeout: 10_000 }).toBe('titoli interi');
  // L'ultima scheda attiva ha il piedino destro dentro la striscia: niente da scorrere.
  expect(await shell.evaluate(() => { const s = document.getElementById('tabs'); return s.scrollWidth - s.clientWidth; })).toBe(0);
});

// La cima della pagina che cambia colore dopo il caricamento (il tema del sito, un'intestazione tardiva).
test('#429 — la scheda attiva segue la cima della pagina anche quando cambia dopo il caricamento', async ({ shell, openTab, testServer }) => {
  const p = await openTab(testServer.html('<title>Cambia</title><body style="margin:0;background:#fff"><header id=h style="height:80px"></header>x</body>'));
  const fondo = () => shell.evaluate(() => getComputedStyle(document.querySelector('.tab.active')).backgroundColor);
  await expect.poll(fondo, { timeout: 5_000 }).toBe('rgb(255, 255, 255)');
  await p.waitForTimeout(1500);
  await p.evaluate(() => { document.body.style.background = '#111111'; });
  await expect.poll(fondo, { timeout: 5_000 }).toBe('rgb(17, 17, 17)');
  await p.evaluate(() => { document.getElementById('h').style.background = '#1f7a3a'; });
  await expect.poll(fondo, { timeout: 5_000 }).toBe('rgb(31, 122, 58)');
  // Lo stile che cambia senza toccare un elemento: una regola aggiunta al foglio, un foglio sostituito.
  await p.evaluate(() => { const s = document.createElement('style'); s.textContent = 'body{}'; document.head.appendChild(s); });
  await p.waitForTimeout(800);
  await p.evaluate(() => document.styleSheets[document.styleSheets.length - 1].insertRule('header{background:#0a3d62 !important}', 0));
  await expect.poll(fondo, { timeout: 5_000 }).toBe('rgb(10, 61, 98)');
  await p.evaluate(() => { const s = new CSSStyleSheet(); s.replaceSync('header{background:#7a1f1f !important}'); document.adoptedStyleSheets = [s]; });
  await expect.poll(fondo, { timeout: 5_000 }).toBe('rgb(122, 31, 31)');
});

test('#429 — la scheda attiva segue un\'intestazione che si colora con un\'animazione d\'ingresso', async ({ shell, openTab, testServer }) => {
  await openTab(testServer.html(`<title>Ingresso</title><style>body{margin:0;background:#fff}@keyframes v{from{background:#fff}to{background:#1f7a3a}}
    header{height:80px;animation:v .4s ease-out 1.6s both}</style><body><header></header>x</body>`));
  const fondo = () => shell.evaluate(() => getComputedStyle(document.querySelector('.tab.active')).backgroundColor);
  await expect.poll(fondo, { timeout: 8_000 }).toBe('rgb(31, 122, 58)');
});

// Una cima in due colori (una barra laterale scura che arriva in alto) dà il colore che prevale, non la media.
test('#429 — con la cima in due colori la scheda attiva prende quello che prevale', async ({ shell, openTab, testServer }) => {
  await openTab(testServer.html('<title>Mezzo</title><body style="margin:0;background:#fff"><div style="display:flex;height:60px"><div style="width:30%;background:#202124"></div><div style="flex:1;background:#fff"></div></div>x</body>'));
  const fondo = () => shell.evaluate(() => getComputedStyle(document.querySelector('.tab.active')).backgroundColor);
  await expect.poll(fondo, { timeout: 5_000 }).toBe('rgb(255, 255, 255)');
});

// Le larghezze chieste sommano al più il posto della fila: arrotondate oltre, la striscia le stringerebbe tutte
// e l'attiva, che ha esattamente la sua, perderebbe un pixel e mezzo nome.
test('#429 — con la fila piena la scheda attiva non taglia il suo nome per un pixel', async ({ app, shell }) => {
  for (const u of ['filo://manage/manage.html', 'filo://options/options.html', 'filo://history/history.html',
    'filo://feedback/feedback.html', 'filo://downloads/downloads.html']) await shell.evaluate((x) => window.filoShell.tabs.open(x), u);
  await expect(shell.locator('#tabs .tab')).toHaveCount(6, { timeout: 15_000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getBounds().width > 600)?.setSize(760, 600));
  await expect(shell.locator('.tab.active .title')).toHaveText('Download');
  await expect.poll(() => shell.evaluate(() => {
    const ti = document.querySelector('#tabs .tab.active .title');
    const tagliate = [...document.querySelectorAll('#tabs .tab:not(.active) .title')].filter((t) => t.scrollWidth > t.clientWidth + 0.5);
    if (!tagliate.length) return 'fila non ancora piena';
    return ti.scrollWidth > ti.clientWidth + 0.5 ? `«Download» ${ti.clientWidth}/${ti.scrollWidth}` : 'intero';
  }), { timeout: 10_000 }).toBe('intero');
});

// L'attiva si stacca dalle altre solo con lo spazio che avanza: un vuoto suo non taglia il nome della vicina.
test('#429 — la scheda attiva non tiene un vuoto che serve a un nome tagliato', async ({ app, shell, openTab, testServer }) => {
  await senzaMassimo(shell);
  await openTab(testServer.html('<title>Meteo Italia previsioni del tempo</title><body>x</body>'));
  await openTab(testServer.html('<title>Previsioni meteo per Milano e tutta la Lombardia aggiornate ogni ora con radar</title><body>x</body>'));
  await openTab('filo://manage/manage.html');
  await shell.mouse.move(600, 500);
  await expect(shell.locator('.tab.active .title')).toHaveText('Gestione');
  // Il posto lo dà la finestra misurata, non il carattere: col DejaVu Sans della suite le quattro in 1280px non ci
  // stanno. Avanzano 24px, molto meno dello stacco che l'attiva vorrebbe dalla scheda tipica.
  const delta = await shell.evaluate(() => {
    const schede = [...document.querySelectorAll('#tabs .tab')];
    schede.forEach((el) => el.classList.add('misura'));
    const naturali = schede.reduce((s, el) => s + Math.ceil(el.getBoundingClientRect().width), 0);
    schede.forEach((el) => el.classList.remove('misura'));
    const striscia = getComputedStyle(document.getElementById('tabs'));
    const spazio = document.querySelector('.tab-drag-spacer');
    const posto = document.getElementById('tabs').getBoundingClientRect().width - parseFloat(striscia.paddingLeft)
      - parseFloat(striscia.paddingRight) + spazio.getBoundingClientRect().width - parseFloat(getComputedStyle(spazio).minWidth);
    return Math.ceil(naturali + 24 - posto);
  });
  await app.evaluate(({ BrowserWindow }, d) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const b = w.getBounds();
    w.setSize(b.width + d, b.height);
  }, delta);
  // Le quattro schede alla loro larghezza naturale ci stanno: nessun nome resta tagliato.
  await expect.poll(() => shell.evaluate(() => [...document.querySelectorAll('.tab .title')]
    .filter((t) => t.scrollWidth > t.clientWidth + 0.5).map((t) => `${t.textContent} ${t.clientWidth}/${t.scrollWidth}`)), { timeout: 10_000 })
    .toEqual([]);
  await captureCompositeElectron(app, 'tests/.shots/tab-titolo-intero-attiva-senza-vuoto.png');
});
