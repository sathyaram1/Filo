// Verifica #592.6 — giro 1, rilievo 1. Anche l'avviso «sito pericoloso» / «sito sospetto» è una
// conferma di Filo sopra un sito: la pagina che l'avviso riguarda non deve poterlo togliere o
// confermare da sé: finché non sceglie l'utente, Filo non registra né «procedi comunque» né «continua».

import { test, expect } from '../../fixtures/electron.mjs';

// La pagina, appena Filo le mette sopra l'avviso, scrive «confermo» e preme «Procedi» / «Continua».
const OSTILE = `<!doctype html><html><head><title>Accedi a PayPal</title></head><body>
<p>Inserisci la password</p><input type="password">
<script>
  window.__premuto = '';
  const prova = () => {
    const h = document.getElementById('filo-safebrowse-host');
    const r = h && h.shadowRoot;
    if (!r) return;
    const i = r.querySelector('input');
    if (i) { i.value = 'confermo'; i.dispatchEvent(new Event('input', { bubbles: true })); }
    for (const b of r.querySelectorAll('button')) {
      if (/Procedi|Continua/.test(b.textContent)) { b.click(); window.__premuto = b.textContent; }
    }
  };
  new MutationObserver(prova).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(prova, 50);
</script></body></html>`;

async function verdetto(app, level) {
  await app.evaluate(({ BrowserWindow }, level) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w._filoTabs) continue;
      for (const t of w._filoTabs.tabs) {
        const u = t.view?.webContents?.getURL?.() || '';
        if (!/^https?:/.test(u)) continue;
        t.view.webContents.send('filo:broadcast', {
          type: 'safebrowse_update',
          level,
          message: { title: 'Sito pericoloso', body: 'Questo non è PayPal: ti sta chiedendo la password.' },
        });
      }
    }
  }, level);
}

const aggirato = (app) => app.evaluate(({ BrowserWindow }) => {
  for (const w of BrowserWindow.getAllWindows()) {
    for (const t of (w._filoTabs?.tabs || [])) {
      if ((t.sbBypass && t.sbBypass.size) || (t.sbDismissed && t.sbDismissed.size)) return true;
    }
  }
  return false;
});

for (const level of ['pericoloso', 'sospetto']) {
  test(`avviso «${level}»: la pagina non lo conferma da sé`, async ({ app, openTab, testServer }) => {
    await testServer.openReady(openTab, OSTILE);
    await verdetto(app, level);
    await new Promise((r) => setTimeout(r, 1500));
    // Nessuno ha scelto: Filo non deve aver registrato un «procedi comunque» né un «continua».
    expect(await aggirato(app)).toBe(false);
  });
}

// Stessa causa, altra porta: la proposta «Apri da un altro paese» sta nel documento del sito, che la preme da sé.
test('proposta «apri da un altro paese»: la pagina non la accetta da sé', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, `<p>Contenuto non disponibile nel tuo paese</p><script>
    setInterval(() => {
      const h = document.getElementById('filo-geoproposal-host');
      const b = h && h.shadowRoot && h.shadowRoot.querySelector('button');
      if (b) b.click();
    }, 50);
  </script>`);
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.__geoAccettate = 0;
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w._filoTabs) continue;
      w._filoTabs.geoProposeAccept = () => { globalThis.__geoAccettate++; return { ok: true }; };
      for (const t of w._filoTabs.tabs) {
        if (!/^https?:/.test(t.view?.webContents?.getURL?.() || '')) continue;
        t.view.webContents.send('filo:broadcast', { type: 'geo_propose', country: 'us', countryLabel: 'Stati Uniti' });
      }
    }
  });
  await new Promise((r) => setTimeout(r, 1500));
  expect(await app.evaluate(() => globalThis.__geoAccettate)).toBe(0);
});
