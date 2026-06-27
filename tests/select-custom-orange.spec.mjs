// Feedback alpha (riaperto): "rendi il colore delle selezioni dei menu arancione
// ... il blu che vedi non deve mai essere presente. attualmente il colore
// dell'opzione selezionata è giusto ma non dell'opzione con il cursore sopra.
// usa l'arancione attuale due diverse opacità (maggiore per opzione selezionata);
// se l'opzione selezionata è anche quella con hover le opacità si sommano".
//
// Il popup nativo di <select> non rispetta `option:hover` e usa il blu di sistema.
// Filo lo sostituisce con un dropdown custom (vedi pageBootstrap.js). Qui
// asseriamo IL SUCCESSO del comportamento richiesto:
//   - hover su un'opzione NON selezionata → arancione a bassa opacità (0.18)
//   - opzione selezionata (non in hover)  → arancione a opacità maggiore (0.30)
//   - opzione selezionata IN hover         → opacità sommata (0.48)
//   - mai sfondo blu
//   - scegliere un'opzione aggiorna davvero il <select> sottostante (change).

import { test, expect } from './fixtures/electron.mjs';

const ACCENT = 'rgb(196, 90, 59)'; // --sn-accent #c45a3b
const ORANGE_HOVER = 'rgba(196, 90, 59, 0.18)';
const ORANGE_SELECTED = 'rgba(196, 90, 59, 0.3)';
const ORANGE_BOTH = 'rgba(196, 90, 59, 0.48)';

function isBlueish(rgb) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb || '');
  if (!m) return false;
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // "Blu di sistema": componente blu dominante e ben più alta delle altre.
  return b > 120 && b > r + 40 && b > g + 40;
}

test('il dropdown custom sostituisce il <select> nativo (niente popup blu)', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#theme', { timeout: 8_000 });

  // Il <select> nativo è ancora nel DOM (sorgente di verità) ma incartato e
  // sostituito visivamente dal bottone custom.
  const wrap = page.locator('.sn-select-wrap', { has: page.locator('#theme') });
  await expect(wrap).toHaveCount(1);
  await expect(wrap.locator('.sn-select-button')).toBeVisible();
  // Il nativo è reso invisibile (opacity 0) ma resta nel DOM.
  await expect(page.locator('#theme')).toHaveCount(1);
});

test('hover e selezione usano l\'arancione a due opacità che si sommano', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#theme', { timeout: 8_000 });

  // Porta il select su un valore noto e apri il dropdown custom.
  await page.selectOption('#theme', 'light');
  const wrap = page.locator('.sn-select-wrap', { has: page.locator('#theme') });
  await wrap.locator('.sn-select-button').click();
  const pop = wrap.locator('.sn-select-pop');
  await expect(pop).toBeVisible();

  const selected = pop.locator('.sn-select-option.sn-selected');
  const other = pop.locator('.sn-select-option:not(.sn-selected)').first();
  await expect(selected).toHaveCount(1);
  await expect(selected).toHaveText('Chiaro');

  const bg = (loc) => loc.evaluate((el) => getComputedStyle(el).backgroundColor);

  // 1) Hover su un'opzione NON selezionata → arancione bassa opacità; e così
  //    l'hover si sposta via dalla selezionata, che resta solo "selezionata".
  await other.hover();
  expect(await bg(other)).toBe(ORANGE_HOVER);
  expect(await bg(selected)).toBe(ORANGE_SELECTED);

  // 2) Hover sull'opzione selezionata → le opacità si sommano (0.18 + 0.30).
  await selected.hover();
  expect(await bg(selected)).toBe(ORANGE_BOTH);

  // 4) Nessuno sfondo blu in nessuno stato.
  for (const rgb of [ORANGE_SELECTED, ORANGE_HOVER, ORANGE_BOTH]) {
    expect(isBlueish(rgb)).toBe(false);
  }
  const allBgs = await pop.locator('.sn-select-option').evaluateAll((els) =>
    els.map((el) => getComputedStyle(el).backgroundColor),
  );
  for (const rgb of allBgs) expect(isBlueish(rgb)).toBe(false);
});

test('scegliere un\'opzione aggiorna il <select> e applica il tema', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#theme', { timeout: 8_000 });

  const wrap = page.locator('.sn-select-wrap', { has: page.locator('#theme') });
  await wrap.locator('.sn-select-button').click();
  await wrap.locator('.sn-select-option', { hasText: 'Scuro' }).click();

  // Il <select> nativo riflette la scelta (change è scattato) e il bottone
  // custom mostra la nuova etichetta.
  await expect(page.locator('#theme')).toHaveValue('dark');
  await expect(wrap.locator('.sn-select-value')).toHaveText('Scuro');
  // preferences.js applica il tema su <html> al change.
  await expect(page.locator('html')).toHaveAttribute('data-sn-theme', 'dark');
});
