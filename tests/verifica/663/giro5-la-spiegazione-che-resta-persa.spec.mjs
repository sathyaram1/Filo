// Verifica #663, giro 5 — la stessa famiglia dei giri 3 e 4: la frase già
// scritta per l'utente deve arrivargli INTERA, e da dove la legge deve poterci
// fare qualcosa.
//
// Il giro 3 l'ha chiesto per la chat della home, il giro 4 per il riquadro
// dell'Aiuto su una pagina web. Restano due porte: il riquadro della
// spiegazione (tasto destro / Alt+E su una selezione), che non traduce niente
// e mostra l'errore grezzo del fornitore; e l'Aiuto, che la frase adesso la
// scrive ma non porta da nessuna parte.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = '<!doctype html><meta charset="utf-8"><title>Pagina</title><p id="p">Una frase con dentro la parola sonda.</p>';

// Configurazione condivisa con modelli validi: cambia solo cosa fallisce.
async function configModelli(app, { chiave, provider }) {
  await app.evaluate(async (_e, cfg) => {
    const C = globalThis.SN_CONST;
    const D = globalThis.__filoDefaults;
    const orig = globalThis.__filoDefaultsOrigGet || D.get;
    globalThis.__filoDefaultsOrigGet = orig;
    const models = {};
    for (const a of Object.values(C.ACTIONS)) models[a] = 'testo';
    D.get = () => ({
      ...orig(), provider: 'openrouter', models,
      modelRegistry: { testo: { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash-0731' } },
      ...(cfg.chiave ? {} : { apiKeys: {} }),
    });
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: cfg.chiave }, openWeightsOnly: false });
  }, { chiave, provider });
}

// Il fornitore risponde 402: è quello che succede quando i crediti del giorno
// sono finiti, cioè a ogni utente che usa Filo con i crediti di Filo.
async function creditiFiniti(app) {
  await app.evaluate(async () => {
    const P = globalThis.SN_PROVIDER_OPENROUTER;
    const boom = () => {
      const e = new Error('OpenRouter 402: {"error":{"message":"Insufficient credits"}}');
      e.status = 402; e.provider = 'openrouter';
      throw e;
    };
    globalThis.SN_PROVIDER_OPENROUTER = { ...P, streamComplete: boom, complete: boom };
  });
}

// La strada dell'utente: selezione + la scorciatoia della spiegazione, la
// stessa che aziona il menu del tasto destro. Dalla pagina i moduli di Filo
// non si vedono (vivono nel mondo isolato del preload), quindi il comando
// arriva dal main come glielo manda la scorciatoia vera.
async function chiediSpiegazione(app, page) {
  await page.evaluate(() => {
    const n = document.getElementById('p').firstChild;
    const r = document.createRange();
    r.setStart(n, 26); r.setEnd(n, 31);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w._filoTabs) continue;
      for (const t of w._filoTabs.tabs) {
        const wc = t.view.webContents;
        if (!wc.getURL().startsWith('http')) continue;
        wc.mainFrame.send('filo:broadcast', { type: 'shortcut_triggered', command: 'explain-selection' });
      }
    }
  });
}

async function apriAiuto(app, page) {
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w._filoTabs) continue;
      for (const t of w._filoTabs.tabs) {
        const wc = t.view.webContents;
        if (!wc.getURL().startsWith('http')) continue;
        wc.mainFrame.send('filo:broadcast', { type: 'top_frame_command', surface: 'help' });
      }
    }
  });
  await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 20_000 });
}

test('crediti finiti: il riquadro della spiegazione lo dice, invece dell’errore grezzo del fornitore', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await configModelli(app, { chiave: 'k-test' });
  await creditiFiniti(app);
  const page = await testServer.openReady(openTab, PAGINA);
  await chiediSpiegazione(app, page);

  const bolla = page.locator('.sn-popup .sn-msg-assistant .sn-msg-text').last();
  await expect(bolla).toBeVisible({ timeout: 25_000 });
  // La frase esiste già e la chat della home la mostra: qui deve arrivare uguale.
  await expect(bolla).toContainText(/crediti/i, { timeout: 15_000 });
  // E niente di quello che l'utente non può leggere.
  await expect(bolla).not.toContainText('402');
  await expect(bolla).not.toContainText(/insufficient/i);
  try { await page.screenshot({ path: 'tests/.shots/663-giro5-popup-crediti-finiti.png' }); } catch (_) {}
});

test('nessuna chiave: il riquadro della spiegazione dice cosa manca (la porta già chiusa, si ricontrolla)', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await configModelli(app, { chiave: '' });
  const page = await testServer.openReady(openTab, PAGINA);
  await chiediSpiegazione(app, page);

  const bolla = page.locator('.sn-popup .sn-msg-assistant .sn-msg-text').last();
  await expect(bolla).toBeVisible({ timeout: 25_000 });
  await expect(bolla).toContainText(/invito|crediti/i, { timeout: 15_000 });
});

test('senza chiave, l’Aiuto su una pagina web porta dove si sistema', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await configModelli(app, { chiave: '' });
  const page = await testServer.openReady(openTab, PAGINA);
  await apriAiuto(app, page);
  await page.fill('.sn-sidebar-input textarea', 'cosa posso fare qui?');
  await page.press('.sn-sidebar-input textarea', 'Enter');

  const bolla = page.locator('.sn-sidebar-msg-error').last();
  await expect(bolla).toBeVisible({ timeout: 30_000 });
  await expect(bolla).toContainText(/invito|crediti/i, { timeout: 15_000 });

  // La frase nomina la pagina Crediti: da una pagina web l'utente non ha modo
  // di arrivarci. La chat della home, nello stesso stato, mette lì il tasto
  // che ce lo porta; qui dev'esserci una strada cliccabile uguale.
  const strada = page.locator('.sn-sidebar button, .sn-sidebar a').filter({ hasText: /crediti/i });
  await expect(strada.first()).toBeVisible({ timeout: 10_000 });
  try { await page.screenshot({ path: 'tests/.shots/663-giro5-aiuto-senza-chiave.png' }); } catch (_) {}
});
