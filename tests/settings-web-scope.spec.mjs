// #589 — le impostazioni spinte alle schede non portano segreti nelle pagine web.
//
// Quando si salva una preferenza, Filo spinge le impostazioni a tutte le
// superfici aperte. I content script girano anche sui siti esterni, quindi
// quella spinta arriva a ogni pagina visitata: dentro le impostazioni ci sono
// le chiavi dei servizi a pagamento e le credenziali del proxy (utente e
// password nell'URL).
//
// Qui si guarda il messaggio DAVVERO consegnato a ciascun frame, all'ultimo
// passaggio prima del renderer, e si pretende:
//   - alla pagina del mini server (https/http): nessun segreto, e solo i campi
//     ammessi (src/shared/settingsScope.js);
//   - alla pagina filo://: l'oggetto intero, chiavi comprese;
//   - e che la spinta continui a FUNZIONARE sulla pagina esterna (il token
//     estetico cambia live), altrimenti la difesa avrebbe spento una funzione.
//
// Senza il fix il primo controllo è rosso: la spinta mandava l'oggetto intero
// a tutti.

import { test, expect } from './fixtures/electron.mjs';

const CHIAVE = 'sk-or-v1-SENTINELLA-589-CHIAVE';
const PROXY_URL = 'socks5://utente-it:SENTINELLA-589-PASSWORD@gate.example.com:7000';

// Spia sull'ultimo passaggio main→renderer: registra ogni broadcast con
// l'indirizzo del frame che lo riceve. Copre sia l'invio per-frame sia il
// ripiego su webContents.send.
async function installaSpia(app) {
  await app.evaluate(({ BrowserWindow }) => {
    if (globalThis.__spia589) return;
    globalThis.__spia589 = [];
    const registra = (url, message) => {
      try {
        if (message && message.type === 'settings_updated') {
          globalThis.__spia589.push({ url: String(url || ''), settings: message.settings });
        }
      } catch (_) {}
    };
    const win = BrowserWindow.getAllWindows()[0];
    const wcProto = Object.getPrototypeOf(win.webContents);
    const origWcSend = wcProto.send;
    wcProto.send = function (channel, ...args) {
      if (channel === 'filo:broadcast') { let u = ''; try { u = this.getURL(); } catch (_) {} registra(u, args[0]); }
      return origWcSend.call(this, channel, ...args);
    };
    const frame = win.webContents.mainFrame;
    if (frame) {
      const frProto = Object.getPrototypeOf(frame);
      const origFrSend = frProto.send;
      frProto.send = function (channel, ...args) {
        if (channel === 'filo:broadcast') { let u = ''; try { u = this.url; } catch (_) {} registra(u, args[0]); }
        return origFrSend.call(this, channel, ...args);
      };
    }
  });
}

const leggiSpia = (app) => app.evaluate(() => globalThis.__spia589 || []);

const cssVar = (page, name) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

test('la spinta delle impostazioni non porta chiavi API né credenziali proxy nelle pagine web', async ({ app, shell, openTab, testServer }) => {
  // L'utente ha configurato chiave e proxy dalle Preferenze (origine filo://).
  await shell.evaluate(([chiave, proxy]) => window.filoShell.message({
    type: 'update_settings',
    settings: { apiKeys: { openrouter: chiave }, proxy: { datacenter: proxy, residential: proxy } },
  }), [CHIAVE, PROXY_URL]);

  // Una pagina esterna aperta (il content script di Filo ci gira sopra) e una
  // pagina interna: la stessa spinta deve trattarle in modo diverso.
  const web = await testServer.openReady(openTab, '<h1>pagina esterna</h1><p>testo</p>');
  const interna = await openTab('filo://preferences/preferences.html');

  await installaSpia(app);

  // Ora si cambia una preferenza qualunque: parte la spinta a tutti.
  await shell.evaluate(() => window.filoShell.message({
    type: 'update_settings',
    settings: { themeTokens: { accent: '#1e90ff' } },
  }));

  // La spinta FUNZIONA ancora sulla pagina esterna: il token arriva e si applica.
  await expect.poll(() => cssVar(web, '--sn-accent')).toBe('#1e90ff');

  const consegne = await leggiSpia(app);
  expect(consegne.length, 'nessuna consegna di settings_updated registrata').toBeGreaterThan(0);

  const versoWeb = consegne.filter((c) => /^https?:/.test(c.url));
  expect(versoWeb.length, 'la pagina esterna non ha ricevuto la spinta').toBeGreaterThan(0);
  for (const c of versoWeb) {
    const dump = JSON.stringify(c.settings ?? null);
    expect(dump, `chiave API consegnata a ${c.url}`).not.toContain(CHIAVE);
    expect(dump, `password del proxy consegnata a ${c.url}`).not.toContain('SENTINELLA-589-PASSWORD');
    expect(c.settings?.apiKeys, `apiKeys consegnate a ${c.url}`).toBeUndefined();
    expect(c.settings?.proxy, `proxy consegnato a ${c.url}`).toBeUndefined();
    // ...ma ciò che serve al content script c'è.
    expect(c.settings?.themeTokens).toEqual({ accent: '#1e90ff' });
    expect(c.settings?.featureFlags, 'i flag delle funzioni servono al content script').toBeTruthy();
  }

  const versoInterna = consegne.filter((c) => c.url.startsWith('filo://'));
  expect(versoInterna.length, 'le superfici interne non hanno ricevuto la spinta').toBeGreaterThan(0);
  expect(
    versoInterna.some((c) => c.settings?.apiKeys?.openrouter === CHIAVE),
    'le pagine filo:// devono continuare a ricevere le impostazioni intere',
  ).toBe(true);

  // La pagina interna resta funzionante (la preferenza è arrivata anche lì).
  await expect.poll(() => cssVar(interna, '--sn-accent')).toBe('#1e90ff');
});

test('anche la lettura a richiesta da una pagina web è ridotta ai campi ammessi', async ({ app, shell, openTab, testServer }) => {
  await shell.evaluate(([chiave, proxy]) => window.filoShell.message({
    type: 'update_settings',
    settings: { apiKeys: { openrouter: chiave }, proxy: { datacenter: proxy } },
  }), [CHIAVE, PROXY_URL]);

  const web = await testServer.openReady(openTab, '<h1>pagina esterna</h1>');
  const url = web.url();

  // GET_SETTINGS chiesto con l'origine della pagina esterna: è la strada che
  // percorre il content script al suo avvio.
  const risposta = await app.evaluate(async ({}, pageUrl) => {
    const H = globalThis.__filoHandlers;
    return H.handleMessage({ type: 'get_settings' }, { url: pageUrl });
  }, url);

  const dump = JSON.stringify(risposta?.settings ?? null);
  expect(dump).not.toContain(CHIAVE);
  expect(dump).not.toContain('SENTINELLA-589-PASSWORD');
  expect(risposta?.settings?.theme, 'il tema serve al content script').toBeTruthy();

  // La stessa richiesta da una pagina interna riceve tutto.
  const rispostaInterna = await app.evaluate(async () => {
    const H = globalThis.__filoHandlers;
    return H.handleMessage({ type: 'get_settings' }, { url: 'filo://newtab/' });
  });
  expect(rispostaInterna?.settings?.apiKeys?.openrouter).toBe(CHIAVE);
});
