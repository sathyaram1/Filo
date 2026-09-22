// #553 giro 10 — il banner dei cookie si mangia la pagina, se non si dichiara.
//
// Il giro 9 aveva trovato questa porta e la cura l'ha chiusa a metà: il resto
// della pagina torna a essere contenuto solo quando la finestra sopra si
// dichiara come tale. Un banner scritto come un riquadro qualunque — la forma
// più diffusa quando il consenso arriva già dentro la pagina — lascia il
// contenuto nel cestino, e al modello arriva il solo banner.

import { test, expect } from '../../fixtures/electron.mjs';

const CORPO = '<div id="app" aria-hidden="true"><h1>Trattoria da Gino</h1>'
  + '<p>Siamo aperti dalle 8:00 alle 19:30, dal lunedi al sabato.</p>'
  + '<p>Il caffe costa 1,20 euro.</p></div>';

const FORME = {
  'dichiarato come finestra': '<div role="dialog" aria-modal="true"><p>Questo sito usa i cookie</p><button>Accetto tutto</button></div>',
  'scritto come un riquadro qualunque': '<div class="cookie-banner"><p>Questo sito usa i cookie</p><button>Accetto tutto</button></div>',
  'con un ruolo di zona': '<div class="cmp-wrapper" role="region"><p>Questo sito usa i cookie</p><button>Accetto tutto</button></div>',
};

const pagina = (banner) => `<!DOCTYPE html><html><head><title>Trattoria da Gino</title></head><body>${banner}${CORPO}</body></html>`;

const leggi = (app, html, url = 'https://example.com/trattoria') => app.evaluate(async (_e, [p, u]) => {
  const orig = globalThis.fetch;
  globalThis.__ripristinaRete = () => { globalThis.fetch = orig; };
  globalThis.fetch = async () => new Response(p, {
    status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
  });
  return (await globalThis.SN_EXECUTE_FILO_ACTION({ type: 'LEGGI_PAGINA', url: u })).output;
}, [html, url]);

test.afterEach(async ({ app }) => {
  await app.evaluate(() => { try { globalThis.__ripristinaRete?.(); } catch (_) {} });
});

for (const [come, banner] of Object.entries(FORME)) {
  test(`col banner ${come} arriva la pagina, non il banner`, async ({ app, openTab }) => {
    test.setTimeout(60_000);
    await openTab('filo://newtab/');
    const out = await leggi(app, pagina(banner));
    expect(out.ok).toBe(true);
    expect(String(out.text)).toContain('19:30');
    expect(String(out.text)).toContain('1,20');
  });
}
