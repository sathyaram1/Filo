// Suite accorpata: menu account/impostazioni della shell (popup nativi).
//
// Unisce gli ex spec account-menu-layout (layout email/ombra del popup account)
// e account-menu-incognito (la voce "Nuova finestra incognito" è nel menu
// account, non più in Impostazioni) in UN solo avvio di Electron. I test sono
// stateless (non scrivono storage persistente): aprono popup-menu nativi e ne
// leggono il contenuto. Un beforeEach chiude eventuali popup residui, così il
// popup di un test non viene scambiato per quello del successivo.
//
// I body dei test sono identici agli originali (stessi assert): cambia solo da
// dove arrivano `app`/`shell` (app condivisa lanciata in beforeAll).

import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHTML, computeMenuWidth } from '../src/main/popup-menu.js';
import { argomentiScala } from './fixtures/electron.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..');

let app = null;
let shell = null;
let userData = null;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'filo-test-'));
  app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  try { await app.close(); } catch (_) {}
  try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  app = null; shell = null; userData = null;
});

// Chiudi eventuali popup-menu nativi (BrowserWindow data:text/html) lasciati
// aperti da un test precedente, così openMenuText non li scambia per il popup
// del test corrente.
test.beforeEach(async () => {
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      let url = '';
      try { url = w.webContents.getURL(); } catch (_) {}
      if (url.startsWith('data:text/html')) { try { w.destroy(); } catch (_) {} }
    }
  });
});

// ───────────────────────── account-menu-layout ─────────────────────────────
test.describe('layout menu account', () => {
  const EMAIL = 'sathyarampontillo@gmail.com';
  const ENTRIES = [
    { label: EMAIL, disabled: true },
    { type: 'separator' },
    { label: 'Esci', icon: 'close', action: 'auth-signout' },
  ];

  test('menu account: email centrata e ombra non tagliata', async () => {
    const MARGIN = 26;
    const width = computeMenuWidth(ENTRIES);
    const html = buildHTML(ENTRIES, false, MARGIN);
    // Finestra alla larghezza REALE che il main process userebbe in produzione
    // (WIDTH + gutter su entrambi i lati), così misuriamo il layout vero.
    const winW = width + MARGIN * 2;
    const measured = await app.evaluate(async ({ BrowserWindow }, { html, winW }) => {
      const win = new BrowserWindow({ show: false, width: winW, height: 200, webPreferences: {} });
      await win.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      await new Promise((r) => setTimeout(r, 250));
      const res = await win.webContents.executeJavaScript(`(() => {
        const menu = document.querySelector('.menu');
        const email = document.querySelector('.item.disabled');
        const lbl = email.querySelector('.lbl');
        const mr = menu.getBoundingClientRect();
        const lr = lbl.getBoundingClientRect();
        return {
          menuLeft: mr.left, menuRight: mr.right, menuWidth: mr.width,
          lblLeft: lr.left, lblRight: lr.right,
          lblScrollW: lbl.scrollWidth, lblClientW: lbl.clientWidth,
          marginPx: parseFloat(getComputedStyle(menu).marginLeft),
          boxShadow: getComputedStyle(menu).boxShadow,
        };
      })()`);
      win.destroy();
      return res;
    }, { html, winW });

    // 1) Email non troncata: il testo ci sta tutto (niente ellissi).
    expect(measured.lblScrollW, 'email troncata: il campo è troppo stretto').toBeLessThanOrEqual(measured.lblClientW + 1);

    // 2) Email centrata: lo spazio a sinistra e a destra del testo dentro il menu
    // è ~uguale (tolleranza 6px). Prima del fix la colonna icona vuota la spingeva
    // a destra → margini molto sbilanciati.
    const leftGap = measured.lblLeft - measured.menuLeft;
    const rightGap = measured.menuRight - measured.lblRight;
    expect(Math.abs(leftGap - rightGap), `email non centrata (sx=${leftGap.toFixed(1)} dx=${rightGap.toFixed(1)})`).toBeLessThanOrEqual(6);

    // 3) Il gutter trasparente attorno al menu contiene l'ombra: l'offset+blur del
    // box-shadow (0 4px 20px → ~24px sotto) deve stare nel margin della finestra.
    expect(measured.marginPx, 'gutter insufficiente per l\'ombra').toBeGreaterThanOrEqual(24);
  });
});

// ──────────────────────── account-menu-incognito ───────────────────────────
test.describe('incognito spostato nel menu account', () => {
  // Clicca un bottone della shell e ritorna il testo del popup-menu nativo aperto.
  async function openMenuText(app, shell, btnId) {
    // Chiudi eventuali popup residui dando focus alla shell.
    await shell.bringToFront().catch(() => {});
    // I bottoni della barra sono ora trigger interni nascosti (le icone visibili
    // sono dentro la home): li azioniamo con un click DOM diretto, come il bridge.
    await shell.evaluate((id) => document.getElementById(id).click(), btnId);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const popup = app.windows().find((w) => w.url().startsWith('data:text/html'));
      if (popup) {
        try {
          await popup.waitForSelector('.menu', { timeout: 1000 });
          const txt = await popup.locator('.menu').innerText();
          if (txt && txt.trim()) return txt;
        } catch (_) { /* popup chiuso/non pronto: ritenta */ }
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`popup non aperto/leggibile per #${btnId}`);
  }

  test('menu account contiene "Nuova finestra incognito" (da sloggato)', async () => {
    // Nei test non c'è sessione Google → accountBtn è in stato sloggato.
    const txt = await openMenuText(app, shell, 'nav-account');
    expect(txt, 'manca "Nuova finestra incognito" nel menu account').toContain('Nuova finestra incognito');
    // Da sloggato il menu offre anche l'accesso.
    expect(txt, 'manca "Accedi" nel menu account sloggato').toContain('Accedi con Google');
  });

  test('menu Impostazioni NON contiene più "Nuova finestra incognito"', async () => {
    const txt = await openMenuText(app, shell, 'nav-settings');
    // Sanity: è davvero il menu Impostazioni (contiene "Preferenze").
    expect(txt, 'non sembra il menu Impostazioni').toContain('Preferenze');
    expect(txt, 'incognito è ancora nel menu Impostazioni: non è stato spostato').not.toContain('incognito');
  });
});
