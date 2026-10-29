// #1487 — Una home che si apre mostra in cima l'ultimo messaggio e sotto il vuoto: ieri sta sopra, a una rotella di
// distanza. Vale per la scheda nuova, la home ricaricata e quella pronta che Ctrl+T consegna; Filo che scrive subito dopo
// l'apertura prende la cima; una conversazione che parte da lì continua sotto senza far saltare niente.

import { test, expect } from './fixtures/electron.mjs';
import { modelloFinto, chiedi } from './helpers/chatFinta.mjs';
import { mkdirSync } from 'node:fs';

const SHOTS = 'tests/.shots';
mkdirSync(SHOTS, { recursive: true });

async function semina(app, chats) {
  await app.evaluate(async (_e, dati) => {
    const E = globalThis.SN_FILO_EVENTI;
    const qui = await globalThis.SN_IL_FILO.dispositivo();
    const ev = [];
    for (const c of dati) {
      ev.push(E.crea(E.TIPI.CHAT_APERTA, { chat: c.id }, { ts: c.messaggi[0].ts, dispositivo: qui }));
      for (const m of c.messaggi) {
        ev.push(E.crea(E.TIPI.MESSAGGIO, { chat: c.id, msg: { role: m.role, text: m.text } }, { ts: m.ts, dispositivo: qui, autore: m.role === 'user' ? 'utente' : 'filo' }));
      }
      ev.push(E.crea(E.TIPI.CHAT_CHIUSA, { chat: c.id }, { ts: c.messaggi[c.messaggi.length - 1].ts, dispositivo: qui }));
    }
    await globalThis.SN_IL_FILO.importa(ev.map(E.riga).join(''));
  }, chats);
}

const alle = (giorniFa, ore, minuti = 0) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - giorniFa, ore, minuti).toISOString();
};
const pocoFa = (minuti) => new Date(Date.now() - minuti * 60_000).toISOString();

// Una giornata di ieri che da sola riempie più di uno schermo.
function ieri(n = 12) {
  const chats = [];
  for (let i = 0; i < n; i++) {
    chats.push({ id: `ieri${i}`, messaggi: [
      { role: 'user', text: `domanda di ieri ${i}`, ts: alle(1, 8 + i) },
      { role: 'filo', text: `risposta di ieri ${i}`, ts: alle(1, 8 + i, 1) },
    ] });
  }
  return chats;
}

// Il centro della home visto dall'utente: le bolle e i segni dei giorni in pixel dal bordo alto del filo a schermo.
function vista(page) {
  return page.evaluate(() => {
    const a = document.getElementById('bubbles');
    const box = a.getBoundingClientRect();
    const dove = (n) => { const r = n.getBoundingClientRect(); return { testo: n.textContent.trim(), su: r.top - box.top, giu: r.bottom - box.top }; };
    return {
      alto: box.height,
      scrollTop: a.scrollTop,
      max: a.scrollHeight - a.clientHeight,
      vuoto: getComputedStyle(a).getPropertyValue('--dash-vuoto').trim(),
      bolle: [...a.querySelectorAll(':scope > .dash-bubble')].map(dove),
      giorni: [...a.querySelectorAll(':scope > .dash-giorno')].map(dove),
    };
  });
}

// In cima c'è `testo` (col suo segno del giorno sopra), tutte le altre bolle stanno sopra, fuori vista.
async function inCima(page, testo) {
  await expect.poll(async () => {
    const v = await vista(page);
    const i = v.bolle.findIndex((b) => b.testo.includes(testo));
    if (i < 0) return `«${testo}» non c'è`;
    const b = v.bolle[i];
    if (b.su < 0 || b.su > 110) return `«${testo}» sta a ${Math.round(b.su)}px dal bordo alto`;
    const sopra = v.bolle.slice(0, i).find((x) => x.giu > 1);
    if (sopra) return `«${sopra.testo}» si vede ancora sopra`;
    return 'in cima';
  }, { timeout: 15_000 }).toBe('in cima');
  return vista(page);
}

test('aprendo la home in cima c’è solo l’ultimo messaggio e sotto è vuoto; ieri sta sopra, a una rotella', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await semina(app, [...ieri(), { id: 'oggi', messaggi: [{ role: 'filo', text: 'Buongiorno: oggi piove, prendi l’ombrello.', ts: pocoFa(1) }] }]);
  const page = await openTab('filo://newtab/');
  const v = await inCima(page, 'oggi piove');
  const ultima = v.bolle[v.bolle.length - 1];
  expect(ultima.testo).toContain('oggi piove');
  // Sotto, il vuoto: più di metà del centro.
  expect(v.alto - ultima.giu).toBeGreaterThan(v.alto / 2);
  // Il segno del giorno va su con lei, a vista sopra di lei.
  const segno = v.giorni[v.giorni.length - 1];
  expect(segno.su).toBeGreaterThanOrEqual(0);
  expect(segno.giu).toBeLessThanOrEqual(ultima.su);
  await page.screenshot({ path: `${SHOTS}/home-ultimo-in-cima.png` });

  // «In fondo» vuol dire proprio lì: scorrere fino al fondo non sposta niente e non apre altro vuoto.
  await page.evaluate(() => { const a = document.getElementById('bubbles'); a.scrollTop = a.scrollHeight; });
  const giu = await vista(page);
  expect(Math.abs(giu.bolle[giu.bolle.length - 1].su - ultima.su)).toBeLessThan(2);

  // Ieri c'è: la rotella lo riporta a vista, e la home non ci rimette le mani.
  await page.locator('#bubbles').hover();
  await page.mouse.wheel(0, -300);
  const ieri11 = async () => (await vista(page)).bolle.find((b) => b.testo === 'risposta di ieri 11');
  await expect.poll(async () => { const b = await ieri11(); return b.giu > 0 && b.su < v.alto; }).toBe(true);
  const risalito = (await ieri11()).su;
  await page.waitForTimeout(400);
  expect(Math.abs((await ieri11()).su - risalito)).toBeLessThan(2);
});

test('con la finestra che cambia misura l’ultimo messaggio resta in cima', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await semina(app, [...ieri(), { id: 'oggi', messaggi: [{ role: 'filo', text: 'Il pacco arriva alle 15.', ts: pocoFa(2) }] }]);
  const page = await openTab('filo://newtab/');
  await inCima(page, 'Il pacco arriva');
  const prima = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const [larga, alta] = w.getSize();
    w.setSize(larga - 260, alta - 160);
    return alta;
  });
  await expect.poll(async () => (await vista(page)).alto).toBeLessThan(prima);
  await inCima(page, 'Il pacco arriva');
});

test('Filo che scrive subito dopo l’apertura prende la cima: quello che c’era prima sale sopra', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await semina(app, [{ id: 'ieri', messaggi: [
    { role: 'user', text: 'trova un idraulico aperto sabato', ts: alle(1, 18) },
    { role: 'filo', text: 'Rossi & figli apre alle 8.', ts: alle(1, 18, 1) },
  ] }]);
  const page = await openTab('filo://newtab/');
  await inCima(page, 'Rossi & figli');
  // Il modello della home risponde solo al timer: il saluto della giornata, se parte, non scrive niente.
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const tutto = messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      const message = tutto.includes('preparare la dashboard') && /pasta/.test(tutto) ? 'Il timer della pasta è suonato.' : '';
      return { text: JSON.stringify({ message, suggestions: [] }), model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  });
  await app.evaluate(() => globalThis.SN_FILO_PARLA.giro({ subito: [{ tipo: 'timer', testo: 'timer «pasta»' }] }));
  await expect(page.locator('.dash-bubble-filo[data-spontaneo="1"]')).toHaveText('Il timer della pasta è suonato.');
  const v = await inCima(page, 'Il timer della pasta');
  expect(v.alto - v.bolle[v.bolle.length - 1].giu).toBeGreaterThan(v.alto / 2);
  await page.screenshot({ path: `${SHOTS}/home-ultimo-in-cima-filo-scrive.png` });
});

test('scrivo a home appena aperta: lo scambio continua sotto senza salti, e quando riempie lo schermo il filo segue il fondo', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await semina(app, ieri());
  const page = await openTab('filo://newtab/');
  const v0 = await inCima(page, 'risposta di ieri 11');
  const su0 = v0.bolle[v0.bolle.length - 1].su;
  const lunga = Array.from({ length: 60 }, (_, i) => `Riga ${i + 1} della risposta lunga.`).join('\n');
  await modelloFinto(app, [{ text: 'Sì, anche le balene.' }, { text: lunga }]);

  await chiedi(page, 'e le balene?');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Sì, anche le balene.' })).toBeVisible();
  await page.waitForTimeout(300);
  const v1 = await vista(page);
  const ancora = v1.bolle.find((b) => b.testo === 'risposta di ieri 11');
  expect(Math.abs(ancora.su - su0)).toBeLessThan(2);
  const risposta = v1.bolle[v1.bolle.length - 1];
  expect(risposta.testo).toBe('Sì, anche le balene.');
  expect(risposta.giu).toBeLessThanOrEqual(v1.alto);

  await chiedi(page, 'raccontami tutto');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Riga 60 della risposta lunga.' })).toBeVisible();
  await expect.poll(async () => {
    const v = await vista(page);
    const ultima = v.bolle[v.bolle.length - 1];
    return ['', '0px'].includes(v.vuoto) && ultima.giu <= v.alto + 1 && ultima.giu > v.alto - 60;
  }).toBe(true);
});

// La scheda di `page` davanti, come un clic sulla sua linguetta.
async function davanti(app, page) {
  const segno = `s${Math.random()}`;
  await page.evaluate((s) => { window.__segno = s; }, segno);
  await app.evaluate(async ({ BrowserWindow }, s) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
    for (const t of tm.tabs) {
      if (await t.view.webContents.executeJavaScript('window.__segno || ""') === s) { tm.activate(t.id); return; }
    }
  }, segno);
}
async function risali(page) {
  await page.locator('#bubbles').hover();
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -400);
  await expect.poll(async () => (await vista(page)).bolle.at(-1).su).toBeGreaterThan(300);
}

test('una home riaperta o ricaricata riparte dall’ultimo messaggio; tornare su una scheda già aperta non la sposta', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await semina(app, [...ieri(), { id: 'oggi', messaggi: [{ role: 'filo', text: 'Sono arrivate due mail.', ts: pocoFa(3) }] }]);
  const prima = await openTab('filo://newtab/');
  await inCima(prima, 'Sono arrivate due mail.');
  await risali(prima);
  const risalita = (await vista(prima)).bolle.at(-1).su;

  const seconda = await openTab('filo://newtab/');
  await inCima(seconda, 'Sono arrivate due mail.');
  // Tornare sulla prima non è aprirla: resta dove l'utente l'aveva lasciata.
  await davanti(app, prima);
  await prima.waitForTimeout(400);
  expect(Math.abs((await vista(prima)).bolle.at(-1).su - risalita)).toBeLessThan(2);
  await prima.reload();
  await inCima(prima, 'Sono arrivate due mail.');

  // Ricaricata mentre stava dietro, la cima la prende appena torna davanti.
  await risali(prima);
  await davanti(app, seconda);
  await prima.reload();
  await davanti(app, prima);
  await inCima(prima, 'Sono arrivate due mail.');
});

test('un ultimo messaggio più alto dello schermo comincia in cima, non finisce in fondo', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const lungo = Array.from({ length: 80 }, (_, i) => `Passo ${i + 1} della ricetta.`).join('\n');
  await semina(app, [...ieri(3), { id: 'oggi', messaggi: [{ role: 'filo', text: lungo, ts: pocoFa(4) }] }]);
  const page = await openTab('filo://newtab/');
  const v = await inCima(page, 'Passo 1 della ricetta.');
  const ultima = v.bolle[v.bolle.length - 1];
  expect(ultima.giu).toBeGreaterThan(v.alto);
  expect(['', '0px']).toContain(v.vuoto);
});

test.describe('con la home pronta per la scheda nuova', () => {
  test.use({ riservaNuovaScheda: true });

  test('Ctrl+T consegna la home con l’ultimo messaggio in cima', async ({ app, shell }) => {
    test.setTimeout(90_000);
    await semina(app, [...ieri(), { id: 'oggi', messaggi: [{ role: 'filo', text: 'La riunione è alle 10.', ts: pocoFa(5) }] }]);
    let wcId = null;
    await expect.poll(async () => {
      wcId = await app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
        const r = w && w._filoTabs.riserva;
        const wc = r && r.webContents();
        return wc && wc.getURL() === 'filo://newtab/' && !wc.isLoading() ? wc.id : null;
      });
      return wcId;
    }, { timeout: 20_000, message: 'la home pronta non c’è' }).not.toBeNull();
    // Quello che la home pronta mostrava prima, rimosso dalla vista: alla consegna riparte dall'ultimo messaggio.
    await app.evaluate(({ webContents }, id) => webContents.fromId(id).executeJavaScript(
      `window.__filoVista = ${id}; document.getElementById('bubbles').scrollTop = 0; true`), wcId);
    await shell.keyboard.press('Control+t');
    let page = null;
    await expect.poll(async () => {
      for (const w of app.windows()) {
        try { if (await w.evaluate(() => window.__filoVista || 0) === wcId) { page = w; return true; } } catch (_) {}
      }
      return false;
    }, { timeout: 10_000 }).toBe(true);
    await expect.poll(() => app.evaluate(({ BrowserWindow }, id) => {
      const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
      const t = tm.tabs.find((x) => x.id === tm.activeId);
      return !!t && t.view.webContents.id === id;
    }, wcId)).toBe(true);
    await inCima(page, 'La riunione è alle 10.');
  });
});
