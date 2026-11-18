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
// `inFondo`: il file finisce in fondo al riquadro della chat, appena sopra la barra di scrittura, dove sta il file
// dell'ultima risposta; lì il menu non ci sta sotto il puntatore e sale a coprire il punto del clic.
async function scorriEApri(page, { inFondo = false } = {}) {
  return page.evaluate(async (inFondo) => {
    // La disponibilità del modello è già nota (tasto destro di pochi secondi prima): il menu si apre nello stesso giro.
    await window.SN_RINOMINA_UI.disponibile();
    const b = document.querySelector('.dash-file-btn');
    const s = b.closest('.dash-bubbles');
    if (inFondo) s.scrollTop += (b.getBoundingClientRect().bottom - s.getBoundingClientRect().bottom) + 30;
    s.scrollTop += 40;
    const r = b.getBoundingClientRect();
    const x = r.left + 10;
    const y = r.top + r.height / 2;
    b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
    const m = document.querySelector('.sn-rinomina-menu');
    const mr = m && m.getBoundingClientRect();
    const sb = s.getBoundingClientRect();
    return {
      copreIlPunto: !!(m && m.contains(document.elementFromPoint(x, y))), x: Math.round(x), y: Math.round(y), vw: innerWidth, vh: innerHeight,
      menu: mr && [mr.left, mr.top, mr.width, mr.height].map(Math.round), chat: [sb.left, sb.top, sb.right, sb.bottom].map(Math.round),
    };
  }, inFondo);
}

async function restaAperto(page, opzioni) {
  const esito = await scorriEApri(page, opzioni);
  const menu = page.locator('.sn-rinomina-menu');
  await expect(menu).toBeVisible();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 200)))));
  await expect(menu, JSON.stringify(esito)).toBeVisible();
  return esito;
}

test('file della chat a metà riquadro: uno scorrimento finito prima del tasto destro non chiude il menu', async ({ app }) => {
  test.setTimeout(90_000);
  try {
    await restaAperto(await chatConFile(app));
  } finally {
    await ripristina(app);
  }
});

test('r1 file dell\'ultima risposta, in fondo alla chat: uno scorrimento finito prima del tasto destro non chiude il menu', async ({ app }) => {
  test.setTimeout(90_000);
  try {
    const esito = await restaAperto(await chatConFile(app), { inFondo: true });
    expect(esito.copreIlPunto, `il caso provato è quello col menu sopra il punto del clic: ${JSON.stringify(esito)}`).toBe(true);
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
      document.querySelector('.dash-file-btn').closest('.dash-bubbles').scrollTop += 60;
    });
    await expect(menu).toHaveCount(0);
  } finally {
    await ripristina(app);
  }
});
