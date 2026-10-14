// La caccia al banner dei cookie si ferma (#1106): sulle pagine che aggiungono nodi di continuo Filo non ripassa la
// pagina intera dopo l'esito o a finestra chiusa, nemmeno nei riquadri di altri siti; un banner che torna, o che
// arriva tardi, si rifiuta lo stesso. Le prove di base del rifiuto stanno in cookies.spec.mjs e cookies-banner.spec.mjs.

import { test, expect } from './fixtures/electron.mjs';
import { nelMondoDiFilo } from './helpers/riquadri.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LINK = (n) => Array.from({ length: n }, (_, i) => `<a href="#p${i}">post ${i}</a>`).join(' ');

// Come uno scroll infinito o una chat dal vivo: un nodo nuovo, con un link e un pulsante, ogni 50 ms.
const VIVO = `<div id="feed"></div><script>
  let i = 0;
  setInterval(() => {
    const d = document.createElement('div');
    d.innerHTML = '<a href="#r' + (++i) + '">risposta ' + i + '</a> <button>Mi piace</button>';
    document.getElementById('feed').appendChild(d);
  }, 50);
</script>`;

const ONETRUST = (rifiuta) => `<div id="onetrust-banner-sdk" style="position:fixed;bottom:0;left:0;right:0;height:120px;background:#222;color:#fff;z-index:10">
  <p>Questo sito usa i cookie.</p>
  <button id="onetrust-accept-btn-handler" onclick="window.__accettati=(window.__accettati||0)+1;this.parentNode.remove()">Accetta tutto</button>
  <button id="onetrust-reject-all-handler" onclick="window.__rifiuti=(window.__rifiuti||0)+1;this.parentNode.remove()">${rifiuta}</button>
</div>`;

const SENZA_CMP = (id, stile = '') => `<div id="${id}" class="cookie-consent" style="position:fixed;top:0;left:0;right:0;height:90px;background:#fff;z-index:10;${stile}">
  <p>Usiamo i cookie per la pubblicità.</p>
  <button onclick="window.__accettati=(window.__accettati||0)+1;this.parentNode.remove()">Accetta</button>
  <button onclick="window.__rifiuti=(window.__rifiuti||0)+1;this.parentNode.remove()">Rifiuta</button>
</div>`;

const stato = (app, page) => nelMondoDiFilo(app, page, () => globalThis.SN_COOKIES_CS._state());
const nodiNuovi = (page) => page.evaluate(() => document.querySelectorAll('#feed > div').length);

// Il modulo dei cookie in un riquadro di un altro sito vive in un mondo isolato che solo il protocollo di debug raggiunge.
async function statoNelRiquadro(page, frame) {
  let s;
  try { s = await page.context().newCDPSession(frame); } catch (_) { s = await page.context().newCDPSession(page); }
  try {
    const contesti = [];
    s.on('Runtime.executionContextCreated', ({ context }) => contesti.push(context));
    await s.send('Runtime.enable');
    for (const c of contesti.filter((x) => x.auxData && x.auxData.type === 'isolated')) {
      const { result } = await s.send('Runtime.evaluate', {
        contextId: c.id, returnByValue: true,
        expression: `location.href === ${JSON.stringify(frame.url())} && globalThis.SN_COOKIES_CS ? globalThis.SN_COOKIES_CS._state() : null`,
      }).catch(() => ({ result: {} }));
      if (result && result.value) return result.value;
    }
    return null;
  } finally { await s.detach().catch(() => {}); }
}

test('dopo il rifiuto la pagina viva non si ripassa più; un banner rimontato si rifiuta ancora', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, `<title>VIVA_RIFIUTO</title>${LINK(2000)}${ONETRUST('Rifiuta tutto')}${VIVO}`);
  await page.waitForFunction(() => !document.getElementById('onetrust-banner-sdk'), null, { timeout: 10_000 });
  expect(await page.evaluate(() => [window.__rifiuti, window.__accettati])).toEqual([1, undefined]);

  await expect.poll(async () => (await stato(app, page)).hunting, { timeout: 5_000 }).toBe(false);
  const prima = await stato(app, page);
  const nodiPrima = await nodiNuovi(page);
  expect(prima.fullScans).toBeGreaterThan(0);
  await sleep(15_000);
  const dopo = await stato(app, page);
  expect(await nodiNuovi(page) - nodiPrima, 'la pagina ha continuato ad aggiungere nodi').toBeGreaterThan(100);
  expect(dopo.fullScans, 'giri sul documento intero dopo il rifiuto').toBe(prima.fullScans);

  // L'applicazione rimonta il CMP, con un «rifiuta» che solo la regola del CMP riconosce.
  await page.evaluate((html) => document.body.insertAdjacentHTML('beforeend', html), ONETRUST('Solo tecnici'));
  await page.waitForFunction(() => !document.getElementById('onetrust-banner-sdk'), null, { timeout: 5_000 });
  // E un banner senza CMP noto, riconosciuto dal testo.
  await page.evaluate((html) => document.body.insertAdjacentHTML('beforeend', html), SENZA_CMP('rimontato'));
  await page.waitForFunction(() => !document.getElementById('rimontato'), null, { timeout: 5_000 });
  expect(await page.evaluate(() => [window.__rifiuti, window.__accettati])).toEqual([3, undefined]);
});

test('senza banner, a finestra chiusa la pagina e il riquadro vivi non si ripassano; un banner tardivo si rifiuta', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const riquadro = testServer.html(`<title>RIQUADRO_VIVO</title>${LINK(300)}${VIVO}`).replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab, `<title>VIVA_VUOTA</title>${LINK(2000)}
    <iframe id="terzi" src="${riquadro}" style="width:400px;height:200px"></iframe>${VIVO}`);
  let frame = null;
  await expect.poll(() => (frame = page.frames().find((f) => f.url().includes('blocked.test'))) && true, { timeout: 8_000 }).toBe(true);
  await expect.poll(async () => (await statoNelRiquadro(page, frame))?.fullScans || 0, { timeout: 8_000 }).toBeGreaterThan(0);

  // La finestra di caccia è di 20 s: chiusa quella, sia la pagina sia il riquadro guardano solo i nodi nuovi.
  await expect.poll(async () => (await stato(app, page)).hunting, { timeout: 35_000, intervals: [1_000] }).toBe(false);
  await expect.poll(async () => (await statoNelRiquadro(page, frame))?.hunting, { timeout: 10_000 }).toBe(false);
  const prima = await stato(app, page);
  const primaRiquadro = await statoNelRiquadro(page, frame);
  const nodiPrima = await nodiNuovi(page);
  const nodiRiquadroPrima = await frame.evaluate(() => document.querySelectorAll('#feed > div').length);
  await sleep(5_000);
  expect(await nodiNuovi(page) - nodiPrima).toBeGreaterThan(40);
  expect(await frame.evaluate(() => document.querySelectorAll('#feed > div').length) - nodiRiquadroPrima).toBeGreaterThan(40);
  expect((await stato(app, page)).fullScans, 'giri sul documento intero della pagina').toBe(prima.fullScans);
  expect((await statoNelRiquadro(page, frame)).fullScans, 'giri sul documento intero del riquadro').toBe(primaRiquadro.fullScans);

  // Un banner che entra nascosto e compare dopo, senza nodi nuovi: il suo «Rifiuta» riapre la caccia.
  await page.evaluate((html) => {
    document.body.insertAdjacentHTML('beforeend', html);
    setTimeout(() => { document.getElementById('tardivo').style.display = 'block'; }, 600);
  }, SENZA_CMP('tardivo', 'display:none'));
  await page.waitForFunction(() => !document.getElementById('tardivo'), null, { timeout: 8_000 });
  expect(await page.evaluate(() => [window.__rifiuti, window.__accettati])).toEqual([1, undefined]);

  // I video di YouTube incorporati passano a youtube-nocookie anche a caccia chiusa, pure quelli che ricevono l'indirizzo dopo.
  await page.evaluate(() => {
    const subito = document.createElement('iframe');
    subito.id = 'yt-subito';
    subito.src = 'https://www.youtube.com/embed/dQw4w9WgXcQ';
    document.body.appendChild(subito);
    const pigro = document.createElement('iframe');
    pigro.id = 'yt-pigro';
    document.body.appendChild(pigro);
    setTimeout(() => pigro.setAttribute('src', 'https://www.youtube.com/embed/dQw4w9WgXcQ'), 800);
  });
  for (const id of ['yt-subito', 'yt-pigro']) {
    await page.waitForFunction((x) => (document.getElementById(x).src || '').includes('youtube-nocookie.com'), id, { timeout: 8_000 });
  }
});

test('a caccia chiusa si rifiuta il banner con la scritta arrivata dopo e quello già in pagina mostrato più tardi', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  // Pagina ferma: il banner nascosto dal caricamento non può contare su un nodo nuovo qualsiasi per farsi vedere.
  const page = await testServer.openReady(openTab, `<title>COMPARSA_TARDIVA</title>${LINK(300)}
    ${SENZA_CMP('dopo', 'display:none')}`);
  await expect.poll(async () => (await stato(app, page)).hunting, { timeout: 35_000, intervals: [1_000] }).toBe(false);

  await page.evaluate(() => { document.getElementById('dopo').style.display = 'block'; });
  await page.waitForFunction(() => !document.getElementById('dopo'), null, { timeout: 8_000 });
  expect(await page.evaluate(() => [window.__rifiuti, window.__accettati])).toEqual([1, undefined]);

  // Pulsanti vuoti, scritte un attimo dopo: come i banner che caricano le traduzioni. Poi una scritta cambiata sul posto.
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', `<div id="vuoto" class="cookie-consent" style="position:fixed;top:0;left:0;right:0;height:90px;background:#fff;z-index:10">
      <p>Usiamo i cookie.</p><button id="acc" onclick="window.__accettati=1;this.parentNode.remove()"></button>
      <button id="rif" onclick="window.__rifiuti=(window.__rifiuti||0)+1;this.parentNode.remove()"></button></div>`);
    setTimeout(() => { document.getElementById('acc').textContent = 'Accetta'; document.getElementById('rif').textContent = 'Rifiuta'; }, 300);
  });
  await page.waitForFunction(() => !document.getElementById('vuoto'), null, { timeout: 8_000 });
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', `<div id="chiave" class="cookie-consent" style="position:fixed;top:0;left:0;right:0;height:90px;background:#fff;z-index:10">
      <p>Usiamo i cookie.</p><button onclick="window.__rifiuti=(window.__rifiuti||0)+1;this.parentNode.remove()">caricamento</button></div>`);
    setTimeout(() => { document.querySelector('#chiave button').firstChild.data = 'Rifiuta tutto'; }, 300);
  });
  await page.waitForFunction(() => !document.getElementById('chiave'), null, { timeout: 8_000 });
  expect(await page.evaluate(() => [window.__rifiuti, window.__accettati])).toEqual([3, undefined]);
});
