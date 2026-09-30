// Chiusa una scheda col puntatore sulla fila in alto, le altre non cambiano larghezza finché il
// puntatore non lascia la fila (#428). Le misure si calcolano dentro le attese: la striscia si
// ridisegna quando il main annuncia le schede, e per un frame le schede non hanno ancora misura.

import { test, expect } from './fixtures/electron.mjs';

const QUANTE = 16;

async function apriSchede(shell, n) {
  await shell.evaluate(async (k) => {
    for (let i = 0; i < k; i++) await window.filoShell.tabs.open('filo://newtab/');
  }, n - 1);
  await expect(shell.locator('#tabs .tab')).toHaveCount(n, { timeout: 15_000 });
}

async function larghezze(shell) {
  return shell.evaluate(() => Object.fromEntries([...document.querySelectorAll('#tabs .tab')].map((el) => [
    el.dataset.id, { w: el.getBoundingClientRect().width, attiva: el.classList.contains('active') },
  ])));
}

// Confronta le schede ancora aperte con le misure prese prima: 'uguali', o la prima differenza.
async function verdettoUguali(shell, prima, quante) {
  const ora = await larghezze(shell);
  const ids = Object.keys(ora);
  if (ids.length !== quante) return `${ids.length} schede invece di ${quante}`;
  for (const id of ids) {
    if (!(id in prima)) return `scheda ${id} nuova`;
    if (Math.abs(ora[id].w - prima[id].w) > 0.5) return `scheda ${id}: ${prima[id].w} → ${ora[id].w}`;
  }
  return 'uguali';
}

// Le schede inattive sono tutte più larghe di prima: la striscia si è adattata alle schede rimaste.
async function verdettoAllargate(shell, prima, quante) {
  const ora = await shell.evaluate(() => [...document.querySelectorAll('#tabs .tab:not(.active)')]
    .map((el) => [el.dataset.id, el.getBoundingClientRect().width]));
  if (ora.length !== quante - 1) return `${ora.length} inattive invece di ${quante - 1}`;
  const ferme = ora.filter(([id, w]) => prima[id] && !prima[id].attiva && !(w > prima[id].w + 0.5));
  return ferme.length ? `ferme: ${ferme.map(([id, w]) => `${id}=${w}`).join(' ')}` : 'allargate';
}

async function riquadroChiudi(shell, id) {
  return shell.evaluate((x) => {
    const r = document.querySelector(`#tabs .tab[data-id="${x}"] .close`).getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  }, id);
}

async function centroChiudi(shell, id) {
  const r = await riquadroChiudi(shell, id);
  return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
}

async function idInPosizione(shell, i) {
  return shell.evaluate((k) => document.querySelectorAll('#tabs .tab')[k]?.dataset.id, i);
}

test('chiudendo con la X le altre schede tengono la larghezza, e la X accanto resta sotto il puntatore', async ({ shell }) => {
  await apriSchede(shell, QUANTE);
  const prima = await larghezze(shell);

  // La scheda in posizione 5 è inattiva (l'attiva è l'ultima aperta, in fondo).
  const bersaglio = await idInPosizione(shell, 5);
  const seguente = await idInPosizione(shell, 6);
  const punto = await centroChiudi(shell, bersaglio);
  await shell.mouse.move(punto.x, punto.y);
  await shell.mouse.click(punto.x, punto.y);
  await expect.poll(() => verdettoUguali(shell, prima, QUANTE - 1), { timeout: 8_000 }).toBe('uguali');

  // Nello stesso punto adesso c'è la X della scheda che ha preso il posto di quella chiusa.
  expect(await idInPosizione(shell, 5)).toBe(seguente);
  const x2 = await riquadroChiudi(shell, seguente);
  expect(punto.x).toBeGreaterThanOrEqual(x2.left);
  expect(punto.x).toBeLessThanOrEqual(x2.right);
  await shell.mouse.click(punto.x, punto.y);
  await expect.poll(() => verdettoUguali(shell, prima, QUANTE - 2), { timeout: 8_000 }).toBe('uguali');

  // Il puntatore lascia la fila (scende sulla pagina): le schede rimaste si allargano.
  await shell.mouse.move(punto.x, 300);
  await expect.poll(() => verdettoAllargate(shell, prima, QUANTE - 2), { timeout: 8_000 }).toBe('allargate');
});

test('col puntatore fuori dalla barra ma ancora sulla fila le larghezze restano, lasciata la fila si adattano', async ({ app, shell }) => {
  await apriSchede(shell, QUANTE);
  const prima = await larghezze(shell);
  const punto = await centroChiudi(shell, await idInPosizione(shell, 5));
  await shell.mouse.move(punto.x, punto.y);
  await shell.mouse.click(punto.x, punto.y);
  await expect.poll(() => verdettoUguali(shell, prima, QUANTE - 1), { timeout: 8_000 }).toBe('uguali');

  // Su Windows la zona vuota della fila è della finestra (la si trascina da lì): la barra riceve
  // solo l'uscita del puntatore, e dove sia davvero lo sa il main.
  const punta = (dy) => app.evaluate(({ screen, BrowserWindow }, d) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const b = w.getContentBounds();
    globalThis.__puntoFinto = { x: b.x + b.width - 200, y: b.y + d };
    if (!screen.__veroPuntatore) {
      screen.__veroPuntatore = screen.getCursorScreenPoint;
      screen.getCursorScreenPoint = () => globalThis.__puntoFinto;
    }
  }, dy);
  await punta(20);
  await shell.evaluate(() => document.documentElement.dispatchEvent(
    new MouseEvent('mouseout', { bubbles: true, relatedTarget: null }),
  ));
  await shell.waitForTimeout(700);
  expect(await verdettoUguali(shell, prima, QUANTE - 1)).toBe('uguali');

  await punta(300);
  await expect.poll(() => verdettoAllargate(shell, prima, QUANTE - 1), { timeout: 8_000 }).toBe('allargate');
});

test('chiusa col puntatore lontano dalla fila, le schede si adattano subito', async ({ shell }) => {
  await apriSchede(shell, QUANTE);
  const prima = await larghezze(shell);
  const id = await idInPosizione(shell, 5);
  await shell.mouse.move(200, 300);
  await shell.evaluate((x) => window.filoShell.tabs.close(x), id);
  await expect.poll(() => verdettoAllargate(shell, prima, QUANTE - 1), { timeout: 8_000 }).toBe('allargate');
});

test('una scheda nuova mentre le larghezze sono ferme rimette la striscia in misura', async ({ shell }) => {
  await apriSchede(shell, QUANTE);
  const prima = await larghezze(shell);
  const punto = await centroChiudi(shell, await idInPosizione(shell, 5));
  await shell.mouse.move(punto.x, punto.y);
  await shell.mouse.click(punto.x, punto.y);
  await expect.poll(() => verdettoUguali(shell, prima, QUANTE - 1), { timeout: 8_000 }).toBe('uguali');
  await shell.mouse.click(punto.x, punto.y);
  await expect.poll(() => verdettoUguali(shell, prima, QUANTE - 2), { timeout: 8_000 }).toBe('uguali');

  await shell.locator('#tab-new').click();
  await expect.poll(() => verdettoAllargate(shell, prima, QUANTE - 1), { timeout: 8_000 }).toBe('allargate');
});
