// Verifica #755 giro 3: il codice d'incorporamento che YouTube dà ai siti (allow="autoplay; encrypted-media; …")
// concede quei permessi all'origine scritta nell'attributo src; deviato in rete, il lettore nocookie li perde?

import { test, expect } from '../../fixtures/electron.mjs';

async function finto(app) {
  await app.evaluate(({ session, net }) => {
    globalThis.__p755 = [];
    session.defaultSession.protocol.handle('https', (req) => {
      const u = new URL(req.url);
      if (u.hostname === 'www.youtube-nocookie.com') {
        globalThis.__p755.push({ url: req.url, referer: req.headers.get('referer') || null });
        const body = `<!doctype html><title>NC</title><script>
          const fp = document.featurePolicy || document.permissionsPolicy;
          const r = {};
          for (const f of ['autoplay', 'encrypted-media', 'picture-in-picture', 'fullscreen', 'clipboard-write'])
            r[f] = fp ? fp.allowsFeature(f) : null;
          parent.postMessage({ nc: r, href: location.href, ref: document.referrer }, '*');
        </script>`;
        return new Response(body, { headers: { 'content-type': 'text/html' } });
      }
      return net.fetch(req, { bypassCustomProtocolHandlers: true });
    });
  });
}

const CODICE = (src) => `<iframe width="560" height="315" src="${src}" title="YouTube video player" frameborder="0"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
  referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;

function pagina(testServer, src) {
  return testServer.html(`<title>EMB</title>${CODICE(src)}
    <script>window.__esiti = []; addEventListener('message', (e) => { if (e.data && e.data.nc) window.__esiti.push(e.data); });</script>`);
}

for (const [nome, src] of [
  ['codice di YouTube su youtube.com (deviato in rete)', 'https://www.youtube.com/embed/AAA111?start=30'],
  ['stesso codice già su youtube-nocookie (controllo)', 'https://www.youtube-nocookie.com/embed/AAA111?start=30'],
]) {
  test(nome, async ({ app, openTab, testServer }) => {
    await finto(app);
    const page = await openTab(pagina(testServer, src));
    await expect.poll(() => page.evaluate(() => window.__esiti.length), { timeout: 15_000 }).toBeGreaterThan(0);
    const esito = (await page.evaluate(() => window.__esiti))[0];
    const reg = await app.evaluate(() => globalThis.__p755);
    console.log(nome, JSON.stringify({ esito, reg }));
    expect(esito.nc.autoplay, 'il lettore nocookie non ha più il permesso di partire da solo').toBe(true);
    expect(esito.nc['encrypted-media'], 'il lettore nocookie non ha più i contenuti protetti').toBe(true);
    expect(esito.nc['picture-in-picture'], 'il lettore nocookie non ha più il riquadro sempre in vista').toBe(true);
    expect(esito.nc.fullscreen).toBe(true);
    expect(reg[0].referer, 'la richiesta deviata parte senza indirizzo del sito: YouTube risponde con l\'errore 153').toBeTruthy();
  });
}
