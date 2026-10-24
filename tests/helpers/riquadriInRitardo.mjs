// Un sito i cui riquadri dello stesso sito arrivano solo quando la prova lo dice: così il Filo della pagina si monta
// mentre sono ancora in volo, il caso in cui toccarli gli toglieva il preload (#1568). Il racconto:
// patterns/un-clic-vero-dato-a-una-pagina-e-un-gesto-regalato.md.

import { createServer } from 'node:http';

const RIQUADRO = '<!doctype html><html><body style="margin:0;height:3000px"><p id="dentro">testo dentro il riquadro, lungo abbastanza da selezionarlo</p></body></html>';

// `cornice`: la pagina, che punta i suoi riquadri a /riquadro/<qualunque cosa>.
export async function riquadriInRitardo(cornice, riquadro = RIQUADRO) {
  const attese = [];
  let aperti = false;
  let serviti = 0;
  const server = createServer((req, res) => {
    const rispondi = (html) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); };
    if (!req.url.startsWith('/riquadro')) { rispondi(cornice); return; }
    const servi = () => { serviti += 1; rispondi(riquadro); };
    if (aperti) servi(); else attese.push(servi);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    serviti: () => serviti,
    apri() { aperti = true; for (const f of attese.splice(0)) f(); },
    chiudi: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); }),
  };
}

// Apre la pagina, aspetta che il Filo della pagina sia montato coi riquadri ancora fermi, poi li lascia arrivare.
export async function apriConRiquadriInRitardo(openTab, sito, quanti) {
  const page = await openTab(sito.url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 15_000 });
  if (sito.serviti() !== 0) throw new Error('i riquadri dovevano essere ancora in volo quando Filo si è montato nella pagina');
  sito.apri();
  const deadline = Date.now() + 10_000;
  for (;;) {
    const pronti = await Promise.all(page.frames().filter((f) => f.url().includes('/riquadro'))
      .map((f) => f.evaluate(() => document.readyState).catch(() => '')));
    if (pronti.filter((s) => s === 'complete').length >= quanti) return page;
    if (Date.now() > deadline) throw new Error(`riquadri caricati: ${pronti.length} su ${quanti}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
