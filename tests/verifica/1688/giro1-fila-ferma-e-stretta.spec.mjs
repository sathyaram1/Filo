// Verifica #1688 giro 1: la fila e il «+» non si muovono quando una scheda comincia o smette di suonare (#431.2);
// sulla scheda stretta che suona il clic sull'altoparlante rimasto solo la apre, e il titolo è leggibile o assente (#1293).
import { test, expect } from '../../fixtures/electron.mjs';

async function apriSchede(shell, app, n) {
  await shell.evaluate(async (k) => {
    for (let i = 0; i < k; i++) await window.filoShell.tabs.open('filo://newtab/');
  }, n - 1);
  await expect(shell.locator('#tabs .tab')).toHaveCount(n, { timeout: 20_000 });
  await expect(shell.locator('#tabs .tab .spinner')).toHaveCount(0, { timeout: 20_000 });
  // Titoli veri di siti, lunghi: la scheda web, non la Home.
  return patch(app, Array.from({ length: n }, (_, i) => ({
    url: `https://esempio${i}.test/pagina`, title: `Sito numero ${i} con un titolo abbastanza lungo da tagliare`,
  })));
}

async function patch(app, p) {
  return app.evaluate(({ BrowserWindow }, p) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    p.forEach((q, i) => { if (q && w._filoTabs.tabs[i]) Object.assign(w._filoTabs.tabs[i], q); });
    w._filoTabs._broadcast();
    return w._filoTabs.tabs.map((t) => t.id);
  }, p);
}

const quadri = (shell) => shell.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => {
  const r = (el) => { const q = el.getBoundingClientRect(); return [Math.round(q.left * 2) / 2, Math.round(q.width * 2) / 2]; };
  ok({ schede: [...document.querySelectorAll('#tabs .tab')].map(r), piu: r(document.getElementById('tab-new')) });
}))));

async function attendiAvviso(shell, id, n) {
  await expect(shell.locator(`#tabs .tab[data-id="${id}"] .tab-alert`)).toHaveCount(n, { timeout: 5000 });
}

for (const n of [4, 12, 30]) {
  test(`${n} schede: comincia, si muta, smette di suonare e la fila col «+» resta ferma`, async ({ shell, app }) => {
    const ids = await apriSchede(shell, app, n);
    const k = Math.min(1, n - 1);
    const attivaIdx = ids.length - 1;
    await attendiAvviso(shell, ids[k], 0);
    const prima = await quadri(shell);

    const pk = (q) => { const a = []; a[k] = q; return a; };
    await patch(app, pk({ audible: true }));
    await attendiAvviso(shell, ids[k], 1);
    expect(await quadri(shell), 'comincia a suonare').toEqual(prima);

    await patch(app, pk({ muted: true }));
    await expect(shell.locator(`#tabs .tab[data-id="${ids[k]}"] .mute-ind`)).toHaveCount(1);
    expect(await quadri(shell), 'mutata').toEqual(prima);

    await patch(app, pk({ audible: false, muted: false }));
    await attendiAvviso(shell, ids[k], 0);
    expect(await quadri(shell), 'smette di suonare').toEqual(prima);

    // La scheda attiva che suona.
    const pa = []; pa[attivaIdx] = { audible: true };
    await patch(app, pa);
    await attendiAvviso(shell, ids[attivaIdx], 1);
    expect(await quadri(shell), 'attiva che suona').toEqual(prima);
    pa[attivaIdx] = { audible: false };
    await patch(app, pa);
    await attendiAvviso(shell, ids[attivaIdx], 0);
    expect(await quadri(shell), 'attiva che smette').toEqual(prima);
  });
}

test('scheda stretta che suona: il clic sull\'altoparlante rimasto solo la apre e non tocca l\'audio', async ({ shell, app }) => {
  const ids = await apriSchede(shell, app, 30);
  const k = 3;
  const p = []; p[k] = { audible: true };
  await patch(app, p);
  const tab = shell.locator(`#tabs .tab[data-id="${ids[k]}"]`);
  await expect(tab.locator('.tab-alert')).toHaveCount(1);
  const info = await tab.evaluate((el) => {
    const visibili = [...el.children].filter((c) => getComputedStyle(c).display !== 'none').map((c) => c.className.split(' ')[0]);
    const a = el.querySelector('.tab-alert').getBoundingClientRect();
    return { w: el.getBoundingClientRect().width, visibili, x: a.left + a.width / 2, y: a.top + a.height / 2 };
  });
  expect(info.visibili).toEqual(['tab-alert']);
  await shell.mouse.click(info.x, info.y);
  await expect(tab).toHaveClass(/active/, { timeout: 5000 });
  const muta = await app.evaluate(({ BrowserWindow }, id) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return !!w._filoTabs.tabs.find((t) => t.id === id).muted;
  }, ids[k]);
  expect(muta).toBe(false);
});

test('a ogni larghezza della finestra il titolo si legge (una lettera coi puntini) o non c\'è', async ({ shell, app }) => {
  const ids = await apriSchede(shell, app, 14);
  await patch(app, ids.map((_, i) => (i % 2 ? { audible: true } : null)));
  await expect(shell.locator('#tabs .tab .tab-alert')).toHaveCount(7);
  const errori = [];
  for (let larga = 520; larga <= 1600; larga += 23) {
    await app.evaluate(({ BrowserWindow }, larga) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
      w.setSize(larga, 700);
    }, larga);
    await shell.waitForTimeout(120);
    const male = await shell.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => {
      const out = [];
      for (const tab of document.querySelectorAll('#tabs .tab')) {
        const t = tab.querySelector('.title');
        const cs = getComputedStyle(t);
        if (cs.display === 'none' || cs.visibility !== 'visible' || t.offsetWidth === 0) continue;
        const c = document.createElement('canvas').getContext('2d');
        c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const serve = c.measureText(([...t.textContent][0] || '') + '…').width;
        if (t.offsetWidth + 0.5 < serve) out.push(`${tab.dataset.id}${tab.querySelector('.tab-alert') ? ' (suona)' : ''}: titolo largo ${t.offsetWidth}, ne servono ${serve.toFixed(1)}`);
        const rt = tab.getBoundingClientRect();
        for (const f of tab.children) {
          if (getComputedStyle(f).display === 'none') continue;
          const r = f.getBoundingClientRect();
          if (r.width && (r.left < rt.left - 0.5 || r.right > rt.right + 0.5)) out.push(`${tab.dataset.id}: ${f.className} esce dalla scheda`);
        }
      }
      ok(out);
    }))));
    for (const m of male) errori.push(`finestra ${larga}: ${m}`);
  }
  expect(errori).toEqual([]);
});

test('foto della fila con schede che suonano', async ({ shell, app }) => {
  const ids = await apriSchede(shell, app, 9);
  await patch(app, ids.map((_, i) => (i === 2 ? { audible: true } : i === 4 ? { audible: true, muted: true } : null)));
  await expect(shell.locator('#tabs .tab .tab-alert')).toHaveCount(2);
  await shell.waitForTimeout(300);
  await shell.screenshot({ path: 'tests/.shots/1688-fila-9.png', clip: { x: 0, y: 0, width: 1280, height: 60 } });
  const ids2 = await apriSchede(shell, app, 26);
  await patch(app, ids2.map((_, i) => (i % 3 === 0 ? { audible: true } : null)));
  await shell.waitForTimeout(300);
  await shell.screenshot({ path: 'tests/.shots/1688-fila-26.png', clip: { x: 0, y: 0, width: 1280, height: 60 } });
});
