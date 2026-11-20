// Verifica #1887 giro 1: la X degli avvisi sui siti (#1677) e il carattere dei riquadri sui siti (#1342), coi passi
// dell'utente e qualche stress.

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { nelMondoDiFilo } from '../../helpers/riquadri.mjs';
import { apriCronologia, testiCronologia } from '../../helpers/cronologiaAppunti.mjs';
import { carattereCronologia } from '../../helpers/menuContestuale.mjs';

const PAGINA = `<!doctype html><html><body style="margin:0;padding:40px;font:16px sans-serif;height:100vh">
  <input id="campo" style="width:320px;font-size:16px" value="testo">
</body></html>`;

function shot(page, name) {
  try { mkdirSync('tests/.shots', { recursive: true }); } catch (_) {}
  return page.screenshot({ path: `tests/.shots/${name}.png` }).catch(() => {});
}

async function sito(openTab, testServer, html = PAGINA) {
  const page = await testServer.openReady(openTab, html);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
  return page;
}

const scegliCarattere = (shell, font) =>
  shell.evaluate((f) => window.filoShell.message({ type: 'update_settings', settings: { themeTokens: f ? { font: f } : {} } }), font);

test.describe('la X degli avvisi', () => {
  test('un avviso con il puntatore sopra (in pausa) si chiude subito dalla X, anche appena comparso', async ({ app, openTab, testServer }) => {
    const page = await sito(openTab, testServer);
    await nelMondoDiFilo(app, page, () => { globalThis.SN_POPUP.showToast('Avviso uno', { duration: 2200 }); });
    const uno = page.locator('.sn-toast', { hasText: 'Avviso uno' });
    // Subito, durante la comparsa.
    await uno.locator('.sn-toast-x').click();
    await expect(uno).toHaveCount(0, { timeout: 800 });

    await nelMondoDiFilo(app, page, () => { globalThis.SN_POPUP.showToast('Avviso due', { duration: 2200 }); });
    const due = page.locator('.sn-toast', { hasText: 'Avviso due' });
    await expect(due).toHaveClass(/sn-toast-visible/);
    await due.hover();
    await page.waitForTimeout(2600);
    await expect(due, 'in pausa sotto il puntatore').toBeVisible();
    await due.locator('.sn-toast-x').click();
    await expect(due).toHaveCount(0, { timeout: 800 });
  });

  test('tre avvisi in pila: la X chiude solo il suo', async ({ app, openTab, testServer }) => {
    const page = await sito(openTab, testServer);
    await nelMondoDiFilo(app, page, () => {
      for (const t of ['Primo', 'Secondo', 'Terzo']) globalThis.SN_POPUP.showToast(`Avviso ${t}`, { duration: 60000 });
    });
    await expect(page.locator('.sn-toast.sn-toast-visible')).toHaveCount(3);
    await page.locator('.sn-toast', { hasText: 'Avviso Secondo' }).locator('.sn-toast-x').click();
    await expect(page.locator('.sn-toast', { hasText: 'Avviso Secondo' })).toHaveCount(0, { timeout: 800 });
    await expect(page.locator('.sn-toast.sn-toast-visible')).toHaveCount(2);
  });

  test('da tastiera: la X col fuoco e Invio chiude l\'avviso', async ({ app, openTab, testServer }) => {
    const page = await sito(openTab, testServer);
    await nelMondoDiFilo(app, page, () => { globalThis.SN_POPUP.showToast('Avviso tastiera', { duration: 60000 }); });
    const av = page.locator('.sn-toast', { hasText: 'Avviso tastiera' });
    await expect(av).toHaveClass(/sn-toast-visible/);
    await av.locator('.sn-toast-x').focus();
    await page.keyboard.press('Enter');
    await expect(av).toHaveCount(0, { timeout: 800 });
  });

  test('un avviso con «Segnalalo» e uno con il rimedio: la X chiude senza aprire la segnalazione né il rimedio, e non copre il testo', async ({ app, openTab, testServer }) => {
    const page = await sito(openTab, testServer);
    const lungo = 'Qualcosa non è andato come doveva e questo avviso è lungo apposta per andare a capo più volte '.repeat(2);
    await nelMondoDiFilo(app, page, (t) => {
      globalThis.__aperte = 0;
      const vero = globalThis.SN_FEEDBACK_UI.open;
      globalThis.SN_FEEDBACK_UI.open = (...a) => { globalThis.__aperte++; return vero(...a); };
      globalThis.SN_POPUP.showToast(t, { duration: 60000, segnala: 'testo della segnalazione' });
    }, lungo);
    const av = page.locator('.sn-toast', { hasText: 'apposta per andare a capo' });
    await expect(av).toHaveClass(/sn-toast-visible/);
    await page.waitForTimeout(300);
    const geo = await nelMondoDiFilo(app, page, () => {
      const t = [...document.querySelectorAll('.sn-toast')].find((n) => n.textContent.includes('apposta'));
      const x = t.querySelector('.sn-toast-x').getBoundingClientRect();
      const r = document.createRange();
      r.selectNodeContents(t.firstChild);
      const righe = [...r.getClientRects()];
      const btn = t.querySelector('.sn-msg-rimedio')?.getBoundingClientRect();
      const tocca = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      return { suTesto: righe.some((q) => tocca(q, x)), suTasto: !!btn && tocca(btn, x), dentro: (() => { const a = t.getBoundingClientRect(); return x.left >= a.left && x.right <= a.right && x.top >= a.top && x.bottom <= a.bottom; })() };
    });
    expect(geo.suTesto, 'la X non copre il testo').toBe(false);
    expect(geo.suTasto, 'la X non copre il tasto').toBe(false);
    expect(geo.dentro, 'la X sta dentro l\'avviso').toBe(true);
    await shot(page, 'verifica-1887-segnala');
    await av.locator('.sn-toast-x').click();
    await expect(av).toHaveCount(0, { timeout: 800 });
    expect(await nelMondoDiFilo(app, page, () => globalThis.__aperte)).toBe(0);
  });

  test('il clic finto del sito sull\'avviso o sulla X, anche con dispatchEvent, non chiude', async ({ app, openTab, testServer }) => {
    const page = await sito(openTab, testServer);
    await nelMondoDiFilo(app, page, () => { globalThis.SN_POPUP.showToast('Avviso protetto', { duration: 60000 }); });
    const av = page.locator('.sn-toast', { hasText: 'Avviso protetto' });
    await expect(av).toHaveClass(/sn-toast-visible/);
    await page.evaluate(() => {
      const x = document.querySelector('.sn-toast-x');
      for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) x.dispatchEvent(new MouseEvent(t, { bubbles: true, composed: true }));
      x.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await page.waitForTimeout(500);
    await expect(av).toBeVisible();
  });
});

test.describe('il carattere sui siti', () => {
  test('la cronologia segue la scelta fatta nelle impostazioni, anche a pannello aperto, e un carattere sconosciuto dà sans-serif', async ({ app, shell, openTab, testServer }) => {
    for (const t of ['prima voce', 'seconda voce']) {
      await shell.evaluate((x) => window.filoShell.message({ type: 'push_clipboard_entry', entry: { type: 'text', text: x } }), t);
    }
    await scegliCarattere(shell, "'Courier New', ui-monospace, monospace");
    const page = await sito(openTab, testServer);
    await apriCronologia(app, page, '#campo');
    await expect.poll(() => testiCronologia(app, page)).toContain('seconda voce');
    await expect.poll(() => carattereCronologia(app, page)).toBe('monospace');
    await shot(page, 'verifica-1887-cronologia-mono');
    await scegliCarattere(shell, "Georgia, 'Times New Roman', serif");
    await expect.poll(() => carattereCronologia(app, page)).toBe('serif');
    await scegliCarattere(shell, 'Lobster');
    await expect.poll(() => carattereCronologia(app, page)).toBe('sans-serif');
    await scegliCarattere(shell, "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif");
    await expect.poll(() => carattereCronologia(app, page)).toBe('system-ui, sans-serif');
  });

  test('una scheda aperta dopo la scelta parte già con la generica giusta', async ({ app, shell, openTab, testServer }) => {
    await shell.evaluate(() => window.filoShell.message({ type: 'push_clipboard_entry', entry: { type: 'text', text: 'una voce' } }));
    await scegliCarattere(shell, "'Comic Sans MS', cursive");
    const page = await sito(openTab, testServer);
    await apriCronologia(app, page, '#campo');
    await expect.poll(() => carattereCronologia(app, page)).toBe('cursive');
  });
});
