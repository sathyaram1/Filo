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

test('chiusa l’ultima scheda, il + resta dov’era e il clic seguente non apre una scheda', async ({ shell }) => {
  // Con 22 schede quelle inattive sono strette quanto il +: se il + scorresse a sinistra finirebbe sotto il puntatore.
  // Così strette non hanno la X (tests/tab-scheda-stretta.spec.mjs): si chiudono col clic centrale.
  const N = 22;
  await apriSchede(shell, N);
  await shell.evaluate(async (id) => window.filoShell.tabs.activate(id), await idInPosizione(shell, 0));
  await expect(shell.locator('#tabs .tab').first()).toHaveClass(/active/);
  // Le schede finiscono di caricare in tempi diversi da una macchina all'altra: si misura a caricamento finito.
  await expect(shell.locator('#tabs .tab .spinner')).toHaveCount(0, { timeout: 15_000 });
  const prima = await larghezze(shell);
  const piu = () => shell.evaluate(() => document.getElementById('tab-new').getBoundingClientRect().left);
  const piuPrima = await piu();
  const punto = await shell.evaluate(() => {
    const r = document.querySelector('#tabs .tab:last-child').getBoundingClientRect();
    return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
  });
  await shell.mouse.move(punto.x, punto.y);
  await shell.mouse.click(punto.x, punto.y, { button: 'middle' });
  await expect.poll(() => verdettoUguali(shell, prima, N - 1), { timeout: 8_000 }).toBe('uguali');
  expect(Math.abs((await piu()) - piuPrima)).toBeLessThan(0.5);

  await shell.mouse.click(punto.x, punto.y);
  await shell.waitForTimeout(600);
  expect(await verdettoUguali(shell, prima, N - 1)).toBe('uguali');

  await shell.mouse.move(punto.x, 300);
  await expect.poll(() => verdettoAllargate(shell, prima, N - 1), { timeout: 8_000 }).toBe('allargate');
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

test('lasciata la fila, le schede si allargano subito, senza aspettare che un\'altra scheda cambi', async ({ shell }) => {
  await apriSchede(shell, QUANTE);
  const punto = await centroChiudi(shell, await idInPosizione(shell, 5));
  await shell.mouse.move(punto.x, punto.y);
  await shell.mouse.click(punto.x, punto.y);
  await expect(shell.locator('#tabs .tab')).toHaveCount(QUANTE - 1, { timeout: 8_000 });
  await shell.waitForTimeout(800);

  // Rilascio e misura nello stesso giro di JS: nessun aggiornamento delle schede può ridisegnare in mezzo.
  const esito = await shell.evaluate(() => {
    const inattive = () => [...document.querySelectorAll('#tabs .tab:not(.active)')].map((el) => el.getBoundingClientRect().width);
    const prima = inattive();
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 400, clientY: 300, bubbles: true }));
    const dopo = inattive();
    return { prima: prima[0], dopo: dopo[0], ferme: dopo.filter((w, i) => !(w > prima[i] + 0.5)).length };
  });
  expect(esito, JSON.stringify(esito)).toMatchObject({ ferme: 0 });
});
