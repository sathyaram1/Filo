// Verifica che il dropdown nativo <select> (es. Tema nella pagina Preferenze)
// abbia l'opzione selezionata/in-hover in arancione coerente con la palette
// Filo, invece del blu di sistema. L'utente l'aveva specificamente segnalato
// guardando lo screenshot del dropdown "Aspetto chiaro o scuro": l'opzione
// "Scuro" appariva con sfondo blu (#default-browser highlight).

import { test, expect } from './fixtures/electron.mjs';

test('preferences: select option:checked usa l\'accent arancione Filo, non il blu di sistema', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#theme', { timeout: 8_000 });

  // Si guarda il colore che l'opzione scelta prende davvero: da Electron 44 le regole di theme.css (filo://style)
  // non si leggono più da un'altra pagina di Filo, che per il motore è un'altra origine.
  const colori = await page.evaluate(() => {
    const sonda = document.createElement('div');
    sonda.style.backgroundColor = 'var(--sn-accent)';
    const lista = document.createElement('select');
    lista.size = 3;
    for (const t of ['Chiaro', 'Scuro', 'Sistema']) lista.add(new Option(t, t));
    lista.value = 'Scuro';
    document.body.append(sonda, lista);
    const esito = {
      accent: getComputedStyle(sonda).backgroundColor,
      scelta: getComputedStyle(lista.options[1]).backgroundColor,
      altra: getComputedStyle(lista.options[0]).backgroundColor,
    };
    sonda.remove(); lista.remove();
    return esito;
  });
  expect(colori.accent).not.toBe('rgba(0, 0, 0, 0)');
  expect(colori.scelta, 'l\'opzione scelta non prende l\'arancione di Filo').toBe(colori.accent);
  expect(colori.altra).not.toBe(colori.accent);
});
