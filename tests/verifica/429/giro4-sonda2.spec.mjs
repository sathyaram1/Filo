// Sonda esplorativa della verifica #429 giro 4 (seconda): porte del colore che cambia dopo il caricamento.
import { test } from '../../fixtures/electron.mjs';

const fondo = (shell) => shell.evaluate(() => getComputedStyle(document.querySelector('.tab.active')).backgroundColor);

test('F porte del colore', async ({ app, shell, openTab, testServer }) => {
  const p = await openTab(testServer.html(`<title>Regole</title><style>body{margin:0;background:#fff}</style><body>x</body>`));
  await shell.waitForTimeout(2000);
  await p.evaluate(() => document.styleSheets[0].insertRule('body{background:#0a3d62 !important}', 0));
  await shell.waitForTimeout(1500);
  console.log('F insertRule senza transizione', await fondo(shell), await p.evaluate(() => getComputedStyle(document.body).backgroundColor));
  await p.evaluate(() => { const s = new CSSStyleSheet(); s.replaceSync('body{background:#7a1f1f !important}'); document.adoptedStyleSheets = [s]; });
  await shell.waitForTimeout(1500);
  console.log('F adopted', await fondo(shell), await p.evaluate(() => getComputedStyle(document.body).backgroundColor));

  const g = await openTab('filo://manage/manage.html');
  await g.waitForLoadState('domcontentloaded');
  await shell.waitForTimeout(2000);
  console.log('F gestione prima', await fondo(shell), await g.evaluate(() => getComputedStyle(document.body).backgroundColor));
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
  await shell.waitForTimeout(2500);
  console.log('F gestione sistema scuro', await fondo(shell), await g.evaluate(() => getComputedStyle(document.body).backgroundColor),
    await g.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches));

  const q = await openTab(testServer.html(`<title>Media</title><style>body{margin:0;background:#fff}@media (prefers-color-scheme: dark){body{background:#151515}}</style><body>x</body>`));
  await shell.waitForTimeout(2000);
  console.log('F media al buio', await fondo(shell), await q.evaluate(() => getComputedStyle(document.body).backgroundColor));
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light'; });
  await shell.waitForTimeout(2500);
  console.log('F media alla luce', await fondo(shell), await q.evaluate(() => getComputedStyle(document.body).backgroundColor));

  await openTab(testServer.html(`<title>Fade</title><style>body{margin:0;background:#fff}@keyframes v{from{background:#fff}to{background:#1f7a3a}}
    header{height:80px;animation:v .4s ease-out 1.6s both}</style><body><header></header>x</body>`));
  await shell.waitForTimeout(4000);
  console.log('F animazione', await fondo(shell));
});
