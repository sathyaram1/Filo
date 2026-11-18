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
    let s = b.parentElement;
    while (s && !/(auto|scroll)/.test(getComputedStyle(s).overflowY)) s = s.parentElement;
    const zavorra = document.createElement('div');
    zavorra.style.height = '3000px';
    s.appendChild(zavorra);
    s.scrollTop = 0;
    b.scrollIntoView({ block: 'center' });
    return { classe: s.className, alto: s.scrollHeight > s.clientHeight };
  });
  expect(scorre.alto).toBe(true);
  return page;
}

// Il riquadro della chat scorre di poco, e il tasto destro arriva nello stesso fotogramma: l'evento dello scorrimento
// arriva dopo l'apertura, come quando la voce viene portata in vista appena prima del clic.
async function scorriEApri(page) {
  await page.evaluate(() => {
    const b = document.querySelector('.dash-file-btn');
    let s = b.parentElement;
    while (s && !/(auto|scroll)/.test(getComputedStyle(s).overflowY)) s = s.parentElement;
    s.scrollTop += 40;
    const r = b.getBoundingClientRect();
    b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 10, clientY: r.top + r.height / 2, button: 2 }));
  });
}

test('r1 file della chat: uno scorrimento del riquadro finito prima del tasto destro non chiude il menu', async ({ app }) => {
  test.setTimeout(90_000);
  try {
    const page = await chatConFile(app);
    await scorriEApri(page);
    const menu = page.locator('.sn-rinomina-menu');
    await expect(menu).toBeVisible();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 200)))));
    await expect(menu).toBeVisible();
  } finally {
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
      let s = document.querySelector('.dash-file-btn').parentElement;
      while (s && !/(auto|scroll)/.test(getComputedStyle(s).overflowY)) s = s.parentElement;
      s.scrollTop += 60;
    });
    await expect(menu).toHaveCount(0);
  } finally {
    await ripristina(app);
  }
});
