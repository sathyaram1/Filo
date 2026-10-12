// Verifica #429, giro 4. r1: la scheda attiva gonfiata a 1,25 volte la tipica toglie il posto a un nome che ci
// starebbe intero. r2: la cima della pagina che cambia colore senza toccare il DOM non arriva alla scheda.
// r3: un'intestazione a due colori dà alla scheda una media che sulla pagina non c'è.
import { test, expect } from '../../fixtures/electron.mjs';

const schede = (shell) => shell.evaluate(() => [...document.querySelectorAll('#tabs .tab')].map((t) => {
  const ti = t.querySelector('.title');
  return { nome: ti.textContent, att: t.classList.contains('active'), w: Math.round(t.getBoundingClientRect().width), posto: ti.clientWidth, testo: ti.scrollWidth };
}));
const fondo = (shell) => shell.evaluate(() => getComputedStyle(document.querySelector('.tab.active')).backgroundColor);

test('r1 un titolo d\'articolo non resta tagliato mentre la scheda attiva accanto ha duecento px vuoti', async ({ shell, openTab, testServer }) => {
  await openTab(testServer.html('<title>Meteo Italia previsioni del tempo</title><body>x</body>'));
  await openTab(testServer.html('<title>Previsioni meteo per Milano e tutta la Lombardia aggiornate ogni ora con radar</title><body>x</body>'));
  await openTab('filo://manage/manage.html');
  await shell.mouse.move(600, 500);
  await expect(shell.locator('.tab.active .title')).toHaveText('Gestione');
  await shell.waitForTimeout(1500);
  const s = await schede(shell);
  const attiva = s.find((x) => x.att);
  const lunga = s.find((x) => x.nome.startsWith('Previsioni'));
  // Il nome mancante (156 px) sta nel vuoto della scheda attiva: o il nome è intero, o l'attiva non ha vuoto da cedere.
  const vuotoAttiva = attiva.w - (attiva.testo > attiva.posto ? attiva.w : 0) - 64 - 63;
  expect(lunga.testo - lunga.posto <= 0.5 || vuotoAttiva < 24,
    `«Previsioni…» ${lunga.posto}/${lunga.testo} px, Gestione attiva larga ${attiva.w} px`).toBe(true);
});

test('r2 la scheda attiva segue la cima della pagina anche quando cambia senza toccare il DOM', async ({ shell, openTab, testServer }) => {
  const p = await openTab(testServer.html('<title>Regole</title><style>body{margin:0;background:#fff}</style><body>x</body>'));
  await expect.poll(() => fondo(shell), { timeout: 5_000 }).toBe('rgb(255, 255, 255)');
  await p.waitForTimeout(1500);
  // Il tema scuro di un sito scritto con una libreria che aggiunge regole al foglio di stile.
  await p.evaluate(() => document.styleSheets[0].insertRule('body{background:#0a3d62 !important}', 0));
  await expect.poll(() => fondo(shell), { timeout: 5_000 }).toBe('rgb(10, 61, 98)');
});

test('r2 la scheda attiva segue un\'intestazione che si colora con un\'animazione d\'ingresso', async ({ shell, openTab, testServer }) => {
  await openTab(testServer.html(`<title>Ingresso</title><style>body{margin:0;background:#fff}@keyframes v{from{background:#fff}to{background:#1f7a3a}}
    header{height:80px;animation:v .4s ease-out 1.6s both}</style><body><header></header>x</body>`));
  await expect.poll(() => fondo(shell), { timeout: 8_000 }).toBe('rgb(31, 122, 58)');
});

test('r3 con l\'intestazione per un terzo scura e per il resto bianca la scheda prende un colore della pagina', async ({ shell, openTab, testServer }) => {
  await openTab(testServer.html(`<title>Mezzo</title><body style="margin:0;background:#fff"><div style="display:flex;height:60px"><div style="width:30%;background:#202124"></div><div style="flex:1;background:#fff"></div></div>x</body>`));
  await shell.waitForTimeout(2000);
  expect(['rgb(255, 255, 255)', 'rgb(32, 33, 36)']).toContain(await fondo(shell));
});
