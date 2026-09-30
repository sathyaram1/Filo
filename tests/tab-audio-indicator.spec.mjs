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
  const glow = await shell.locator('.tab.audible').first().evaluate((el) => getComputedStyle(el).animationName);
  expect(glow).toContain('tab-glow-pulse');
});

test('clic sull\'icona audio: silenzia e al suo posto compare il tasto per riattivare, che la riporta', async ({ app, shell, openTab, testServer }) => {
  await openPage(openTab, testServer, 'MUTE_TAB');
  const [id] = await patchWebTabs(app, [{ audible: true }]);
  const tab = shell.locator(`.tab[data-id="${id}"]`);
  const muted = () => app.evaluate(({ BrowserWindow }, id) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    return !!w._filoTabs.tabs.find((x) => x.id === id).muted;
  }, id);

  await expect(tab.locator('.audio-ind')).toHaveCount(1, { timeout: 10_000 });
  const prima = await tab.locator('.audio-ind').boundingBox();
  await tab.locator('.audio-ind').click();
  await expect.poll(muted, { timeout: 10_000 }).toBe(true);

  await expect(tab.locator('.mute-ind')).toHaveCount(1);
  await expect(tab.locator('.audio-ind')).toHaveCount(0);
  await expect(tab).not.toHaveClass(/audible/);
  const dopo = await tab.locator('.mute-ind').boundingBox();
  expect(Math.abs(dopo.x - prima.x)).toBeLessThanOrEqual(1);
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
