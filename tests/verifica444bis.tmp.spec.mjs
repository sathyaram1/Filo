// SPEC TEMPORANEO DELLA VERIFICA INDIPENDENTE #444-bis — da eliminare a fine giro.
// Pagine costruite da zero, nessun riuso dei test del lavoro.

import { test, expect } from './fixtures/electron.mjs';

const LINK_LABELS = ['Apri in nuova tab', 'Copia URL', 'Salva link per dopo', 'Condividi link'];

async function openMenuAt(page, x, y) {
  await page.mouse.click(x, y, { button: 'right' });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  return menu;
}

async function closeMenu(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  if (await page.locator('.sn-menu').count()) {
    await page.mouse.click(2, 2); // click fuori
    await page.waitForTimeout(150);
  }
}

async function expectLinkEntries(menu) {
  for (const label of ['Apri in nuova tab', 'Salva link per dopo', 'Condividi link']) {
    await expect(menu.getByText(label, { exact: false }).first()).toBeVisible();
  }
  await expect(menu.locator('button', { hasText: 'Copia URL' }).filter({ hasNotText: 'video' }).first()).toBeVisible();
}

async function expectNoLinkEntries(menu) {
  await expect(menu).toBeVisible();
  for (const label of ['Apri in nuova tab', 'Salva link per dopo', 'Condividi link']) {
    await expect(menu.getByText(label, { exact: false })).toHaveCount(0);
  }
}

async function rectOf(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, sel);
}

// ───────────────────────── FUNZIONALI: devono dare le voci del link ─────────────────────────

test('F1 filmato DENTRO il collegamento, anteprima in moto: voci del link e del video insieme', async ({ app, openTab, testServer }) => {
  const href = 'https://esempio.test/scheda-uno';
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:15px sans-serif;padding:30px">
    <a id="card" href="${href}" style="display:inline-block;position:relative;width:320px;height:180px">
      <video id="v" muted style="position:absolute;inset:0;width:100%;height:100%;background:#123"></video>
      <div id="veil" style="position:absolute;inset:0;background:linear-gradient(transparent 55%,rgba(0,0,0,.65));color:#fff;display:flex;align-items:flex-end;padding:10px">Titolo della scheda</div>
    </a>
  </body></html>`);
  // anteprima davvero IN FUNZIONE: stream da canvas, il video sta suonando
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 180;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#3a7'; ctx.fillRect(0, 0, 320, 180);
    const v = document.getElementById('v');
    v.srcObject = c.captureStream(10);
    try { await v.play(); } catch (_) {}
  });
  const r = await rectOf(page, '#veil');
  const menu = await openMenuAt(page, r.x + r.w / 2, r.y + r.h / 2);
  await expectLinkEntries(menu);
  await expect(menu.getByText('Salva video come', { exact: false }).first()).toBeVisible();

  // «Copia URL» copia l'href della SCHEDA, non quello del filmato
  await menu.locator('button', { hasText: 'Copia URL' }).filter({ hasNotText: 'video' }).first().click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 8000 }).toBe(href);
});

test('F2 anteprima STESA SOPRA la scheda (strati, non annidata): il link sotto viene offerto', async ({ app, openTab, testServer }) => {
  const href = 'https://esempio.test/scheda-strati';
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:15px sans-serif;padding:30px">
    <div id="cardbox" style="position:relative;width:320px;height:180px">
      <a id="card" href="${href}" style="position:absolute;inset:0;z-index:1;display:block;background:#eee">copertina</a>
      <video id="v" muted style="position:absolute;inset:0;z-index:2;width:100%;height:100%;background:#321"></video>
    </div>
  </body></html>`);
  const r = await rectOf(page, '#v');
  const menu = await openMenuAt(page, r.x + r.w / 2, r.y + r.h / 2);
  await expectLinkEntries(menu);
  await menu.locator('button', { hasText: 'Copia URL' }).filter({ hasNotText: 'video' }).first().click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 8000 }).toBe(href);
});

test('F3 anteprima FERMA: solo velo trasparente col titolo sopra la scheda — le voci del link restano', async ({ openTab, testServer }) => {
  const href = 'https://esempio.test/scheda-ferma';
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:15px sans-serif;padding:30px">
    <div id="cardbox" style="position:relative;width:320px;height:180px">
      <a id="card" href="${href}" style="position:absolute;inset:0;z-index:1;display:block;background:#8ac">copertina ferma</a>
      <div id="veil" style="position:absolute;inset:0;z-index:2;background:linear-gradient(transparent 50%,rgba(0,0,0,.6));color:#fff;display:flex;align-items:flex-end;padding:10px">Titolo sul velo</div>
    </div>
  </body></html>`);
  const r = await rectOf(page, '#veil');
  const menu = await openMenuAt(page, r.x + r.w / 2, r.y + r.h / 2);
  await expectLinkEntries(menu);
});

test('F4 componenti web: link+filmato dentro lo shadow root, e filmato in shadow dentro un link esterno', async ({ openTab, testServer }) => {
  const href1 = 'https://esempio.test/shadow-interno';
  const href2 = 'https://esempio.test/shadow-esterno';
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:15px sans-serif;padding:30px">
    <div id="host1" style="display:inline-block;width:320px;height:180px"></div>
    <br><br>
    <a id="outer" href="${href2}" style="display:inline-block;width:320px;height:180px"><div id="host2" style="width:100%;height:100%"></div></a>
    <script>
      // Componente A: link e filmato IMPILATI dentro lo stesso shadow root
      const s1 = document.getElementById('host1').attachShadow({ mode: 'open' });
      s1.innerHTML = '<div style="position:relative;width:320px;height:180px">' +
        '<a href="${href1}" style="position:absolute;inset:0;z-index:1;display:block;background:#c96">scheda</a>' +
        '<video muted style="position:absolute;inset:0;z-index:2;width:100%;height:100%;background:#222"></video></div>';
      // Componente B: solo il filmato in shadow, il collegamento sta FUORI in chiaro
      const s2 = document.getElementById('host2').attachShadow({ mode: 'open' });
      s2.innerHTML = '<video muted style="width:320px;height:180px;background:#444"></video>';
    </script>
  </body></html>`);
  const r1 = await rectOf(page, '#host1');
  let menu = await openMenuAt(page, r1.x + r1.w / 2, r1.y + r1.h / 2);
  await expectLinkEntries(menu);
  await closeMenu(page);
  const r2 = await rectOf(page, '#host2');
  menu = await openMenuAt(page, r2.x + r2.w / 2, r2.y + r2.h / 2);
  await expectLinkEntries(menu);
});

test('F5 copertina fatta con immagine di SFONDO css (scheda vera) + scheda dentro barra fissa: funzionano', async ({ openTab, testServer }) => {
  const href = 'https://esempio.test/bg-cover';
  const hrefBar = 'https://esempio.test/scheda-in-barra';
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:15px sans-serif">
    <div id="topbar" style="position:fixed;top:0;left:0;right:0;height:90px;background:#fff;border-bottom:1px solid #ccc;z-index:10;display:flex;align-items:center;padding-left:20px">
      <a id="barcard" href="${hrefBar}" style="display:inline-block;position:relative;width:140px;height:70px">
        <div style="position:absolute;inset:0;background-image:linear-gradient(#357,#135)"></div>
        <div style="position:absolute;inset:0;color:#fff;font-size:12px;display:flex;align-items:flex-end;padding:4px">Scheda in barra</div>
      </a>
    </div>
    <div style="height:120px"></div>
    <a id="card" href="${href}" style="display:inline-block;position:relative;width:320px;height:180px;margin-left:30px">
      <div id="thumb" style="position:absolute;inset:0;background-image:linear-gradient(45deg,#a33,#33a)"></div>
      <div style="position:absolute;inset:0;background:linear-gradient(transparent 50%,rgba(0,0,0,.6));color:#fff;display:flex;align-items:flex-end;padding:10px">Copertina di sfondo</div>
    </a>
  </body></html>`);
  const r = await rectOf(page, '#card');
  let menu = await openMenuAt(page, r.x + r.w / 2, r.y + r.h / 2);
  await expectLinkEntries(menu);
  await closeMenu(page);
  const rb = await rectOf(page, '#barcard');
  menu = await openMenuAt(page, rb.x + rb.w / 2, rb.y + rb.h / 2);
  await expectLinkEntries(menu);
});

// ─────────────── INVARIANTE DI SICUREZZA: link sepolti, bordi condivisi — MAI adottati ───────────────

test('S1 barra fissa opaca esattamente sopra una riga-titolo a tutta larghezza: nessuna voce del link', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:15px sans-serif">
    <div id="bar" style="position:fixed;top:0;left:0;right:0;height:60px;background:#f5f5f5;border-bottom:1px solid #ddd;z-index:10;display:flex;align-items:center;padding-left:16px">Barra dell'app</div>
    <a id="titolo" href="https://malizia.test/sepolto" style="display:block;height:60px;line-height:60px;margin:0;background:#fff">Riga-titolo a tutta larghezza, sepolta sotto la barra</a>
    <p style="padding:16px">Contenuto della pagina.</p>
  </body></html>`);
  // centro della barra (il link sepolto condivide TUTTI i bordi con lei)
  let menu = await openMenuAt(page, 300, 30);
  await expectNoLinkEntries(menu);
  await closeMenu(page);
  // a filo del bordo condiviso (1-2px dentro la barra)
  menu = await openMenuAt(page, 300, 58);
  await expectNoLinkEntries(menu);
});

test('S2 titolo centrato scivolato per metà sotto la barra con lo scroll: la metà nascosta non regala il link, quella visibile sì', async ({ openTab, testServer }) => {
  const href = 'https://esempio.test/titolo-visibile';
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:15px sans-serif">
    <div id="bar" style="position:fixed;top:0;left:0;right:0;height:60px;background:#fff;border-bottom:1px solid #ccc;z-index:10;display:flex;align-items:center;padding-left:16px">Barra fissa</div>
    <div style="height:300px"></div>
    <div style="text-align:center"><a id="titolo" href="${href}" style="display:inline-block;width:300px;height:44px;line-height:44px;background:#eef">Titolo centrato</a></div>
    <div style="height:1500px"></div>
  </body></html>`);
  // porta il titolo per metà sotto la barra: top del titolo a y=38 in viewport (barra 0-60)
  await page.evaluate(() => window.scrollTo(0, 262));
  await page.waitForTimeout(200);
  const r = await rectOf(page, '#titolo');
  // clic sulla barra, sopra la parte NASCOSTA del titolo
  let menu = await openMenuAt(page, r.x + r.w / 2, Math.min(58, r.y + 10));
  await expectNoLinkEntries(menu);
  await closeMenu(page);
  // clic sulla parte VISIBILE del titolo (sotto il bordo della barra)
  menu = await openMenuAt(page, r.x + r.w / 2, 61 + (r.y + r.h - 61) / 2);
  await expectLinkEntries(menu);
});

test('S3 striscia dei cookie in basso sopra una riga-collegamento con lo stesso ingombro: nessuna voce del link', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:15px sans-serif">
    <p style="padding:16px">Contenuto.</p>
    <a id="riga" href="https://malizia.test/riga-sepolta" style="position:fixed;left:0;right:0;bottom:0;height:80px;display:block;background:#fff">Riga collegamento in fondo</a>
    <div id="cookie" style="position:fixed;left:0;right:0;bottom:0;height:80px;background:#222;color:#fff;z-index:10;display:flex;align-items:center;justify-content:space-between;padding:0 20px">
      <span>Questo sito usa i cookie.</span><button>OK</button>
    </div>
  </body></html>`);
  const r = await rectOf(page, '#cookie');
  let menu = await openMenuAt(page, r.x + r.w / 2, r.y + r.h / 2);
  await expectNoLinkEntries(menu);
  await closeMenu(page);
  // a filo del bordo superiore condiviso
  menu = await openMenuAt(page, r.x + r.w / 2, r.y + 2);
  await expectNoLinkEntries(menu);
});

test('S4 collegamento invisibile steso su tutta la pagina, testo a filo del bordo: nessuna voce del link', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:15px sans-serif">
    <a id="manto" href="https://malizia.test/manto" style="position:absolute;inset:0;z-index:0;display:block"></a>
    <p id="testo" style="position:relative;z-index:1;margin:0">Testo che parte esattamente dal bordo della pagina, senza margini, sopra un manto invisibile.</p>
  </body></html>`);
  // proprio a ridosso dell'angolo condiviso (0,0)
  let menu = await openMenuAt(page, 6, 8);
  await expectNoLinkEntries(menu);
  await closeMenu(page);
  const r = await rectOf(page, '#testo');
  menu = await openMenuAt(page, r.x + Math.min(120, r.w / 2), r.y + r.h / 2);
  await expectNoLinkEntries(menu);
});

test('S5 collegamento trasparente ritagliato sull\'ingombro ESATTO di un paragrafo, sotto di lui: nessuna voce del link', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:15px sans-serif;padding:40px">
    <p id="para" style="position:relative;z-index:1;width:420px;margin:0">Un paragrafo qualunque, con un collegamento fantasma ritagliato esattamente sul suo ingombro, nascosto sotto di lui.</p>
    <a id="ghost" href="https://malizia.test/fantasma" style="position:absolute;z-index:0;display:block"></a>
    <script>
      const r = document.getElementById('para').getBoundingClientRect();
      const a = document.getElementById('ghost');
      a.style.left = (r.left + window.scrollX) + 'px';
      a.style.top = (r.top + window.scrollY) + 'px';
      a.style.width = r.width + 'px';
      a.style.height = r.height + 'px';
    </script>
  </body></html>`);
  const r = await rectOf(page, '#para');
  let menu = await openMenuAt(page, r.x + r.w / 2, r.y + r.h / 2);
  await expectNoLinkEntries(menu);
  await closeMenu(page);
  // sul bordo condiviso in alto a sinistra
  menu = await openMenuAt(page, r.x + 3, r.y + 3);
  await expectNoLinkEntries(menu);
});

test('S6 riquadro opaco che copre solo METÀ della scheda-link: la parte coperta non regala il link, quella scoperta sì', async ({ openTab, testServer }) => {
  const href = 'https://esempio.test/mezza-scheda';
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:15px sans-serif;padding:40px">
    <div style="position:relative;width:360px;height:120px">
      <a id="card" href="${href}" style="position:absolute;inset:0;z-index:1;display:flex;align-items:center;background:#dfe8ff;padding-left:12px">Scheda mezza coperta</a>
      <div id="toast" style="position:absolute;top:0;bottom:0;right:0;width:180px;z-index:2;background:#333;color:#fff;display:flex;align-items:center;justify-content:center">Avviso opaco</div>
    </div>
  </body></html>`);
  const rt = await rectOf(page, '#toast');
  let menu = await openMenuAt(page, rt.x + rt.w / 2, rt.y + rt.h / 2);
  await expectNoLinkEntries(menu);
  await closeMenu(page);
  // e sul bordo condiviso, appena dentro il riquadro opaco
  menu = await openMenuAt(page, rt.x + 3, rt.y + rt.h / 2);
  await expectNoLinkEntries(menu);
  await closeMenu(page);
  const rc = await rectOf(page, '#card');
  menu = await openMenuAt(page, rc.x + 40, rc.y + rc.h / 2);
  await expectLinkEntries(menu);
});

test('S7 barra sticky opaca: la riga-link scivolata sotto durante lo scroll non regala le sue voci', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:15px sans-serif">
    <div id="bar" style="position:sticky;top:0;height:64px;background:#fafafa;border-bottom:1px solid #ddd;z-index:5;display:flex;align-items:center;padding-left:16px">Barra sticky</div>
    <div style="height:200px"></div>
    <a id="riga" href="https://malizia.test/sotto-sticky" style="display:block;height:64px;line-height:64px;background:#fff;margin:0">Riga collegamento a tutta larghezza</a>
    <div style="height:1500px"></div>
  </body></html>`);
  // scrolla finché la riga sta esattamente sotto la barra (stesso rettangolo)
  await page.evaluate(() => window.scrollTo(0, 264));
  await page.waitForTimeout(200);
  let menu = await openMenuAt(page, 300, 32);
  await expectNoLinkEntries(menu);
  await closeMenu(page);
  menu = await openMenuAt(page, 300, 61);
  await expectNoLinkEntries(menu);
});

test('S9 pannello opaco assoluto sopra un link statico in flusso: nessuna voce del link', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:15px sans-serif;padding:40px">
    <div style="position:relative;width:360px">
      <a id="lnk" href="https://malizia.test/statico-coperto" style="display:block;height:48px;line-height:48px;background:#eef">Link statico in flusso</a>
      <div id="overlay" style="position:absolute;inset:0;background:#fff;border:1px solid #999;display:flex;align-items:center;justify-content:center">Pannello opaco sopra</div>
    </div>
  </body></html>`);
  const r = await rectOf(page, '#overlay');
  const menu = await openMenuAt(page, r.x + r.w / 2, r.y + r.h / 2);
  await expectNoLinkEntries(menu);
});

test('S8 scheda VIDEO-link sepolta per intero sotto un pannello opaco a bordi condivisi: né voci del link né del filmato', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:15px sans-serif;padding:40px">
    <div style="position:relative;width:320px;height:180px">
      <a id="card" href="https://malizia.test/scheda-sepolta" style="position:absolute;inset:0;z-index:1;display:block">
        <video muted style="width:100%;height:100%;background:#123"></video>
      </a>
      <div id="pannello" style="position:absolute;inset:0;z-index:2;background:#fff;border:1px solid #ccc;display:flex;align-items:center;justify-content:center">Pannello opaco</div>
    </div>
  </body></html>`);
  const r = await rectOf(page, '#pannello');
  let menu = await openMenuAt(page, r.x + r.w / 2, r.y + r.h / 2);
  await expectNoLinkEntries(menu);
  await expect(menu.getByText('Salva video come', { exact: false })).toHaveCount(0);
  await closeMenu(page);
  menu = await openMenuAt(page, r.x + 3, r.y + 3);
  await expectNoLinkEntries(menu);
});
