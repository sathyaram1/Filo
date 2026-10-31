// Esplorazione: aspetto della riga dei Download, della carta della home e dell'avviso, chiaro e scuro.
import { test, expect } from '../../fixtures/electron.mjs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const base = cartellaTemporanea('filo-esplora-asp-1488-');
mkdirSync(base, { recursive: true });
const caso = join(base, 'caso.json');
const SHOTS = join(process.cwd(), 'tests', '.shots');
mkdirSync(SHOTS, { recursive: true });
test.use({ envInPiu: {
  FILO_YTDLP_COMANDO: JSON.stringify([require('electron'), join(process.cwd(), 'tests', 'helpers', 'ytdlpFinto.mjs')]),
  FILO_YTDLP_FINTO_CASO: caso,
} });
const PAGINA = `<!doctype html><title>(2) Canzone della segnalazione con un titolo molto lungo che non finisce mai davvero - YouTube</title><video id="v" width="480" height="270" style="background:#222"></video>
  <script>const ms = new MediaSource(); document.getElementById('v').src = URL.createObjectURL(ms);</script>`;

for (const tema of ['light', 'dark']) {
  test(`aspetto ${tema}`, async ({ app, shell, openTab, testServer, avvisi }) => {
    test.setTimeout(90_000);
    writeFileSync(caso, JSON.stringify({ titolo: 'Canzone della segnalazione con un titolo molto lungo che non finisce mai davvero', pausaMs: 300, passi: 60 }));
    const page = await testServer.openReady(openTab, PAGINA);
    await page.locator('#v').click({ button: 'right', position: { x: 40, y: 40 } });
    await menuDi(page).locator('.sn-menu button', { hasText: 'Salva video come' }).click();
    const dl = await openTab('filo://downloads/downloads.html');
    await dl.emulateMedia({ colorScheme: tema });
    await expect(dl.locator('.dl-meta').first()).toHaveText(/In corso · \d+%/, { timeout: 15000 });
    await dl.screenshot({ path: join(SHOTS, `v1488-dl-${tema}.png`) });
    const home = await openTab('filo://dashboard/dashboard.html');
    await home.emulateMedia({ colorScheme: tema });
    await home.waitForTimeout(1500);
    await home.screenshot({ path: join(SHOTS, `v1488-home-${tema}.png`) });
    writeFileSync(caso, JSON.stringify({ errore: 'Sign in to confirm you\'re not a bot. Use --cookies-from-browser or --cookies for the authentication.' }));
    const p2 = await testServer.openReady(openTab, PAGINA);
    await p2.locator('#v').click({ button: 'right', position: { x: 40, y: 40 } });
    await menuDi(p2).locator('.sn-menu button', { hasText: 'Salva video come' }).click();
    const vista = await avvisi();
    await vista.emulateMedia({ colorScheme: tema });
    await expect(vista.locator('.shell-notif').last()).toBeVisible({ timeout: 15000 });
    await shell.screenshot({ path: join(SHOTS, `v1488-avviso-${tema}.png`) });
    await vista.screenshot({ path: join(SHOTS, `v1488-avviso-vista-${tema}.png`) });
  });
}
