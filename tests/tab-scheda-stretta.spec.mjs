// Scheda stretta senza avviso audio (#945): come quella con l'avviso (tests/tab-audio-indicator.spec.mjs) cede
// prima il paese, poi il titolo, poi la X sulle inattive; niente esce dalla scheda. Regole in shell.css.

import { test, expect } from './fixtures/electron.mjs';

async function apriSchede(shell, n) {
  await shell.evaluate(async (k) => {
    for (let i = 0; i < k; i++) await window.filoShell.tabs.open('filo://newtab/');
  }, n - 1);
  await expect(shell.locator('#tabs .tab')).toHaveCount(n, { timeout: 15_000 });
  await expect(shell.locator('#tabs .tab .spinner')).toHaveCount(0, { timeout: 15_000 });
}

// Applica `patch[i]` alla i-esima scheda e ribroadcasta alla shell; restituisce gli id nell'ordine della striscia.
async function patchSchede(app, patch) {
  return app.evaluate(({ BrowserWindow }, patch) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    patch.forEach((p, i) => { if (p && w._filoTabs.tabs[i]) Object.assign(w._filoTabs.tabs[i], p); });
    w._filoTabs._broadcast();
    return w._filoTabs.tabs.map((t) => t.id);
  }, patch);
}

function misura(shell) {
  return shell.evaluate(() => [...document.querySelectorAll('#tabs .tab')].map((tab) => {
    const r = tab.getBoundingClientRect();
    const figli = [...tab.children]
      .filter((c) => getComputedStyle(c).display !== 'none')
      // Le misure di layout, non il riquadro a schermo: la spinner gira e il suo riquadro ruotato è più largo.
      .map((c) => ({ cls: c.className.split(' ')[0], left: r.left + c.offsetLeft, right: r.left + c.offsetLeft + c.offsetWidth, width: c.offsetWidth }));
    // Il titolo che si legge: quanto è largo e quanto vuole la sua prima lettera coi puntini (#1293).
    const t = tab.querySelector('.title');
    const cs = getComputedStyle(t);
    const c = document.createElement('canvas').getContext('2d');
    c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const leggibile = cs.display !== 'none' && getComputedStyle(t.firstElementChild || t).visibility === 'visible';
    const titolo = { largo: leggibile ? t.offsetWidth : 0, serve: c.measureText(([...t.textContent][0] || '') + '…').width };
    return { id: tab.dataset.id, active: tab.classList.contains('active'), left: r.left, right: r.right, width: r.width, figli, titolo };
  }));
}

test('con tante schede ogni X visibile sta nella sua scheda: il clic sul suo centro la prende', async ({ shell }) => {
  await apriSchede(shell, 22);
  const esito = await shell.evaluate(() => [...document.querySelectorAll('#tabs .tab')].flatMap((tab) => {
    const x = tab.querySelector('.close');
    if (!x || getComputedStyle(x).display === 'none') return [];
    const r = x.getBoundingClientRect();
    const sotto = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
    return sotto && sotto.closest('.close') === x ? [] : [`${tab.dataset.id} larga ${tab.getBoundingClientRect().width}: al centro della X c'è ${sotto ? sotto.className || sotto.tagName : 'niente'}`];
  }));
  expect(esito).toEqual([]);
  await expect(shell.locator('#tabs .tab.active .close')).toBeVisible();
});

test('scheda stretta: cede paese, poi titolo, poi la X sulle inattive; l\'attiva tiene la X', async ({ app, shell }) => {
  await apriSchede(shell, 5);
  const paese = { proxy: { country: 'us', tier: null } };
  const ids = await patchSchede(app, [{}, { loading: true }, paese, { ...paese, loading: true }, {}]);
  await expect(shell.locator('#tabs .tab .proxy-ind')).toHaveCount(2, { timeout: 10_000 });

  const larghe = async (w) => {
    await shell.evaluate((w) => {
      let st = document.getElementById('larghezze-945');
      if (!st) { st = document.createElement('style'); st.id = 'larghezze-945'; document.head.appendChild(st); }
      st.textContent = `.tab{flex:0 0 ${w}px!important;min-width:${w}px!important;max-width:${w}px!important}`;
    }, w);
    await shell.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  };

  // Due giri: attiva una scheda senza paese, poi una col paese (con le larghezze ferme l'attiva può essere stretta).
  for (const attiva of [ids[4], ids[2]]) {
    await shell.evaluate((id) => window.filoShell.tabs.activate(id), attiva);
    await expect(shell.locator(`#tabs .tab[data-id="${attiva}"]`)).toHaveClass(/active/);
    for (const w of [40, 44, 50, 57, 58, 60, 63, 64, 65, 66, 70, 80, 89, 90, 95, 96, 99, 100, 110, 123, 124, 140, 200]) {
      await larghe(w);
      for (const s of await misura(shell)) {
        const dove = `scheda ${s.id}${s.active ? ' (attiva)' : ''} larga ${s.width}px: ${JSON.stringify(s.figli.map((f) => [f.cls, Math.round(f.left - s.left), Math.round(f.width)]))}`;
        for (const f of s.figli) {
          expect(f.left, dove).toBeGreaterThanOrEqual(s.left - 0.5);
          expect(f.right, dove).toBeLessThanOrEqual(s.right + 0.5);
        }
        // Sulle inattive la X non è in fila: sta sopra la fine del nome, contro il bordo destro (#429).
        const xSopra = !s.active && s.figli.find((f) => f.cls === 'close');
        if (xSopra) expect(Math.round(s.right - xSopra.right), dove).toBe(8);
        const piene = s.figli.filter((f) => f.width > 0 && f !== xSopra);
        for (let i = 1; i < piene.length; i++) expect(piene[i].left, dove).toBeGreaterThanOrEqual(piene[i - 1].right - 0.5);

        const ha = (c) => s.figli.some((f) => f.cls === c);
        const icona = ha('favicon') || ha('spinner');
        // 10+8 di margini; icona 16 e X 18 con 6 di gap; il titolo vive da 6px di gap in più; il paese ne chiede 32.
        if (s.active) {
          expect(ha('close'), dove).toBe(true);
          expect(icona, dove).toBe(s.width >= 58);
        } else {
          expect(icona, dove).toBe(true);
          expect(ha('close'), dove).toBe(s.width >= 58);
        }
        // Il posto del titolo c'è da 6px di gap più 12 dopo l'icona (sull'attiva anche la X in fila); il testo si legge
        // quando ci sta una lettera coi puntini (2em), e il paese entra solo se al titolo restano i suoi 2em.
        expect(ha('title'), dove).toBe(s.width >= (s.active ? 64 : 52));
        expect(s.titolo.largo === 0 || s.titolo.largo >= s.titolo.serve - 0.5, `${dove} titolo ${JSON.stringify(s.titolo)}`).toBe(true);
        expect(s.titolo.largo > 0, `${dove} titolo ${JSON.stringify(s.titolo)}`).toBe(s.width >= (s.active ? 90 : 66));
        if (s.id === ids[2] || s.id === ids[3]) expect(ha('proxy-ind'), dove).toBe(s.width >= (s.active ? 124 : 100));
        // La spinner non si schiaccia: resta un cerchio.
        const spin = s.figli.find((f) => f.cls === 'spinner');
        if (spin) expect(spin.width, dove).toBe(12);
      }
    }
  }
});
