// r1 — «la stessa ricerca dalla chat della home e dalla chat di una scheda»: l'assistente di pagina (Aiuto), la chat
// che sta dentro una scheda, non sa cercare fra i documenti dell'utente né mostrargli il file trovato.
import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { cartellaDellaProva, BOLLETTA_MARZO } from '../../helpers/documentiFinti.mjs';

test('r1 le istruzioni dell\'Aiuto gli offrono la ricerca fra i documenti dell\'utente', async ({ app }) => {
  const istruzioni = await app.evaluate(() => globalThis.SN_CONST.PROMPTS.help({ url: 'https://example.com/', title: 'Esempio' }));
  expect(istruzioni).toContain('CERCA_DOCUMENTI');
});

test('r1 dall\'Aiuto, «mi serve la bolletta della luce di marzo» porta il file al modello e all\'utente', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const dir = join(await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR), 'Aiuto');
  cartellaDellaProva(dir);
  try {
    const page = await openTab('filo://newtab/');
    await page.waitForFunction(() => typeof window.SN_SIDEBAR?.open === 'function', null, { timeout: 8000 });
    await page.evaluate(() => {
      window.__turni = [];
      let primo = true;
      const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (msg, ...rest) => {
        if (msg && msg.type === 'ai_request') {
          window.__turni.push(JSON.parse(JSON.stringify(msg.payload)));
          if (msg.payload && msg.payload.userMessage && primo) {
            primo = false;
            return Promise.resolve({ ok: true, text: '{"action":"filo","filo":{"type":"CERCA_DOCUMENTI","cosa":"bolletta luce energia elettrica kWh marzo"},"status":"continue"}' });
          }
          return Promise.resolve({ ok: true, text: '{"text":"È scan_00231.pdf, la bolletta della luce di marzo.","status":"done"}' });
        }
        if (msg && msg.type === 'capture_visible_tab') return Promise.resolve({ ok: false });
        return orig(msg, ...rest);
      };
    });
    await page.evaluate(() => window.SN_SIDEBAR.open());
    await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 8000 });
    await page.fill('.sn-sidebar-input textarea', 'mi serve la bolletta della luce di marzo');
    await page.press('.sn-sidebar-input textarea', 'Enter');
    // Il turno dopo la ricerca porta al modello i candidati, col file giusto.
    await expect.poll(() => page.evaluate((nome) => (window.__turni || []).some((t) => JSON.stringify(t).includes(nome)), BOLLETTA_MARZO), { timeout: 20_000 })
      .toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
