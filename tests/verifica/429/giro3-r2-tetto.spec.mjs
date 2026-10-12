// Verifica #429, giro 3, rilievo 2: una scheda non supera una larghezza fissa, e un nome appena più lungo
// resta tagliato anche con mezza fila vuota.

import { test, expect } from '../../fixtures/electron.mjs';

const verdetto = (shell, nome) => shell.evaluate((nome) => {
  const fila = document.querySelector('.tab-row').getBoundingClientRect();
  const nuova = document.getElementById('tab-new').getBoundingClientRect();
  const ctl = document.querySelector('.window-controls').getBoundingClientRect();
  const t = [...document.querySelectorAll('#tabs .tab .title')].find((e) => e.textContent === nome);
  if (!t || !(t.clientWidth > 0)) return 'scheda non ancora disegnata';
  const libero = Math.round(ctl.left - nuova.right);
  if (libero < 150) return `fila piena: ${libero} px liberi su ${Math.round(fila.width)}`;
  return t.scrollWidth > t.clientWidth + 0.5 ? `tagliato ${t.clientWidth}/${t.scrollWidth} con ${libero} px liberi` : 'intero';
}, nome);

test('r2 un titolo di trenta lettere in secondo piano si legge intero con la fila mezza vuota', async ({ shell, openTab, testServer }) => {
  await testServer.openReady(openTab, '<!doctype html><title>Meteo Italia previsioni del tempo</title><body>x</body>');
  const g = await openTab('filo://manage/manage.html');
  await g.waitForLoadState('load');
  await expect.poll(() => verdetto(shell, 'Meteo Italia previsioni del tempo'), { timeout: 10_000 }).toBe('intero');
});

test('r2 il titolo di un articolo nella scheda in primo piano si legge intero con la fila mezza vuota', async ({ shell, openTab, testServer }) => {
  const nome = 'Previsioni meteo per Milano e tutta la Lombardia aggiornate';
  await testServer.openReady(openTab, `<!doctype html><title>${nome}</title><body>x</body>`);
  await expect.poll(() => verdetto(shell, nome), { timeout: 10_000 }).toBe('intero');
});
