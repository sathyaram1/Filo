// Verifica #429, giro 3, rilievo 3: la scheda in primo piano non segue la pagina quando la cima cambia
// colore dopo il caricamento (interruttore del tema del sito, intestazione che arriva tardi).

import { test, expect } from '../../fixtures/electron.mjs';

const attiva = (shell) => shell.evaluate(() => getComputedStyle(document.querySelector('.tab.active')).backgroundColor);

test('r3 il sito accende il suo tema scuro: la scheda diventa scura con lui', async ({ shell, openTab, testServer }) => {
  const p = await testServer.openReady(openTab, '<!doctype html><title>Interruttore</title><body style="margin:0;background:#fff">x</body>');
  await expect.poll(() => attiva(shell), { timeout: 5_000 }).toBe('rgb(255, 255, 255)');
  await p.waitForTimeout(2000);
  await p.evaluate(() => { document.body.style.background = '#111111'; });
  await expect.poll(() => attiva(shell), { timeout: 5_000 }).toBe('rgb(17, 17, 17)');
});

test('r3 l\'intestazione si colora tre secondi dopo il caricamento: la scheda la segue', async ({ shell, openTab, testServer }) => {
  await testServer.openReady(openTab, `<!doctype html><title>Tardi</title><body style="margin:0;background:#fff">
    <header id=h style="height:80px;background:#fff"></header>
    <script>setTimeout(() => { document.getElementById('h').style.background = '#1f7a3a'; }, 3000)</script></body>`);
  await expect.poll(() => attiva(shell), { timeout: 9_000 }).toBe('rgb(31, 122, 58)');
});
