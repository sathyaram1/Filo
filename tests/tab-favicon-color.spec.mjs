import { test, expect } from './fixtures/electron.mjs';

// Regressione del fix "colore tab dal favicon".
//
// Scenario YouTube: la pagina dichiara un theme-color BIANCO (chrome neutra) ma
// il suo brand è nel favicon (rosso). Prima del fix la tab attiva veniva tinta
// col colore campionato dalla cima pagina (bianco) → tab bianca senza senso.
// Dopo il fix: il bianco non ha "identità", quindi la tab attiva ripiega sul
// colore identità del sito, che (saltato il theme-color neutro) arriva dal
// favicon → la tab è rossa.
//
// Il test asserisce il SUCCESSO (la tab diventa rossastra), non l'assenza di un
// errore: senza il fix --tab-active resterebbe bianco e l'assert fallirebbe.

test('la tab attiva prende il colore dal favicon quando il theme-color è neutro (caso YouTube)', async ({ openTab, shell, testServer }) => {
  const favSvg = encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">' +
    '<rect width="16" height="16" fill="rgb(220,20,20)"/></svg>',
  );
  const html =
    '<!doctype html><html><head>' +
    '<meta name="theme-color" content="#ffffff">' +
    `<link rel="icon" href="data:image/svg+xml,${favSvg}">` +
    '<title>theme bianco, favicon rosso</title>' +
    '</head><body style="background:#fff;height:1500px;margin:0">contenuto</body></html>';

  // openReady garantisce che i content script (campionatori di colore) siano montati.
  await testServer.openReady(openTab, html);

  // Il colore identità è asincrono (content script → main → broadcast → render),
  // con qualche retry lato content. Facciamo polling sulla tab attiva nella shell.
  const res = await shell.evaluate(async () => {
    const parse = (s) => {
      const m = /rgba?\(([^)]+)\)/.exec(s || '');
      if (!m) return null;
      const a = m[1].split(',').map((x) => parseFloat(x.trim()));
      return a.length >= 3 && a.every((n) => !Number.isNaN(n)) ? a : null;
    };
    const reddish = (a) => a && a[0] > 120 && a[0] - a[1] > 40 && a[0] - a[2] > 40;
    const read = () => {
      const el = document.querySelector('.tab.active');
      if (!el) return null;
      return el.style.getPropertyValue('--tab-active') ||
        getComputedStyle(el).getPropertyValue('--tab-active');
    };
    const deadline = Date.now() + 9000;
    let last = null;
    while (Date.now() < deadline) {
      last = read();
      if (reddish(parse(last))) return { ok: true, value: (last || '').trim() };
      await new Promise((r) => setTimeout(r, 150));
    }
    return { ok: false, value: (last || '(nessuna tab attiva)').trim() };
  });

  expect(
    res.ok,
    `--tab-active atteso rossastro (preso dal favicon), ottenuto invece: "${res.value}"`,
  ).toBe(true);
});
