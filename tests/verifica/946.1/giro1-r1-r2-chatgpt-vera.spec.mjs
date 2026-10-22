// #946.1 giro 1: un'immagine VERA di ChatGPT (2025, catena Truepic, nessuna marca temporale, certificato oggi scaduto),
// con l'elenco provvisorio vero del verificatore di riferimento: il tasto destro deve dire «Generata con l'AI, lo dichiara OpenAI».

import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { certificato, elencoPem } from '../../helpers/immagineFirmata.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const QUI = join(process.cwd(), 'tests', 'verifica', '946.1');
const VERA = readFileSync(join(QUI, 'chatgpt-vera.png'));
const PROVVISORIO = readFileSync(join(QUI, 'elenco-provvisorio.pem'), 'utf8');
const UFFICIALE = elencoPem(certificato({ organizzazione: 'Autorità di prova', nomeComune: 'Radice di prova', ca: true }));

async function rigaSullaVera(app, openTab, testServer) {
  const url = testServer.asset(UFFICIALE, 'text/plain');
  const urlProvvisorio = testServer.asset(PROVVISORIO, 'text/plain');
  const esito = await app.evaluate((_e, a) => globalThis.__filoFirmatariC2pa.aggiorna({ forza: true, ...a }), { url, urlProvvisorio });
  expect(esito.ok).toBe(true);
  const src = testServer.asset(VERA, 'image/png');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px">
    <img id="foto" src="${src}" width="160" height="240"></body></html>`);
  await page.locator('#foto').click({ button: 'right', position: { x: 20, y: 20 } });
  const menu = menuDi(page).locator('.sn-menu');
  await expect(menu).toBeVisible();
  const riga = menu.locator('.sn-menu-origine');
  await expect(riga).toHaveAttribute('aria-label', /elenco provvisorio del C2PA/, { timeout: 15000 });
  return { page, riga };
}

test('r1 un’immagine vera di ChatGPT si dice generata con l’AI, non modificata', async ({ app, openTab, testServer }) => {
  const { page, riga } = await rigaSullaVera(app, openTab, testServer);
  await page.screenshot({ path: 'tests/.shots/verifica-946.1-chatgpt-vera.png' }).catch(() => {});
  await expect(riga).toHaveAttribute('aria-label', /^Generata con l’AI/);
});
