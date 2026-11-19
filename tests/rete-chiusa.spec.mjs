// #1492.1 — la rete chiusa delle prove con siti finti (tests/helpers/reteChiusa.mjs): i siti finti si servono, il mini
// server locale prosegue, il resto riceve errore e si conta. sito-pubblico.test porta al mini server: se una richiesta
// verso un nome non servito uscisse sulla rete, lì riceverebbe risposta.

import { test, expect } from './fixtures/electron.mjs';
import { serviSiti, chiudiLaRete, richiesteVerso } from './helpers/reteChiusa.mjs';

// La richiesta passa dai gestori della sessione, come quella di una pagina: { stato, testo } o { errore }.
const chiedi = (app, url) => app.evaluate(async ({ session }, u) => {
  try {
    const r = await session.defaultSession.fetch(u);
    return { stato: r.status, testo: await r.text() };
  } catch (e) {
    return { errore: String(e && e.message || e) };
  }
}, url);

test('serviSiti: il sito finto risponde, il server locale prosegue, un nome non servito riceve errore e si conta', async ({ app, testServer }) => {
  await serviSiti(app, { 'finto.test/pagina': '<title>Finto</title>', 'icone.test': { corpo: 'png', tipo: 'image/png' } });

  expect(await chiedi(app, 'https://finto.test/pagina')).toEqual({ stato: 200, testo: '<title>Finto</title>' });
  expect(await chiedi(app, 'http://icone.test/qualunque/percorso.png')).toEqual({ stato: 200, testo: 'png' });
  expect(await chiedi(app, testServer.html('locale'))).toEqual({ stato: 200, testo: 'locale' });

  const fuori = testServer.html('raggiunto', { pubblico: true });
  expect(await chiedi(app, fuori)).toHaveProperty('errore');
  expect(await chiedi(app, 'https://non-servito.test/x')).toHaveProperty('errore');

  expect(await richiesteVerso(app, 'non-servito.test')).toEqual(['https://non-servito.test/x']);
  expect(await richiesteVerso(app, 'sito-pubblico.test')).toEqual([fuori]);
  expect(await richiesteVerso(app, 'finto.test')).toEqual(['https://finto.test/pagina']);
});

test('chiudiLaRete: un gestore scritto dalla prova manda il resto a `resto`, che non esce', async ({ app, testServer }) => {
  await chiudiLaRete(app);
  await app.evaluate(({ session }) => {
    session.defaultSession.protocol.handle('http', (req) => (new URL(req.url).hostname === 'mio.test'
      ? new Response('mio') : globalThis.__reteChiusa.resto(req)));
  });
  try {
    expect(await chiedi(app, 'http://mio.test/')).toEqual({ stato: 200, testo: 'mio' });
    expect(await chiedi(app, testServer.html('locale'))).toEqual({ stato: 200, testo: 'locale' });
    const fuori = testServer.html('raggiunto', { pubblico: true });
    expect(await chiedi(app, fuori)).toHaveProperty('errore');
    expect(await richiesteVerso(app, 'sito-pubblico.test')).toEqual([fuori]);
  } finally {
    await app.evaluate(({ session }) => { try { session.defaultSession.protocol.unhandle('http'); } catch (_) {} });
  }
});
