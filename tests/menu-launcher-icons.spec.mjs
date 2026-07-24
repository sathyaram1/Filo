// Il menu App (launcher nella shell) è reso da src/main/popup-menu.js in una
// BrowserWindow a parte: ogni voce mostra la sua icona SOLO se il nome icona
// esiste nel registro ICON_PATHS di quel file. "Mazzi" (icona `decks`) e
// "Bacheca" (icona `board`) comparivano senza icona perché quei nomi mancavano
// dal registro del menu — feedback #292. Questo spec verifica che ogni voce del
// launcher renda un <svg>, eseguendo il vero codice del main.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/electron.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Le voci con icona del launcher App (specchio di APPS in src/renderer/shell.js).
const LAUNCHER_ITEMS = [
  { label: 'Editor', icon: 'editor' },
  { label: 'Deck builder MTG', icon: 'decks' },
  { label: 'Feedback', icon: 'feedback' },
  { label: 'Bacheca', icon: 'board' },
  { label: 'Gestione', icon: 'feedback' },
];

test('ogni voce del menu App rende la sua icona SVG', async ({ app }) => {
  const appRoot = await app.evaluate(({ app: a }) => a.getAppPath());
  const popupPath = path.join(appRoot, 'src', 'main', 'popup-menu.js');

  const html = await app.evaluate((_electron, args) => {
    // eslint-disable-next-line global-require
    const mod = require(args.popupPath);
    return mod.buildHTML(args.entries, false);
  }, { popupPath, entries: LAUNCHER_ITEMS });

  // Ogni voce deve avere una etichetta E un <svg> nella sua riga: contiamo gli
  // <svg> e verifichiamo che le due voci prima mute siano ora presenti.
  for (const it of LAUNCHER_ITEMS) {
    expect(html, `manca l'etichetta "${it.label}"`).toContain(it.label);
  }
  // Numero di icone renderizzate = numero di voci (tutte hanno un'icona valida).
  const svgCount = (html.match(/<svg/g) || []).length;
  expect(svgCount, 'una o più voci del launcher sono senza icona').toBe(LAUNCHER_ITEMS.length);
});
