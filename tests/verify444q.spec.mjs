// VERIFICA INDIPENDENTE #444 (quarto giro) — spec TEMPORANEO del verificatore.
// Pagine costruite da zero (non quelle del ramo). Da eliminare a fine verifica.
//
// FUNZIONALE: sulle schede video (in tutte le forme, velo del titolo a
// sfumatura compreso) il tasto destro deve offrire ANCHE le voci del
// collegamento, oltre a quelle di filmato/immagine.
// SICUREZZA: il menu non deve adottare collegamenti che l'utente non sta
// guardando (barre fisse/sticky, pannelli opachi, sfumature interamente
// coprenti, manti invisibili, link trasparenti sull'ingombro del testo).

import { test, expect } from './fixtures/electron.mjs';

const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';

const LINK_LABELS = ['Apri in nuova tab', 'Copia URL', 'Salva link per dopo', 'Condividi link'];
const VIDEO_LABELS = ['Copia URL video', 'Salva video come…'];
const IMAGE_LABELS = ['Copia immagine', 'Salva immagine come…'];

async function openMenu(page, selector, position) {
  // Scroll separato dal click: se lo scroll e il tasto destro avvengono nello
  // stesso gesto, gli eventi di scroll residui chiudono il menu appena aperto
  // (comportamento voluto dell'app, non del lavoro in verifica).
  await page.locator(selector).scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await page.locator(selector).click({ button: 'right', position });
  const menu = page.locator('.sn-menu').first();
  await expect(menu).toBeVisible({ timeout: 8000 });
  const labels = (await menu.locator('.sn-menu-label').allTextContents()).map((s) => s.trim());
  return { menu, labels };
}

async function openMenuAtPoint(page, x, y) {
  await page.mouse.click(x, y, { button: 'right' });
  const menu = page.locator('.sn-menu').first();
  await expect(menu).toBeVisible({ timeout: 8000 });
  const labels = (await menu.locator('.sn-menu-label').allTextContents()).map((s) => s.trim());
  return { menu, labels };
}

async function closeMenu(page) {
  await page.keyboard.press('Escape');
  await expect(page.locator('.sn-menu')).toHaveCount(0);
}

function expectLink(labels, ctx) {
  for (const l of LINK_LABELS) expect(labels, `${ctx}: manca "${l}" — menu: ${labels.join(' | ')}`).toContain(l);
}
function expectNoLink(labels, ctx) {
  for (const l of LINK_LABELS) expect(labels, `${ctx}: adottato link sepolto ("${l}") — menu: ${labels.join(' | ')}`).not.toContain(l);
}
function expectVideo(labels, ctx) {
  for (const l of VIDEO_LABELS) expect(labels, `${ctx}: manca "${l}" — menu: ${labels.join(' | ')}`).toContain(l);
  expect(labels.some((l) => l === 'Riproduci' || l === 'Pausa'), `${ctx}: manca Riproduci/Pausa — ${labels.join(' | ')}`).toBe(true);
}
function expectNoVideo(labels, ctx) {
  for (const l of VIDEO_LABELS) expect(labels, `${ctx}: adottato video sepolto ("${l}") — menu: ${labels.join(' | ')}`).not.toContain(l);
}
function expectImage(labels, ctx) {
  for (const l of IMAGE_LABELS) expect(labels, `${ctx}: manca "${l}" — menu: ${labels.join(' | ')}`).toContain(l);
}
function expectNoImage(labels, ctx) {
  for (const l of IMAGE_LABELS) expect(labels, `${ctx}: adottata immagine sepolta ("${l}") — menu: ${labels.join(' | ')}`).not.toContain(l);
}

function funcPage() {
  return `<!doctype html><html><head><style>
    body{margin:0;font:14px sans-serif;padding:16px}
    .card{position:relative;width:320px;height:180px;margin:14px 0}
    .layer{position:absolute;inset:0;width:100%;height:100%;margin:0;border:0;padding:0}
    .grad{background:linear-gradient(to top, rgba(0,0,0,.85) 0%, rgba(0,0,0,0) 60%)}
  </style></head><body>
    <h1>Schede video</h1>

    <!-- F1: video annidato nel link (forma base) -->
    <a id="f1a" href="https://cards.example/f1"><video id="f1v" width="320" height="180" style="background:#333;display:block"></video></a>

    <!-- F2: strati impilati, filmato in funzione, velo sfumato su TUTTA la scheda -->
    <div id="f2" class="card">
      <img class="layer" src="${GIF}" alt="">
      <video id="f2v" class="layer"></video>
      <a id="f2a" class="layer" href="https://cards.example/f2"></a>
      <div id="f2veil" class="layer grad"></div>
    </div>

    <!-- F3: velo sfumato DENTRO il collegamento, filmato in funzione -->
    <div id="f3" class="card">
      <img class="layer" src="${GIF}" alt="">
      <video id="f3v" class="layer"></video>
      <a id="f3a" class="layer" href="https://cards.example/f3"><div id="f3veil" class="layer grad"></div></a>
    </div>

    <!-- F4: copertina ferma, velo sfumato su tutta la scheda -->
    <div id="f4" class="card">
      <img id="f4img" class="layer" src="${GIF}" alt="">
      <a id="f4a" class="layer" href="https://cards.example/f4"></a>
      <div id="f4veil" class="layer grad"></div>
    </div>

    <!-- F4b: copertina DENTRO il link, velo sfumato steso sopra a tutto -->
    <div id="f4b" class="card">
      <a id="f4ba" class="layer" href="https://cards.example/f4b"><img id="f4bimg" class="layer" src="${GIF}" alt=""></a>
      <div id="f4bveil" class="layer grad"></div>
    </div>

    <!-- F5: copertina ferma, velo sfumato dentro il collegamento -->
    <div id="f5" class="card">
      <img id="f5img" class="layer" src="${GIF}" alt="">
      <a id="f5a" class="layer" href="https://cards.example/f5"><div id="f5veil" class="layer grad"></div></a>
    </div>

    <!-- F6: riga di risultati con miniatura piccola e link steso sulla riga -->
    <div id="f6" style="position:relative;width:800px;height:100px;border:1px solid #ccc">
      <img id="f6img" src="${GIF}" style="position:absolute;left:10px;top:10px;width:80px;height:80px" alt="">
      <div style="position:absolute;left:110px;top:10px">Titolo del risultato<br>con la sua descrizione su due righe</div>
      <a id="f6a" href="https://cards.example/f6" style="position:absolute;inset:0"></a>
    </div>

    <!-- F7: scheda con copertina in CSS (background-image), velo trasparente sopra -->
    <div id="f7" class="card">
      <div class="layer" style="background-image:url(${GIF});background-size:cover;background-color:#456"></div>
      <a id="f7a" class="layer" href="https://cards.example/f7"></a>
      <div id="f7veil" class="layer" style="background:transparent"></div>
    </div>

    <!-- F10: scheda a COMPONENTE (video dentro uno shadow root) nel link, velo sfumato sopra -->
    <a id="f10a" href="https://cards.example/f10" style="position:relative;display:block;width:320px;height:180px;margin:14px 0">
      <x-vid id="f10c" style="position:absolute;inset:0;display:block"></x-vid>
      <div id="f10veil" class="layer grad"></div>
    </a>
    <script>
      class XV extends HTMLElement {
        connectedCallback() {
          const r = this.attachShadow({ mode: 'open' });
          const v = document.createElement('video');
          v.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;background:#333';
          r.appendChild(v);
        }
      }
      customElements.define('x-vid', XV);
    </script>
  </body></html>`;
}

function veilFixedPage() {
  return `<!doctype html><html><body style="margin:0;font:15px sans-serif">
    <a id="f9a" href="https://cards.example/f9" style="position:absolute;left:40px;top:20px;width:300px;height:24px;background:#eef">Collegamento ben visibile</a>
    <div id="f9veil" style="position:fixed;left:0;top:0;width:420px;height:70px;background:transparent"></div>
  </body></html>`;
}

function trapPage() {
  return `<!doctype html><html><body style="margin:0;font:14px sans-serif">
    <!-- S1: barra fissa opaca sopra un titolo scivolato sotto -->
    <a id="s1a" href="https://trap.example/s1" style="position:absolute;top:20px;left:40px;width:220px;height:22px;display:block">Titolo sepolto</a>
    <div id="s1bar" style="position:fixed;top:0;left:0;right:0;height:60px;background:#123;color:#fff;z-index:60;line-height:60px;padding-left:8px">Barra fissa del sito</div>

    <!-- S3: barra fissa opaca sopra un link ANCHE LUI fissato -->
    <a id="s3a" href="https://trap.example/s3" style="position:fixed;top:70px;left:40px;width:200px;height:20px;z-index:55">link fissato sepolto</a>
    <div id="s3bar" style="position:fixed;top:64px;left:0;right:0;height:36px;background:#321;z-index:56"></div>

    <div style="height:130px"></div>

    <!-- S2: barra sticky che copre la riga precedente -->
    <div id="s2wrap" style="position:relative">
      <a id="s2a" href="https://trap.example/s2" style="display:block;width:240px;height:24px;margin-left:40px">Riga con collegamento</a>
      <div id="s2bar" style="position:sticky;top:0;height:56px;margin-top:-52px;background:#234;color:#fff;line-height:56px;padding-left:8px">Barra appiccicosa</div>
    </div>

    <!-- S4: pannello opaco INTERO dentro la pagina sopra un link nel flusso -->
    <div id="s4" style="position:relative;width:900px;height:220px;margin-top:30px">
      <p style="padding-top:40px;margin-left:40px">Testo con <a id="s4a" href="https://trap.example/s4">un collegamento nel flusso</a> in mezzo.</p>
      <div id="s4panel" style="position:absolute;inset:0;background:#f5f5f5"></div>
    </div>

    <!-- S5: pannello opaco su META' del collegamento -->
    <div id="s5" style="position:relative;width:900px;height:120px">
      <a id="s5a" href="https://trap.example/s5" style="position:absolute;left:40px;top:40px;width:400px;height:40px;background:#dde;display:block">Collegamento largo mezzo coperto</a>
      <div id="s5panel" style="position:absolute;left:200px;top:0;width:500px;height:120px;background:#ddd"></div>
    </div>

    <!-- S6: pannello a SFUMATURA interamente coprente -->
    <div id="s6" style="position:relative;width:900px;height:160px">
      <a id="s6a" href="https://trap.example/s6" style="position:absolute;left:40px;top:60px;width:260px;height:22px">collegamento sepolto dalla sfumatura</a>
      <div id="s6panel" style="position:absolute;inset:0;background:linear-gradient(to bottom, rgb(24,24,28), rgb(58,58,66))"></div>
    </div>

    <!-- S6b: sfumatura semi-trasparente ma coprente OVUNQUE (mai sotto alfa .5) -->
    <div id="s6b" style="position:relative;width:900px;height:160px">
      <a id="s6ba" href="https://trap.example/s6b" style="position:absolute;left:40px;top:60px;width:260px;height:22px">sepolto da sfumatura semi-opaca</a>
      <div id="s6bpanel" style="position:absolute;inset:0;background:linear-gradient(to bottom, rgba(0,0,0,.8), rgba(20,20,20,.55))"></div>
    </div>

    <!-- S8: link trasparente ritagliato sull'ingombro del testo -->
    <div id="s8" style="position:relative;width:900px;height:120px">
      <p id="s8p" style="position:relative;z-index:2;margin:20px 40px;width:400px">Paragrafo di testo normale che l'utente sta leggendo davvero, senza nessuna scheda.</p>
      <a id="s8a" href="https://trap.example/s8" style="position:absolute;left:40px;top:20px;width:400px;height:60px;z-index:1;display:block"></a>
    </div>

    <!-- S9: pannello opaco della STESSA identica misura del link (bordi condivisi) -->
    <div id="s9" style="position:relative;width:900px;height:120px">
      <a id="s9a" href="https://trap.example/s9" style="position:absolute;left:40px;top:30px;width:300px;height:60px;background:#eef;display:block">Scheda link</a>
      <div id="s9panel" style="position:absolute;left:40px;top:30px;width:300px;height:60px;background:#ccc"></div>
    </div>

    <!-- S10: filmato DIETRO un articolo opaco: niente voci video -->
    <div id="s10" style="position:relative;width:900px;height:220px">
      <video id="s10v" style="position:absolute;left:60px;top:20px;width:320px;height:180px;z-index:0;background:#222"></video>
      <div id="s10panel" style="position:absolute;inset:0;background:#fff;z-index:1;padding:20px">Un articolo opaco steso sopra: il filmato dietro non si vede piu.</div>
    </div>

    <!-- S12: scheda vera (img dentro link) ma sepolta da un pannello opaco -->
    <div id="s12" style="position:relative;width:900px;height:220px">
      <a id="s12a" href="https://trap.example/s12" style="position:absolute;left:60px;top:20px;width:320px;height:180px"><img id="s12img" src="${GIF}" style="width:320px;height:180px" alt=""></a>
      <div id="s12panel" style="position:absolute;inset:0;background:#fafafa"></div>
    </div>
    <div style="height:200px"></div>
  </body></html>`;
}

function mantlePage() {
  return `<!doctype html><html><body style="margin:0;font:15px sans-serif">
    <div style="position:relative">
      <p id="c1p" style="position:relative;z-index:2;margin:40px;width:500px">Il testo che l'utente sta leggendo, sotto un manto invisibile steso su tutta la pagina.</p>
      <a id="c1a" href="https://trap.example/mantle" style="position:absolute;left:40px;top:40px;width:500px;height:40px;z-index:1;display:block"></a>
    </div>
    <div id="mantle" style="position:absolute;inset:0;z-index:99;background:transparent"></div>
  </body></html>`;
}

async function gotoReady(page, testServer, html) {
  await page.goto(testServer.html(html));
  await page.waitForFunction(
    () => document.documentElement.dataset.filoContentReady === '1',
    null, { timeout: 10000 },
  );
}

async function startVideos(page, ids) {
  await page.evaluate((list) => {
    for (const id of list) {
      const v = document.getElementById(id);
      if (!v) continue;
      const c = document.createElement('canvas'); c.width = 320; c.height = 180;
      const ctx = c.getContext('2d'); let t = 0;
      setInterval(() => { ctx.fillStyle = (t++ % 2) ? '#a33' : '#3a3'; ctx.fillRect(0, 0, 320, 180); }, 200);
      v.muted = true;
      try { v.srcObject = c.captureStream(5); } catch (_) {}
      v.play().catch(() => {});
    }
  }, ids);
}

test.describe('#444 quater — verifica indipendente', () => {
  test('FUNZIONALE: le voci del collegamento restano in tutte le forme della scheda video', async ({ app, openTab, testServer }) => {
    const page = await testServer.openReady(openTab, funcPage());
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 10000 });
    await startVideos(page, ['f2v', 'f3v']);

    // F1 — video annidato nel link.
    {
      const { labels } = await openMenu(page, '#f1v', { x: 160, y: 90 });
      expectVideo(labels, 'F1 video annidato');
      expectLink(labels, 'F1 video annidato');
      await closeMenu(page);
    }

    // F2 — velo sfumato su tutta la scheda, filmato in funzione: click al centro…
    {
      const { labels } = await openMenu(page, '#f2veil', { x: 160, y: 90 });
      expectVideo(labels, 'F2 velo sfumatura su scheda (centro)');
      expectLink(labels, 'F2 velo sfumatura su scheda (centro)');
      await closeMenu(page);
    }
    // …e sulla fascia scura del titolo in basso (lì la sfumatura è quasi opaca).
    {
      const { labels } = await openMenu(page, '#f2veil', { x: 160, y: 168 });
      expectVideo(labels, 'F2 fascia titolo in basso');
      expectLink(labels, 'F2 fascia titolo in basso');
      await closeMenu(page);
    }
    // "Copia URL" del menu della scheda copia l'href del COLLEGAMENTO.
    {
      const { menu } = await openMenu(page, '#f2veil', { x: 160, y: 90 });
      await menu.getByText('Copia URL', { exact: true }).click();
      await expect
        .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 8000 })
        .toBe('https://cards.example/f2');
    }

    // F3 — velo sfumato DENTRO il collegamento, filmato in funzione.
    {
      const { labels } = await openMenu(page, '#f3veil', { x: 160, y: 120 });
      expectVideo(labels, 'F3 velo dentro il link (video)');
      expectLink(labels, 'F3 velo dentro il link (video)');
      await closeMenu(page);
    }

    // F4 — copertina ferma, velo sfumato su tutta la scheda.
    {
      const { labels } = await openMenu(page, '#f4veil', { x: 160, y: 90 });
      expectImage(labels, 'F4 copertina ferma + velo su scheda');
      expectLink(labels, 'F4 copertina ferma + velo su scheda');
      await closeMenu(page);
    }

    // F4b — copertina dentro il link, velo sopra tutto.
    {
      const { labels } = await openMenu(page, '#f4bveil', { x: 160, y: 90 });
      expectImage(labels, 'F4b copertina nel link + velo');
      expectLink(labels, 'F4b copertina nel link + velo');
      await closeMenu(page);
    }

    // F5 — copertina ferma, velo dentro il collegamento.
    {
      const { labels } = await openMenu(page, '#f5veil', { x: 160, y: 120 });
      expectImage(labels, 'F5 velo dentro il link (immagine)');
      expectLink(labels, 'F5 velo dentro il link (immagine)');
      await closeMenu(page);
    }

    // F6 — riga risultati con miniatura piccola: click sulla miniatura.
    {
      const { labels } = await openMenu(page, '#f6', { x: 50, y: 50 });
      expectImage(labels, 'F6 miniatura piccola');
      expectLink(labels, 'F6 miniatura piccola');
      await closeMenu(page);
    }

    // F7 — copertina in CSS + velo trasparente: le voci del link restano.
    {
      const { labels } = await openMenu(page, '#f7veil', { x: 160, y: 90 });
      expectLink(labels, 'F7 copertina CSS + velo trasparente');
      await closeMenu(page);
    }

    // F9 — velo FISSO trasparente sopra un collegamento ben visibile: il link resta.
    await gotoReady(page, testServer, veilFixedPage());
    {
      const { labels } = await openMenuAtPoint(page, 120, 32);
      expectLink(labels, 'F9 velo fisso trasparente su link visibile');
      await closeMenu(page);
    }
  });

  test('SICUREZZA: nessuna adozione di collegamenti sepolti (barre, pannelli, sfumature, manti)', async ({ openTab, testServer }) => {
    const page = await testServer.openReady(openTab, trapPage());
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 10000 });

    // S1 — barra fissa sopra un titolo scivolato sotto (click sul punto del link).
    {
      const { labels } = await openMenuAtPoint(page, 120, 30);
      expectNoLink(labels, 'S1 barra fissa');
      await closeMenu(page);
    }

    // S3 — barra fissa sopra un link ANCHE LUI fissato.
    {
      const { labels } = await openMenuAtPoint(page, 120, 80);
      expectNoLink(labels, 'S3 barra fissa su link fissato');
      await closeMenu(page);
    }

    // S2 — barra sticky che copre la riga.
    {
      const box = await page.locator('#s2a').boundingBox();
      const { labels } = await openMenuAtPoint(page, box.x + 100, box.y + 12);
      expectNoLink(labels, 'S2 barra sticky');
      await closeMenu(page);
    }

    // Helper: click destro sul punto centrale (o offset) del link sepolto.
    const clickOver = async (underSel, dx = null, dy = null) => {
      await page.locator(underSel).scrollIntoViewIfNeeded();
      const box = await page.locator(underSel).boundingBox();
      const x = dx == null ? box.x + box.width / 2 : box.x + dx;
      const y = dy == null ? box.y + box.height / 2 : box.y + dy;
      return openMenuAtPoint(page, x, y);
    };

    // S4 — pannello opaco intero sopra un link nel flusso.
    {
      const { labels } = await clickOver('#s4a');
      expectNoLink(labels, 'S4 pannello opaco intero');
      await closeMenu(page);
    }

    // S5 — pannello opaco su più di metà del link: click sulla parte coperta.
    {
      const { labels } = await clickOver('#s5a', 300, 20);
      expectNoLink(labels, 'S5 pannello a metà');
      await closeMenu(page);
    }

    // S6 — sfumatura interamente coprente.
    {
      const { labels } = await clickOver('#s6a');
      expectNoLink(labels, 'S6 sfumatura coprente');
      await closeMenu(page);
    }

    // S6b — sfumatura semi-trasparente ma coprente ovunque.
    {
      const { labels } = await clickOver('#s6ba');
      expectNoLink(labels, 'S6b sfumatura semi-opaca coprente');
      await closeMenu(page);
    }

    // S8 — link trasparente sull'ingombro del testo.
    {
      const { labels } = await clickOver('#s8p');
      expectNoLink(labels, 'S8 link trasparente sotto il testo');
      await closeMenu(page);
    }

    // S9 — pannello opaco della stessa misura del link.
    {
      const { labels } = await clickOver('#s9a');
      expectNoLink(labels, 'S9 pannello a misura di link');
      await closeMenu(page);
    }

    // S10 — filmato dietro un articolo opaco: niente voci video.
    {
      const { labels } = await clickOver('#s10v');
      expectNoVideo(labels, 'S10 filmato sepolto');
      expectNoLink(labels, 'S10 filmato sepolto');
      await closeMenu(page);
    }

    // S12 — scheda vera (img nel link) sepolta da un pannello opaco.
    {
      const { labels } = await clickOver('#s12img');
      expectNoImage(labels, 'S12 scheda sepolta');
      expectNoLink(labels, 'S12 scheda sepolta');
      await closeMenu(page);
    }

    // Manto invisibile su tutta la pagina + link trasparente sotto il testo.
    await gotoReady(page, testServer, mantlePage());
    {
      const box = await page.locator('#c1p').boundingBox();
      const { labels } = await openMenuAtPoint(page, box.x + 100, box.y + 10);
      expectNoLink(labels, 'MANTO invisibile');
      await closeMenu(page);
    }
  });
});
