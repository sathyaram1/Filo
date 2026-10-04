import { test, expect } from '../../fixtures/electron.mjs';
import { pngFirmato, pngSpoglio, pngConTesto, certificato, elencoPem } from '../../helpers/immagineFirmata.mjs';

const RADICE = certificato({ organizzazione: 'Autorità di prova', nomeComune: 'Radice di prova', ca: true });
const INTERMEDIA = certificato({ organizzazione: 'Autorità di prova', nomeComune: 'Intermedia', ca: true, emittente: RADICE });
const firmatario = (organizzazione = 'OpenAI, Inc.') => ({
  cert: certificato({ organizzazione, emittente: INTERMEDIA }),
  catena: [INTERMEDIA],
});

function pagina(a, b) {
  return `<!doctype html><html><body style="padding:24px;font:16px sans-serif">
    <img id="foto" src="${a}" width="160" height="160" style="background:#e07b39">
    <img id="foto2" src="${b}" width="160" height="160" style="background:#39a0e0">
  </body></html>`;
}

for (const tema of ['light', 'dark']) {
  test(`aspetto della riga, tema ${tema}`, async ({ app, shell, openTab, testServer }) => {
    await shell.evaluate((t) => window.filoShell.message({ type: 'update_settings', settings: { theme: t } }), tema);
    const url = testServer.asset(elencoPem(RADICE), 'text/plain');
    await app.evaluate((_e, u) => globalThis.__filoFirmatariC2pa.aggiorna({ forza: true, url: u }), url);
    const a = testServer.asset(pngFirmato(firmatario()), 'image/png');
    const b = testServer.asset(pngConTesto(pngSpoglio(), 'parameters', 'un gatto astronauta\nSteps: 30'), 'image/png');
    const page = await testServer.openReady(openTab, pagina(a, b));
    await page.waitForFunction((t) => document.documentElement.dataset.snTheme === t, tema, { timeout: 8000 });
    await page.locator('#foto').click({ button: 'right', position: { x: 20, y: 20 } });
    const riga = page.locator('.sn-menu .sn-menu-origine');
    await expect(riga).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `tests/.shots/946-g8-forte-${tema}.png` });
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 5);
    await page.locator('#foto2').click({ button: 'right', position: { x: 20, y: 20 } });
    await expect(page.locator('.sn-menu .sn-menu-origine')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `tests/.shots/946-g8-debole-${tema}.png` });
  });
}
