// Avviso audio sulla scheda (#431): come in Chrome sta dopo il titolo, col colore delle scritte, e
// prende il posto della favicon solo quando non c'è spazio per tutte e due.
// Lo stato `audible` lo forza il main (stesso campo di audio-state-changed): in headless non suona niente.

import { test, expect } from './fixtures/electron.mjs';

const FAV = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#e00"/></svg>');

// Applica `patch[i]` alla i-esima scheda web e ribroadcasta alla shell, come l'handler di audio-state-changed.
async function patchWebTabs(app, patch) {
  return app.evaluate(({ BrowserWindow }, patch) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const web = w._filoTabs.tabs.filter((x) => /^https?:/.test(x.url || ''));
    patch.forEach((p, i) => { if (p) Object.assign(web[i], p); });
    w._filoTabs._broadcast();
    return web.map((t) => t.id);
  }, patch);
}

async function openPage(openTab, testServer, title) {
  const page = await openTab(testServer.html(`<title>${title}</title><link rel="icon" href="${FAV}"><h1 id="ok">x</h1>`));
  await page.waitForSelector('#ok');
}

// Geometria dei figli visibili di ogni scheda, nell'ordine in cui stanno.
function misura(shell) {
  return shell.evaluate(() => [...document.querySelectorAll('.tab')].map((tab) => {
    const r = tab.getBoundingClientRect();
    const figli = [...tab.children]
      .filter((c) => getComputedStyle(c).display !== 'none')
      .map((c) => {
        const q = c.getBoundingClientRect();
        return { cls: c.className, left: q.left, right: q.right, width: q.width };
      });
    return { id: tab.dataset.id, active: tab.classList.contains('active'), left: r.left, right: r.right, width: r.width, figli };
  }));
}

test('la scheda che suona tiene la favicon, e l\'icona audio sta dopo il titolo col colore delle scritte', async ({ app, shell, openTab, testServer }) => {
  await openPage(openTab, testServer, 'YouTube - un video');
  await openPage(openTab, testServer, 'Seconda');
  const ids = await patchWebTabs(app, [{ audible: true, favicon: FAV }, { audible: true, favicon: FAV }]);

  for (const id of ids) {
    const tab = shell.locator(`.tab[data-id="${id}"]`);
    await expect(tab.locator('.audio-ind')).toHaveCount(1, { timeout: 10_000 });
    await expect(tab).toHaveClass(/audible/);
    await expect(tab.locator('.tab-alert')).toHaveCount(1);
    await expect(tab.locator('.favicon')).toHaveCSS('background-image', /data:image\/svg/);

    const [s] = (await misura(shell)).filter((t) => t.id === id);
    const ordine = s.figli.map((f) => f.cls.split(' ')[0]);
    expect(ordine).toEqual(['favicon', 'title', 'tab-alert', 'close']);
    const title = s.figli[1];
    expect(title.width).toBeGreaterThan(30);

    const colori = await tab.evaluate((el) => ({
      icona: getComputedStyle(el.querySelector('.audio-ind')).color,
      titolo: getComputedStyle(el.querySelector('.title')).color,
    }));
    expect(colori.icona).toBe(colori.titolo);
  }
  // Scheda e stile letti nello stesso istante: la barra ridisegna le schede, e una appena sostituita dà uno stile vuoto (#944).
  await expect.poll(() => shell.evaluate(() => [...document.querySelectorAll('.tab.audible')]
    .map((el) => getComputedStyle(el).animationName)), { timeout: 3000 })
    .toEqual(['tab-glow-pulse', 'tab-glow-pulse']);
});

test('clic sull\'icona audio: silenzia e al suo posto compare il tasto per riattivare, che la riporta', async ({ app, shell, openTab, testServer }) => {
  await openPage(openTab, testServer, 'MUTE_TAB');
  const [id] = await patchWebTabs(app, [{ audible: true }]);
  const tab = shell.locator(`.tab[data-id="${id}"]`);
  const muted = () => app.evaluate(({ BrowserWindow }, id) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    return !!w._filoTabs.tabs.find((x) => x.id === id).muted;
  }, id);

  // Posizione letta in un colpo solo nella barra: un ridisegno (l'icona che arriva) fra trova e misura dava null.
  const xDi = (sel) => shell.evaluate(([id, s]) => document.querySelector(`.tab[data-id="${id}"] ${s}`)?.getBoundingClientRect().x ?? null, [id, sel]);
  await expect(tab.locator('.audio-ind')).toHaveCount(1, { timeout: 10_000 });
  await expect.poll(() => xDi('.audio-ind')).not.toBeNull();
  const prima = await xDi('.audio-ind');
  await tab.locator('.audio-ind').click();
  await expect.poll(muted, { timeout: 10_000 }).toBe(true);

  await expect(tab.locator('.mute-ind')).toHaveCount(1);
  await expect(tab.locator('.audio-ind')).toHaveCount(0);
  await expect(tab).not.toHaveClass(/audible/);
  await expect.poll(() => xDi('.mute-ind')).not.toBeNull();
  const dopo = await xDi('.mute-ind');
  expect(Math.abs(dopo - prima)).toBeLessThanOrEqual(1);
  const colori = await tab.evaluate((el) => [getComputedStyle(el.querySelector('.mute-ind')).color, getComputedStyle(el.querySelector('.title')).color]);
  expect(colori[0]).toBe(colori[1]);

  await tab.locator('.mute-ind').click();
  await expect.poll(muted, { timeout: 10_000 }).toBe(false);
  await expect(tab.locator('.audio-ind')).toHaveCount(1, { timeout: 10_000 });
  await expect(tab.locator('.tab-alert')).toHaveCount(1);
});

test('scheda stretta: l\'avviso audio resta sempre, la favicon cede solo quando non ci stanno tutte e due', async ({ app, shell, openTab, testServer }) => {
  await openPage(openTab, testServer, 'Suona - un titolo abbastanza lungo');
  await openPage(openTab, testServer, 'Mutata da un altro paese');
  await openPage(openTab, testServer, 'Attiva');
  const [suona, mutata, attiva] = await patchWebTabs(app, [
    { audible: true, favicon: FAV },
    { muted: true, favicon: FAV, proxy: { country: 'us', tier: null } },
    { audible: true, favicon: FAV, proxy: { country: 'us', tier: null } },
  ]);
  await expect(shell.locator(`.tab[data-id="${attiva}"]`)).toHaveClass(/active/);
  await expect(shell.locator('.tab .proxy-ind')).toHaveCount(2, { timeout: 10_000 });

  const larghezze = async (w, a) => {
    await shell.evaluate(({ w, a }) => {
      let st = document.getElementById('larghezze-431');
      if (!st) { st = document.createElement('style'); st.id = 'larghezze-431'; document.head.appendChild(st); }
      st.textContent = `.tab:not(.active){flex:0 0 ${w}px!important;min-width:${w}px!important;max-width:${w}px!important}`
        + `.tab.active{flex:0 0 ${a}px!important;min-width:${a}px!important;max-width:${a}px!important}`;
    }, { w, a });
    await shell.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  };

  const passi = [[40, 110], [44, 110], [50, 118], [55, 125], [56, 130], [60, 150], [63, 160], [64, 170], [70, 200],
    [80, 230], [85, 260], [86, 290], [95, 320], [110, 320], [117, 320], [118, 320], [140, 320], [200, 320], [260, 320]];
  for (const [w, a] of passi) {
    await larghezze(w, a);
    const schede = await misura(shell);
    for (const s of schede) {
      const dove = `scheda ${s.id} larga ${s.width}px: ${JSON.stringify(s.figli.map((f) => [f.cls, Math.round(f.left - s.left), Math.round(f.width)]))}`;
      const conAvviso = s.id === suona || s.id === mutata || s.id === attiva;
      if (s.active) expect(s.figli.some((f) => f.cls === 'close'), dove).toBe(true);
      if (!conAvviso) continue;
      // Niente esce dalla scheda e niente si sovrappone: senza priorità l'avviso finiva fuori, sulla scheda accanto.
      for (const f of s.figli) {
        expect(f.left, dove).toBeGreaterThanOrEqual(s.left - 0.5);
        expect(f.right, dove).toBeLessThanOrEqual(s.right + 0.5);
      }
      const piene = s.figli.filter((f) => f.width > 0);
      for (let i = 1; i < piene.length; i++) expect(piene[i].left, dove).toBeGreaterThanOrEqual(piene[i - 1].right - 0.5);

      const avviso = s.figli.find((f) => f.cls.includes('tab-alert'));
      const favicon = s.figli.find((f) => f.cls === 'favicon' || f.cls === 'spinner');
      expect(avviso && avviso.width, dove).toBe(16);
      // La favicon cede solo sotto i 56px: 10+8 di margini, 16+6+16 per le due icone.
      expect(!!favicon, dove).toBe(s.width >= 56);
      if (!favicon) expect(Math.abs((avviso.left + avviso.right) / 2 - (s.left + s.right) / 2), dove).toBeLessThanOrEqual(2);
      if (s.width >= 200) expect(s.figli.map((f) => f.cls.split(' ')[0]).slice(-2), dove).toEqual(['tab-alert', 'close']);
    }
  }
});

// Bordi di ogni scheda e del «+», arrotondati: quello che l'occhio vede spostarsi.
const posti = (shell) => shell.evaluate(() => [...document.querySelectorAll('.tab, .tab-new')]
  .map((el) => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; }));
const dueFotogrammi = (shell) => shell.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

test('audio che parte e si ferma: le schede e il «+» restano dove sono, e il nome torna intero alla prima occasione (#431.2)', async ({ app, shell, openTab, testServer }) => {
  for (const t of ['Gmail', 'Wikipedia', 'YouTube']) await openPage(openTab, testServer, t);
  await expect(shell.locator('.tab .title')).toHaveText(['Home', 'Gmail', 'Wikipedia', 'YouTube'], { timeout: 10_000 });
  await expect(shell.locator('.tab .spinner')).toHaveCount(0, { timeout: 10_000 });
  // Il puntatore sulla pagina: fuori dalla fila nessuno trattiene le larghezze.
  await shell.mouse.move(600, 400);
  await shell.waitForTimeout(300);
  const prima = await posti(shell);

  const passi = [
    ['YouTube (davanti) comincia a suonare', [null, null, { audible: true }], 1],
    ['Gmail (dietro) comincia a suonare', [{ audible: true }, null, null], 2],
    ['Gmail viene mutata', [{ muted: true }, null, null], 2],
    ['YouTube smette di suonare', [null, null, { audible: false }], 1],
    ['Gmail smette e torna udibile', [{ audible: false, muted: false }, null, null], 0],
    ['Wikipedia suona e smette subito', [null, { audible: true }, null], 1],
    ['Wikipedia ha smesso', [null, { audible: false }, null], 0],
  ];
  for (const [quando, patch, avvisi] of passi) {
    await patchWebTabs(app, patch);
    await expect(shell.locator('.tab .tab-alert'), quando).toHaveCount(avvisi, { timeout: 10_000 });
    await dueFotogrammi(shell);
    expect(await posti(shell), quando).toEqual(prima);
  }

  // L'avviso prende il posto dal nome finché la fila non si ridispone per altro: allora il nome torna intero.
  const [gmail] = await patchWebTabs(app, [{ audible: true }]);
  await expect(shell.locator(`.tab[data-id="${gmail}"] .audio-ind`)).toHaveCount(1, { timeout: 10_000 });
  await dueFotogrammi(shell);
  expect(await posti(shell)).toEqual(prima);
  await shell.locator('.tab', { hasText: 'Wikipedia' }).click();
  await expect(shell.locator('.tab', { hasText: 'Wikipedia' })).toHaveClass(/active/);
  await expect.poll(() => shell.evaluate((id) => {
    const t = document.querySelector(`.tab[data-id="${id}"] .title`);
    const testo = t && t.firstElementChild;
    return !!t && getComputedStyle(t).display !== 'none' && getComputedStyle(testo || t).visibility === 'visible'
      && t.scrollWidth <= t.clientWidth;
  }, gmail), { timeout: 5000, message: 'nome intero di Gmail dopo il riordino' }).toBe(true);
});

// Scheda stretta del caso #1293: 25 schede, così l'avviso resta il solo segno visibile.
async function filaPiena(app, shell, openTab, testServer, patch) {
  for (let i = 0; i < 25; i++) await openTab(testServer.html(`<title>Video ${i}</title>`));
  await expect(shell.locator('.tab')).toHaveCount(26, { timeout: 30_000 });
  const ids = await patchWebTabs(app, patch);
  await expect(shell.locator('.tab .spinner')).toHaveCount(0, { timeout: 15_000 });
  await shell.mouse.move(600, 400);
  return ids;
}
const statoScheda = (app, id) => app.evaluate(({ BrowserWindow }, id) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
  const t = w._filoTabs.tabs.find((x) => x.id === id);
  return { muted: !!t.muted, attiva: w._filoTabs.activeId === id };
}, id);

test('scheda stretta che suona o è mutata: il clic sull\'avviso rimasto solo apre la scheda senza toccarne l\'audio (#1293)', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(150_000);
  const [suona, , muta] = await filaPiena(app, shell, openTab, testServer, [{ audible: true, loading: false }, null, { muted: true, loading: false }]);
  for (const [id, muted] of [[suona, false], [muta, true]]) {
    const tab = shell.locator(`.tab[data-id="${id}"]`);
    await expect(tab.locator('.tab-alert')).toBeVisible({ timeout: 10_000 });
    await expect(tab.locator('.favicon')).toBeHidden();
    await shell.waitForTimeout(300);
    const centro = await shell.evaluate((id) => {
      const el = document.querySelector(`.tab[data-id="${id}"]`);
      el.scrollIntoView({ inline: 'nearest' });
      const r = el.getBoundingClientRect();
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      const sotto = document.elementFromPoint(x, y);
      return { x, y, width: r.width, sottoAvviso: !!(sotto && sotto.closest('.tab-alert')), sottoScheda: !!(sotto && sotto.closest(`.tab[data-id="${id}"]`)) };
    }, id);
    expect(centro.width).toBeLessThan(56);
    // Al centro risponde la scheda: clic, trascinamento e suggerimento sono i suoi.
    expect(centro).toMatchObject({ sottoAvviso: false, sottoScheda: true });
    await shell.mouse.click(centro.x, centro.y);
    await expect(tab).toHaveClass(/active/, { timeout: 5000 });
    expect(await statoScheda(app, id)).toEqual({ muted, attiva: true });
  }
  // Aperta, la scheda è larga di nuovo e l'avviso torna un tasto.
  await shell.locator(`.tab[data-id="${muta}"] .mute-ind`).click();
  await expect.poll(async () => (await statoScheda(app, muta)).muted, { timeout: 10_000 }).toBe(false);
});

test('scheda stretta con l\'avviso: il titolo mostra almeno una lettera coi puntini o non c\'è, e allargandola non torna a sparire (#1293)', async ({ app, shell, openTab, testServer }) => {
  await openPage(openTab, testServer, 'Wikipedia - Suona');
  await openPage(openTab, testServer, 'Mutata da un altro paese');
  await openPage(openTab, testServer, 'Meet - riunione');
  await openPage(openTab, testServer, 'Attiva che suona');
  // La riunione ha avuto microfono e fotocamera: i suoi segni stanno sulla pagina, come li lascia il gestore dei permessi.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const wc = w._filoTabs.tabs.filter((x) => /^https?:/.test(x.url || ''))[2].view.webContents;
    wc._filoSegni = { origine: new URL(wc.getURL()).origin, usati: new Set(['audio', 'video']), negati: new Set() };
  });
  const [suona, mutata, meet, attiva] = await patchWebTabs(app, [
    { audible: true, favicon: FAV },
    { muted: true, favicon: FAV, proxy: { country: 'us', tier: null } },
    { audible: true, favicon: FAV },
    { audible: true, favicon: FAV },
  ]);
  await expect(shell.locator(`.tab[data-id="${attiva}"]`)).toHaveClass(/active/);
  await expect(shell.locator('.tab .tab-alert')).toHaveCount(4, { timeout: 10_000 });
  await expect(shell.locator('.tab .tab-permessi')).toHaveCount(1, { timeout: 10_000 });

  const visto = new Map([[suona, []], [mutata, []], [meet, []], [attiva, []]]);
  for (let w = 40; w <= 220; w += 1) {
    await shell.evaluate((w) => {
      let st = document.getElementById('larghezze-1293');
      if (!st) { st = document.createElement('style'); st.id = 'larghezze-1293'; document.head.appendChild(st); }
      st.textContent = `.tab{flex:0 0 ${w}px!important;min-width:${w}px!important;max-width:${w}px!important}`;
    }, w);
    await dueFotogrammi(shell);
    const schede = await shell.evaluate(() => {
      const c = document.createElement('canvas').getContext('2d');
      return [...document.querySelectorAll('.tab')].map((tab) => {
        const t = tab.querySelector('.title');
        const testo = t.firstElementChild || t;
        const cs = getComputedStyle(t);
        const vede = cs.display !== 'none' && getComputedStyle(testo).visibility === 'visible';
        c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const lettera = [...(t.textContent || '')][0] || '';
        return { id: tab.dataset.id, titolo: vede ? t.getBoundingClientRect().width : 0, serve: c.measureText(lettera + '…').width,
          testo: t.textContent, paese: !!tab.querySelector('.proxy-ind') && getComputedStyle(tab.querySelector('.proxy-ind')).display !== 'none' };
      });
    });
    for (const s of schede) if (visto.has(s.id)) visto.get(s.id).push({ w, ...s });
  }
  for (const [, righe] of visto) {
    const dove = `${righe[0].testo}: ${JSON.stringify(righe.map((r) => [r.w, Math.round(r.titolo)]))}`;
    // Un tratto di lettera, o i soli puntini: mai.
    for (const r of righe) expect(r.titolo === 0 || r.titolo >= r.serve - 0.5, `larga ${r.w}px, ${dove}`).toBe(true);
    // Comparso, il titolo resta; senza il paese che entra dopo di lui, non si accorcia nemmeno.
    const primo = righe.findIndex((r) => r.titolo > 0);
    expect(primo, dove).toBeGreaterThanOrEqual(0);
    for (let i = primo + 1; i < righe.length; i++) {
      expect(righe[i].titolo, `larga ${righe[i].w}px, ${dove}`).toBeGreaterThan(0);
      if (righe[i].paese === righe[i - 1].paese) expect(righe[i].titolo, `larga ${righe[i].w}px, ${dove}`).toBeGreaterThanOrEqual(righe[i - 1].titolo - 0.5);
    }
  }
});

// Suggerimento e carta come li vede chi guarda: le finestre figlie visibili, cosa dicono e dove stanno.
async function riquadri(app) {
  return app.evaluate(async ({ BrowserWindow }) => {
    const out = { suggerimento: null, carta: null };
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.isDestroyed() || !w.isVisible()) continue;
      const url = w.webContents.getURL();
      const leggi = (js) => w.webContents.executeJavaScript(js).catch(() => null);
      if (url === 'filo://shell/anteprima.html') {
        out.carta = { testo: await leggi("document.getElementById('titolo').textContent"), ...w.getBounds() };
      } else if (url.startsWith('data:')) {
        const testo = await leggi("(document.getElementById('tip') || {}).textContent ?? null");
        if (testo != null) out.suggerimento = { testo, ...w.getBounds() };
      }
    }
    return out;
  });
}
const siCoprono = (a, b) => !!a && !!b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const scritte = async (app) => {
  const r = await riquadri(app);
  return { carta: r.carta && r.carta.testo, suggerimento: r.suggerimento && r.suggerimento.testo };
};

// Il titolo della scheda lo dice la carta (#430); il suggerimento di un controllo prende il suo posto, mai sopra (#589.16).
test('ogni controllo dentro la scheda ha il suo suggerimento di Filo, non il titolo della pagina', async ({ app, shell, openTab, testServer }) => {
  await openTab(testServer.html('<title>Musica di sottofondo</title>'));
  await openTab(testServer.html('<title>Podcast</title>'));
  // Le schede si allargano e stringono mentre i titoli arrivano: si passa col puntatore solo a barra ferma.
  await expect(shell.locator('.tab .title')).toHaveText(['Home', 'Musica di sottofondo', 'Podcast'], { timeout: 10_000 });
  await expect(shell.locator('.tab .spinner')).toHaveCount(0, { timeout: 10_000 });
  const [suona, muta] = await patchWebTabs(app, [{ audible: true }, { muted: true, proxy: { country: 'us', tier: null } }]);
  await expect(shell.locator('.tab .tab-alert')).toHaveCount(2, { timeout: 10_000 });
  await expect(shell.locator(`.tab[data-id="${muta}"]`)).toHaveClass(/active/);
  await expect(shell.locator('.tab .tab-alert[title]')).toHaveCount(0);

  const titoli = { [suona]: 'Musica di sottofondo', [muta]: 'Podcast' };
  const via = async () => {
    await shell.mouse.move(2, 2);
    await expect.poll(() => scritte(app), { timeout: 3000, message: 'puntatore fuori dalla barra' }).toEqual({ carta: null, suggerimento: null });
  };
  const sulTitolo = async (id) => {
    await shell.locator(`.tab[data-id="${id}"] .title`).hover();
    await expect.poll(() => scritte(app), { timeout: 3000, message: `titolo di ${titoli[id]}` })
      .toEqual({ carta: titoli[id], suggerimento: null });
  };

  // La carta sparisce qualche fotogramma dopo la richiesta (si svuota prima): il suggerimento che compariva intanto le
  // stava sopra, e il confronto dei riquadri lo vedeva solo a volte (#944). Il main lo dice nell'istante in cui lo mostra.
  await app.evaluate(({ app: electronApp, BrowserWindow }) => {
    globalThis.__sopraLaCarta = 0;
    const segui = (w) => w.on('show', () => {
      if (w.isDestroyed() || !w.webContents.getURL().startsWith('data:')) return;
      if (BrowserWindow.getAllWindows().some((x) => !x.isDestroyed() && x.isVisible()
        && x.webContents.getURL() === 'filo://shell/anteprima.html')) globalThis.__sopraLaCarta++;
    });
    BrowserWindow.getAllWindows().forEach(segui);
    electronApp.on('browser-window-created', (_e, w) => segui(w));
  });

  const ctrlW = await shell.evaluate(() => (window.SN_TASTI ? window.SN_TASTI.etichetta('Ctrl+W') : 'Ctrl+W'));
  const casi = [
    [suona, '.audio-ind', 'Silenzia'],
    [muta, '.mute-ind', 'Riattiva audio'],
    [muta, '.proxy-ind', 'Aperta da un altro paese'],
    [muta, '.close', `Chiudi scheda (${ctrlW})`],
    [suona, '.close', 'Chiudi scheda'],
  ];
  for (const [id, cls, atteso] of casi) {
    await via();
    await sulTitolo(id);
    await shell.locator(`.tab[data-id="${id}"] ${cls}`).hover();
    await expect.poll(async () => (await scritte(app)).suggerimento, { timeout: 3000, message: cls }).toBe(atteso);
    const r = await riquadri(app);
    expect(siCoprono(r.suggerimento, r.carta), `${cls}: ${JSON.stringify(r)}`).toBe(false);
    // Tornando sul titolo la carta torna e il suggerimento se ne va.
    await sulTitolo(id);
  }
  expect(await app.evaluate(() => globalThis.__sopraLaCarta), 'suggerimenti comparsi con la carta ancora a schermo').toBe(0);
  // Oltre l'attesa del suggerimento: la carta non ha un doppione di testo sotto.
  await new Promise((r) => setTimeout(r, 600));
  expect(await scritte(app)).toEqual({ carta: titoli[casi.at(-1)[0]], suggerimento: null });

  // Attraversando la croce verso la scheda accanto la carta passa all'altra senza spegnersi: niente lampo.
  await via();
  await sulTitolo(suona);
  const centro = async (sel) => {
    const b = await shell.locator(sel).boundingBox();
    return [b.x + b.width / 2, b.y + b.height / 2];
  };
  const croce = await centro(`.tab[data-id="${suona}"] .close`);
  const accanto = await centro(`.tab[data-id="${muta}"] .title`);
  await app.evaluate(({ ipcMain }) => {
    globalThis.__spente = 0;
    ipcMain.on('anteprima:nascondi', () => { globalThis.__spente++; });
  });
  await shell.mouse.move(...croce);
  await shell.mouse.move(...accanto);
  await expect.poll(() => scritte(app), { timeout: 3000, message: 'carta sulla scheda accanto' }).toEqual({ carta: 'Podcast', suggerimento: null });
  expect(await app.evaluate(() => globalThis.__spente), 'la carta si è spenta passando sulla croce').toBe(0);

  // La musica finisce col puntatore fermo sull'altoparlante: il suo suggerimento se ne va con lui.
  await via();
  await sulTitolo(suona);
  await shell.locator(`.tab[data-id="${suona}"] .audio-ind`).hover();
  await expect.poll(async () => (await scritte(app)).suggerimento, { timeout: 3000, message: 'altoparlante' }).toBe('Silenzia');
  await patchWebTabs(app, [{ audible: false }]);
  await expect(shell.locator(`.tab[data-id="${suona}"] .tab-alert`)).toHaveCount(0);
  await expect.poll(async () => {
    const r = await riquadri(app);
    return { rimasto: !!r.suggerimento && r.suggerimento.testo === 'Silenzia', coperti: siCoprono(r.suggerimento, r.carta) };
  }, { timeout: 3000, message: 'altoparlante sparito' }).toEqual({ rimasto: false, coperti: false });

  // Con l'anteprima spenta dalle Preferenze il titolo torna nel suggerimento, e i controlli tengono il loro.
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { tabPreview: { enabled: false } } }));
  await expect(shell.locator(`.tab[data-id="${suona}"]`)).toHaveAttribute('data-tip', 'Musica di sottofondo', { timeout: 5000 });
  await via();
  await shell.locator(`.tab[data-id="${suona}"] .title`).hover();
  await expect.poll(() => scritte(app), { timeout: 3000, message: 'titolo senza anteprima' })
    .toEqual({ carta: null, suggerimento: 'Musica di sottofondo' });
  await patchWebTabs(app, [{ audible: true }]);
  await expect(shell.locator('.tab .tab-alert')).toHaveCount(2, { timeout: 10_000 });
  for (const [id, cls, atteso] of casi) {
    await via();
    await shell.locator(`.tab[data-id="${id}"] ${cls}`).hover();
    await expect.poll(() => scritte(app), { timeout: 3000, message: `${cls} senza anteprima` })
      .toEqual({ carta: null, suggerimento: atteso });
  }
});
