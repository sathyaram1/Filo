// Verifica #2453 giro 1: il menu di Rinomina sopra un file della chat, che scorre dentro il suo riquadro e non con la
// pagina. Lo scorrimento finito subito prima del tasto destro non deve chiudere il menu appena aperto.
import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';

async function chatConFile(app) {
  const dir = cartellaTemporanea('filo-2453-');
  const file = join(dir, 'scan_00231.pdf');
  writeFileSync(file, '%PDF-1.4\n');
  await modelloFinto(app, [
    { toolCalls: [{ id: 'f1', name: 'APRI_FILE', arguments: JSON.stringify({ percorso: file, etichetta: 'scan_00231.pdf' }) }] },
    { text: 'Eccolo.' },
  ]);
  const page = await home(app);
  await chiedi(page, 'trova la scansione');
  const btn = page.locator('.dash-file-btn').first();
  await expect(btn).toBeVisible({ timeout: 15000 });
  // La chat più alta del suo riquadro: sotto il file c'è altro, e il riquadro scorre.
  const scorre = await page.evaluate(() => {
    const b = document.querySelector('.dash-file-btn');
    const s = b.closest('.dash-bubbles');
    const zavorra = document.createElement('div');
    zavorra.style.cssText = 'height:3000px;flex:none';
    s.appendChild(zavorra);
    s.prepend(zavorra.cloneNode());
    b.scrollIntoView({ block: 'center' });
    return { scrollHeight: s.scrollHeight, clientHeight: s.clientHeight, top: s.scrollTop, pagina: document.scrollingElement.scrollHeight > innerHeight };
  });
  expect(scorre.scrollHeight, JSON.stringify(scorre)).toBeGreaterThan(scorre.clientHeight);
  expect(scorre.pagina, 'la pagina intera non scorre: scorre solo il riquadro della chat').toBe(false);
  return page;
}

// Il riquadro della chat scorre di poco, e il tasto destro arriva nello stesso fotogramma: l'evento dello scorrimento
// arriva dopo l'apertura, come quando la voce viene portata in vista appena prima del clic.
async function scorriEApri(page) {
  return page.evaluate(async () => {
    // La disponibilità del modello è già nota (tasto destro di pochi secondi prima): il menu si apre nello stesso giro.
    await window.SN_RINOMINA_UI.disponibile();
    const b = document.querySelector('.dash-file-btn');
    b.closest('.dash-bubbles').scrollTop += 40;
    const r = b.getBoundingClientRect();
    const x = Math.round(r.left + 10);
    const y = Math.round(r.top + r.height / 2);
    b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
    return { x, y };
  });
}

// L'evento arriva un fotogramma dopo, e non sempre dopo che il menu ascolta: tre aperture di fila, ognuna deve reggere.
// `copre`: il caso provato è quello col menu disegnato sopra il punto del clic.
async function restaAperto(page, { copre = false } = {}) {
  const menu = page.locator('.sn-rinomina-menu');
  for (let giro = 0; giro < 3; giro++) {
    const punto = await scorriEApri(page);
    await expect(menu).toBeVisible();
    const esito = await page.evaluate(({ x, y }) => {
      const m = document.querySelector('.sn-rinomina-menu');
      const r = m.getBoundingClientRect();
      return { copreIlPunto: m.contains(document.elementFromPoint(x, y)), menu: [r.left, r.top, r.width, r.height].map(Math.round), angolo: getComputedStyle(m).borderTopLeftRadius };
    }, punto);
    const tutto = JSON.stringify({ giro, ...punto, ...esito });
    if (copre) expect(esito.copreIlPunto, tutto).toBe(true);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 200)))));
    await expect(menu, tutto).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  }
}

test('file della chat a metà riquadro: uno scorrimento finito prima del tasto destro non chiude il menu', async ({ app }) => {
  test.setTimeout(90_000);
  try {
    await restaAperto(await chatConFile(app));
  } finally {
    await ripristina(app);
  }
});

test('r1 con gli angoli squadrati (Raggio degli angoli a 0): uno scorrimento finito prima del tasto destro non chiude il menu', async ({ app }) => {
  test.setTimeout(90_000);
  try {
    await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ themeTokens: { radius: '0px' } }); });
    await restaAperto(await chatConFile(app), { copre: true });
  } finally {
    await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ themeTokens: {} }); });
    await ripristina(app);
  }
});


test('file della chat: uno scorrimento del riquadro dopo l\'apertura chiude ancora il menu', async ({ app }) => {
  test.setTimeout(90_000);
  try {
    const page = await chatConFile(app);
    await page.locator('.dash-file-btn').first().click({ button: 'right' });
    const menu = page.locator('.sn-rinomina-menu');
    await expect(menu).toBeVisible();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 100)))));
    await page.evaluate(() => {
      document.querySelector('.dash-file-btn').closest('.dash-bubbles').scrollTop += 60;
    });
    await expect(menu).toHaveCount(0);
  } finally {
    await ripristina(app);
  }
});
