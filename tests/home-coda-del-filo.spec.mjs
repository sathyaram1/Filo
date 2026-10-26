// #869 — Il centro della home è la coda del filo: lo scambio di prima in fondo anche in una scheda nuova, i segni dei
// giorni e i giorni prima sbiaditi, «risali» a pezzi senza salti, nessuna chiamata al modello aprendo schede, Filo che
// scrive quando suona un timer (e un secondo evento nello stesso messaggio), le pagine visitate ripiegate che si riaprono
// e si tolgono anche dal disco, la ricerca nel filo senza la chat, le azioni fatte dall'interfaccia come righe sottili.

import { test, expect } from './fixtures/electron.mjs';
import { home, modelloFinto, chiedi, chiamateAlModello } from './helpers/chatFinta.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { mezzanotte, oggiFa } from './helpers/istanti.mjs';

const SHOTS = 'tests/.shots';
mkdirSync(SHOTS, { recursive: true });

// Un modello per la chat e uno per la home; la home risponde dicendo cosa le è stato chiesto di raccontare, e conta.
async function modelli(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__home_calls = 0;
    const P = globalThis.SN_PROVIDERS;
    P.completeWithFallback = async ({ attempts, messages }) => {
      const tutto = messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      let text = '{}';
      if (tutto.includes('preparare la dashboard')) {
        globalThis.__home_calls += 1;
        const i = tutto.indexOf('PERCHÉ SCRIVI ADESSO:');
        const perche = i >= 0 ? tutto.slice(i, tutto.indexOf('\n\n', i)) : '';
        const detto = [];
        if (/giornata/.test(perche)) detto.push('Buongiorno.');
        if (/pasta/.test(perche)) detto.push('Il timer della pasta è suonato.');
        if (/Giacomo/.test(perche)) detto.push('Giacomo ti ha scritto.');
        text = JSON.stringify({ message: detto.join(' '), suggestions: [] });
      }
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  });
}

const chiamateHome = (app) => app.evaluate(() => globalThis.__home_calls || 0);

// Eventi del filo scritti come li scrive chi salva, con la loro ora.
async function semina(app, { chats = [], pagine = [] }) {
  await app.evaluate(async (_e, dati) => {
    const E = globalThis.SN_FILO_EVENTI;
    const qui = await globalThis.SN_IL_FILO.dispositivo();
    const ev = [];
    for (const c of dati.chats) {
      const disp = c.dispositivo || qui;
      ev.push(E.crea(E.TIPI.CHAT_APERTA, { chat: c.id }, { ts: c.messaggi[0].ts, dispositivo: disp }));
      for (const m of c.messaggi) {
        ev.push(E.crea(E.TIPI.MESSAGGIO, { chat: c.id, msg: { role: m.role, text: m.text } }, { ts: m.ts, dispositivo: disp, autore: m.role === 'user' ? 'utente' : 'filo' }));
      }
      ev.push(E.crea(E.TIPI.CHAT_CHIUSA, { chat: c.id }, { ts: c.messaggi[c.messaggi.length - 1].ts, dispositivo: disp }));
    }
    for (const p of dati.pagine) ev.push(E.crea(E.TIPI.NAVIGAZIONE, { url: p.url, titolo: p.titolo }, { ts: p.ts, dispositivo: qui }));
    await globalThis.SN_IL_FILO.importa(ev.map(E.riga).join(''));
  }, { chats, pagine });
}

const alle = (giorniFa, ore, minuti = 0) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - giorniFa, ore, minuti).toISOString();
};

test('scrivo a Filo e apro una scheda nuova: il mio scambio è in fondo al centro e lo continuo nella stessa chat', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const casa = await home(app);
  await modelloFinto(app, [{ text: 'Le orche cacciano in branco.' }, { text: 'Sì, anche le balene.' }]);
  await chiedi(casa, 'come cacciano le orche?');
  await expect(casa.locator('.dash-bubble-filo', { hasText: 'Le orche cacciano in branco.' })).toBeVisible();

  const nuova = await openTab('filo://newtab/');
  const ultima = nuova.locator('#bubbles .dash-bubble').last();
  await expect(ultima).toHaveText('Le orche cacciano in branco.');
  await expect(nuova.locator('#bubbles .dash-bubble-user', { hasText: 'come cacciano le orche?' })).toBeVisible();
  // Il centro è il filo: niente foglio bianco con un messaggio.
  await expect(nuova.locator('#homeMessage')).toBeHidden();

  await chiedi(nuova, 'e le balene?');
  await expect(nuova.locator('.dash-bubble-filo', { hasText: 'Sì, anche le balene.' })).toBeVisible();
  // La bolla compare mentre la risposta arriva; nel filo entra appena finita.
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_IL_FILO.chats()).filter((c) => !c.app).map((c) => c.messages.map((m) => m.text))))
    .toEqual([['come cacciano le orche?', 'Le orche cacciano in branco.', 'e le balene?', 'Sì, anche le balene.']]);
});

test('il giorno dopo c’è il segno «ieri», lo scambio è sbiadito, e da un altro dispositivo lo dice', async ({ app, openTab }) => {
  await semina(app, {
    chats: [
      { id: 'ieri', messaggi: [{ role: 'user', text: 'trova un idraulico aperto sabato', ts: alle(1, 18) }, { role: 'filo', text: 'Rossi & figli apre alle 8.', ts: alle(1, 18, 1) }] },
      { id: 'tel', dispositivo: 'telefono-di-prova', messaggi: [{ role: 'user', text: 'sveglia alle 7', ts: alle(1, 22) }] },
    ],
  });
  const page = await openTab('filo://newtab/');
  await expect(page.locator('.dash-giorno', { hasText: 'ieri' })).toBeVisible();
  const bolla = page.locator('.dash-bubble-user', { hasText: 'trova un idraulico' });
  await expect(bolla).toHaveClass(/dash-vecchio/);
  const opacita = await bolla.evaluate((n) => Number(getComputedStyle(n).opacity));
  expect(opacita).toBeLessThan(0.8);
  await expect(page.locator('.dash-altrove', { hasText: 'da un altro dispositivo' })).toHaveCount(1);
  await page.screenshot({ path: `${SHOTS}/home-coda-ieri.png` });
});

test('«risali» carica il pezzo prima senza far saltare la posizione, e all’inizio del filo lo dice', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const chats = [];
  for (let i = 0; i < 90; i++) {
    const ts = new Date(Date.now() - (90 - i) * 3 * 3600000).toISOString();
    chats.push({ id: `c${i}`, messaggi: [{ role: 'user', text: `domanda numero ${i}`, ts }] });
  }
  await semina(app, { chats });
  const page = await openTab('filo://newtab/');
  const bolle = page.locator('#bubbles .dash-bubble-user');
  await expect(bolle.last()).toHaveText('domanda numero 89');
  const prima = await bolle.count();
  expect(prima).toBeLessThan(90);
  // Fermi poco sotto la cima, il primo messaggio a vista: il pezzo nuovo entra sopra e quello che si guarda non si sposta.
  const testoFermo = await bolle.first().textContent();
  const fermo = page.locator('.dash-bubble-user', { hasText: testoFermo });
  const yPrima = await page.evaluate(() => {
    const a = document.getElementById('bubbles');
    a.scrollTop = 120;
    return null;
  }).then(() => fermo.evaluate((n) => n.getBoundingClientRect().top));
  await page.evaluate(() => document.querySelector('.dash-risali-btn').click());
  await expect.poll(() => bolle.count()).toBeGreaterThan(prima);
  const yDopo = await fermo.evaluate((n) => n.getBoundingClientRect().top);
  expect(Math.abs(yDopo - yPrima)).toBeLessThan(3);
  // Scorrendo fino in cima il filo continua a risalire da sé, fino all'inizio.
  for (let i = 0; i < 5 && await page.locator('.dash-risali-btn').isEnabled(); i++) {
    await page.evaluate(() => { document.getElementById('bubbles').scrollTop = 0; });
    await page.waitForTimeout(400);
  }
  await expect(page.locator('.dash-risali-btn')).toHaveText('l’inizio del filo');
  await expect(page.locator('.dash-risali-btn')).toBeDisabled();
  await expect(bolle).toHaveCount(90);
});

test('dieci schede nuove non chiamano il modello; il saluto della giornata arriva una volta sola', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  // Il saluto della giornata aspetta le cinque: prima di quell'ora l'orologio del main va alle dieci dello stesso giorno.
  await app.evaluate((_e, ora) => {
    const vero = Date.now.bind(Date);
    const d = new Date(vero());
    if (d.getHours() >= ora) return;
    const spostamento = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 10).getTime() - d.getTime();
    Date.now = () => vero() + spostamento;
  }, await app.evaluate(() => globalThis.SN_FILO_CODA.ORA_GIORNATA));
  await home(app);
  await modelli(app);
  const storiaPrima = await app.evaluate(async () => (await globalThis.SN_HISTORY.list()).length);
  const prima = await openTab('filo://newtab/');
  await expect(prima.locator('.dash-bubble-filo[data-spontaneo="1"]', { hasText: 'Buongiorno.' })).toBeVisible({ timeout: 15_000 });
  expect(await chiamateHome(app)).toBe(1);
  for (let i = 0; i < 10; i++) {
    const p = await openTab('filo://newtab/');
    await expect(p.locator('.dash-bubble-filo', { hasText: 'Buongiorno.' })).toBeVisible();
  }
  await new Promise((r) => setTimeout(r, 2500));
  expect(await chiamateHome(app)).toBe(1);
  const storiaDopo = await app.evaluate(async () => (await globalThis.SN_HISTORY.list()).length);
  expect(storiaDopo - storiaPrima).toBe(1);
});

test('un timer che scade con la home aperta fa scrivere Filo nel filo; un evento subito dopo finisce nello stesso messaggio', async ({ app }) => {
  test.setTimeout(90_000);
  const casa = await home(app);
  await semina(app, { chats: [{ id: 'oggi', messaggi: [{ role: 'user', text: 'ciao', ts: new Date(Date.now() - 3 * 3600000).toISOString() }] }] });
  await modelli(app);
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.addTimer({ label: 'pasta', seconds: 1 }));
  const spontanei = casa.locator('.dash-bubble-filo[data-spontaneo="1"]');
  await expect(spontanei).toHaveText('Il timer della pasta è suonato.', { timeout: 20_000 });
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.addNotification({ kind: 'info', text: 'Giacomo ti ha mandato una mail' }));
  await expect(spontanei).toHaveText('Il timer della pasta è suonato. Giacomo ti ha scritto.', { timeout: 15_000 });
  await expect(spontanei).toHaveCount(1);
  const messaggi = await app.evaluate(async () => (await globalThis.SN_IL_FILO.chats()).flatMap((c) => c.messages.filter((m) => m.spontaneo).map((m) => m.text)));
  expect(messaggi).toEqual(['Il timer della pasta è suonato. Giacomo ti ha scritto.']);
  await casa.screenshot({ path: `${SHOTS}/home-coda-filo-parla.png` });
});

test('Filo che scrive mentre la scheda nuova legge ancora il filo compare una volta sola', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await home(app);
  await semina(app, { chats: [{ id: 'adesso', messaggi: [{ role: 'user', text: 'ciao', ts: new Date(Date.now() - 60_000).toISOString() }] }] });
  await modelli(app);
  // La prima lettura della coda aspetta un cancello: il messaggio di Filo arriva alla scheda prima della coda che lo porta.
  await app.evaluate(() => {
    const C = globalThis.SN_CODA_FILO;
    const vero = C.pezzo;
    globalThis.__cancello = new Promise((r) => { globalThis.__apri = r; });
    C.pezzo = async (o = {}) => { if (!o.prima && !o.dopo && !o.fino) await globalThis.__cancello; return vero(o); };
  });
  const page = await openTab('filo://newtab/');
  await app.evaluate(() => globalThis.SN_FILO_PARLA.giro({ subito: [{ tipo: 'timer', testo: 'timer «pasta»' }] }));
  await new Promise((r) => setTimeout(r, 500));
  await app.evaluate(() => globalThis.__apri());
  const spontanei = page.locator('.dash-bubble-filo[data-spontaneo="1"]');
  await expect(spontanei).toHaveText('Il timer della pasta è suonato.');
  await expect(page.locator('.dash-bubble-user', { hasText: 'ciao' })).toBeVisible();
  await new Promise((r) => setTimeout(r, 500));
  await expect(spontanei).toHaveCount(1);
  // Il turno dopo continua la stessa conversazione, con lo storico di prima dell'annuncio.
  await modelloFinto(app, [{ text: 'Scolala.' }]);
  await chiedi(page, 'e adesso?');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Scolala.' })).toBeVisible();
  const chiamate = await chiamateAlModello(app);
  const turno = JSON.stringify(chiamate[chiamate.length - 1]);
  expect(turno).toContain('ciao');
  expect(turno).toContain('Il timer della pasta è suonato.');
  const chats = await app.evaluate(async () => (await globalThis.SN_IL_FILO.chats()).filter((c) => !c.app).map((c) => c.id));
  expect(chats).toEqual(['adesso']);
});

test('le pagine visitate entrano ripiegate: si aprono, riaprono la pagina scelta, e tolte col tasto destro spariscono dal disco', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const casa = await home(app);
  const urls = [];
  for (const nome of ['orche che cacciano', 'balene', 'delfini']) {
    const url = testServer.html(`<title>${nome}</title><p>${nome}</p>`);
    urls.push(url);
    const p = await openTab(url);
    await p.waitForFunction((n) => document.title === n, nome);
  }
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_IL_FILO.pagine()).length)).toBe(3);
  const page = await openTab('filo://newtab/');
  const riga = page.locator('.dash-pagine').last();
  await expect(riga.locator('.dash-pagine-testo')).toHaveText('3 pagine, fra cui delfini');
  await riga.locator('.dash-pagine-testa').click();
  const balene = riga.locator('.dash-pagina', { hasText: 'balene' });
  await expect(balene).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/home-coda-pagine.png` });
  const schede = async () => (await shell.evaluate(() => window.filoShell.tabs.snapshot())).tabs.map((t) => t.url);
  const quante = (await schede()).filter((u) => u === urls[1]).length;
  // La visita cliccata: tornati alla home la riga ha anche quella nuova che il clic apre, con lo stesso titolo.
  const visita = await balene.getAttribute('data-id');
  await balene.click();
  await expect.poll(async () => (await schede()).filter((u) => u === urls[1]).length).toBe(quante + 1);
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_IL_FILO.pagine()).length)).toBe(4);

  await page.bringToFront();
  await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    const t = s.tabs.filter((x) => String(x.url).startsWith('filo://newtab')).pop();
    await window.filoShell.tabs.activate(t.id);
  });
  await riga.locator(`.dash-pagina[data-id="${visita}"]`).click({ button: 'right' });
  await menuDi(page).locator('.sn-menu').getByText('Togli dal filo', { exact: true }).click();
  // Via quella visita; la riga si rifà sul filo, dove c'è anche la visita nuova che il clic ha aperto.
  await expect(riga.locator(`.dash-pagina[data-id="${visita}"]`)).toHaveCount(0);
  await expect(riga.locator('.dash-pagine-testo')).toHaveText('3 pagine, fra cui balene');
  const file = await app.evaluate(async () => {
    await globalThis.SN_IL_FILO.quandoFermo();
    return globalThis.SN_IL_FILO.percorso();
  });
  const sulDisco = readFileSync(file, 'utf8');
  // Via quella visita, col suo titolo; resta la visita nuova che il clic di prima ha aperto, e restano le altre pagine.
  expect(sulDisco).not.toContain(visita);
  expect(sulDisco).toContain(urls[2]);
  expect(await app.evaluate(async (_e, id) => (await globalThis.SN_IL_FILO.pagine()).some((p) => p.id === id), visita)).toBe(false);
  void casa;
});

// #1307.4 — una visita si scrive a pagina caricata: se arriva con la home già davanti, nessun ritorno in vista la porta.
test('una pagina che finisce di caricarsi con la home davanti entra nel suo gruppo, anche dopo una tolta, e il titolo che si dà dopo le dà il nome', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await home(app);
  const pagine = ['orche che cacciano', 'balene', 'delfini'].map((titolo, i) => ({ url: `https://esempio.test/${i}`, titolo, ts: oggiFa(0.05 - i * 0.01, 1000 * (i + 1)) }));
  await semina(app, { pagine });
  const page = await openTab('filo://newtab/');
  const riga = page.locator('.dash-pagine').last();
  await expect(riga.locator('.dash-pagine-testo')).toHaveText('3 pagine, fra cui delfini');
  await riga.locator('.dash-pagine-testa').click();
  await riga.locator('.dash-pagina', { hasText: 'balene' }).click({ button: 'right' });
  await menuDi(page).locator('.sn-menu').getByText('Togli dal filo', { exact: true }).click();
  await expect(riga.locator('.dash-pagine-testo')).toHaveText('2 pagine, fra cui delfini');
  const id = await app.evaluate(async () => (await globalThis.SN_IL_FILO.registraVisita({ url: 'https://esempio.test/1', titolo: 'Caricamento…' })).id);
  await expect(riga.locator('.dash-pagine-testo')).toHaveText('3 pagine, fra cui Caricamento…');
  await app.evaluate((_e, visita) => globalThis.SN_IL_FILO.aggiornaTitolo({ visita, titolo: 'balene' }), id);
  await expect(riga.locator('.dash-pagine-testo')).toHaveText('3 pagine, fra cui balene');
  await expect(page.locator('.dash-pagine')).toHaveCount(1);
  await expect(riga).toHaveClass(/dash-pagine-aperte/);
  await expect(riga.locator(`.dash-pagina[data-id="${id}"]`)).toContainText('balene');
});

test('con la home vuota davanti, una pagina che finisce di caricarsi entra nel filo', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await expect(page.locator('.dash-pagine')).toHaveCount(0);
  await app.evaluate(() => globalThis.SN_IL_FILO.registraVisita({ url: 'https://esempio.test/orche', titolo: 'orche' }));
  await expect(page.locator('.dash-pagine .dash-pagine-testo')).toHaveText(['1 pagina: orche']);
});

test('cerco «orche» nel campo: trovo lo scambio e la pagina senza che la chat risponda, e il clic porta lì', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const chats = [{ id: 'sab', messaggi: [{ role: 'user', text: 'come cacciano le orche?', ts: alle(5, 10) }, { role: 'filo', text: 'In branco, con le onde.', ts: alle(5, 10, 1) }] }];
  for (let i = 0; i < 80; i++) chats.push({ id: `x${i}`, messaggi: [{ role: 'user', text: `altro ${i}`, ts: alle(4, 0, i * 10) }] });
  await semina(app, { chats, pagine: [{ url: 'https://www.youtube.com/watch?v=orche', titolo: 'YouTube: orche', ts: alle(5, 10, 2) }] });
  const page = await openTab('filo://newtab/');
  await modelloFinto(app, [{ text: 'NON DOVEVO RISPONDERE' }]);
  await expect(page.locator('.dash-bubble-user', { hasText: 'come cacciano le orche?' })).toHaveCount(0);
  await page.locator('#cercaInput').fill('orche');
  const risultati = page.locator('#cercaRisultati');
  await expect(risultati.locator('.dash-cerca-msg', { hasText: 'come cacciano le orche?' })).toBeVisible();
  await expect(risultati.locator('.dash-cerca-pagina', { hasText: 'YouTube: orche' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/home-coda-cerca.png` });
  await risultati.locator('.dash-cerca-msg', { hasText: 'come cacciano le orche?' }).click();
  const bolla = page.locator('.dash-bubble-user', { hasText: 'come cacciano le orche?' });
  await expect(bolla).toBeInViewport();
  await expect(bolla).toHaveClass(/dash-trovato/);
  expect(await app.evaluate(() => (globalThis.__chatFinta_calls || []).length)).toBe(0);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'NON DOVEVO RISPONDERE' })).toHaveCount(0);
});

test('un cambio fatto dall’interfaccia è una riga sottile nel filo, e da lì si annulla', async ({ app }) => {
  const casa = await home(app);
  await casa.evaluate(() => self.SN_STORAGE.updateSettings({ theme: 'dark' }));
  const riga = casa.locator('.dash-cambio').last();
  await expect(riga.locator('.dash-cambio-testo')).toContainText('dalla home', { timeout: 10_000 });
  await riga.hover();
  await riga.locator('.dash-cambio-annulla', { hasText: 'annulla' }).click();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).theme)).not.toBe('dark');
  await expect(riga).toHaveClass(/dash-cambi-annullato/);
});

// Lo zoom vero di una scheda, come lo tiene Chromium.
async function zoomDi(app, page) {
  const url = await page.evaluate(() => location.href);
  return app.evaluate(({ webContents }, u) => {
    for (const wc of webContents.getAllWebContents()) {
      let qui = '';
      try { qui = wc.getURL(); } catch (_) {}
      if (qui === u) return Math.round(wc.getZoomFactor() * 100);
    }
    return null;
  }, url);
}
const cambiDelRegistro = (app) => app.evaluate(async () => globalThis.SN_REGISTRO_CAMBI.lista());

test('#1490 — lo zoom ritoccato a più riprese è una riga sola, da com’era a com’è, e da lì torna com’era', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, '<!doctype html><html><head><meta charset="utf-8"><title>jazz</title></head><body><h1>jazz</h1><p>musica</p></body></html>');
  await page.locator('h1').click();
  for (let i = 0; i < 2; i++) await page.keyboard.press('Control+Equal');
  await expect.poll(async () => (await cambiDelRegistro(app)).filter((e) => e.tipo === 'zoom').length).toBe(1);
  // Il ripensamento qualche secondo dopo: prima era una riga sua.
  await page.waitForTimeout(5_000);
  await page.keyboard.press('Control+Minus');
  await expect.poll(async () => {
    const z = await zoomDi(app, page);
    const ev = (await cambiDelRegistro(app)).filter((e) => e.tipo === 'zoom');
    return ev.length === 1 && ev[0].cambi[0].dopo === z ? ev[0].cambi[0].prima : `${ev.length} eventi, zoom ${z}`;
  }, { timeout: 8_000 }).toBe(100);
  const z = await zoomDi(app, page);
  expect(z).toBeGreaterThan(100);

  const casa = await openTab('filo://newtab/');
  const righe = casa.locator('.dash-cambio', { hasText: 'zoom di' });
  await expect(righe).toHaveCount(1);
  await expect(righe.locator('.dash-cambio-testo')).toHaveText(new RegExp(`^zoom di .+: 100% → ${z}% · con un gesto sulla pagina$`));
  await righe.hover();
  await righe.locator('.dash-cambio-annulla', { hasText: 'annulla' }).click();
  await expect.poll(() => zoomDi(app, page)).toBe(100);
  await expect(righe).toHaveClass(/dash-cambi-annullato/);
});

test('#1490 — con la home aperta il ritocco riscrive la riga che c’è già, le righe sottili stanno strette, e tornato a com’era la riga se ne va', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const zoom = (prima, dopo) => app.evaluate(async (_e, d) => {
    const R = globalThis.SN_REGISTRO_CAMBI;
    R.con({ via: 'interfaccia', dove: 'zoom' }, () => R.registraZoom({ host: 'youtube.com', ...d }));
    await R.attesa();
  }, { prima, dopo });
  await semina(app, { pagine: [{ url: 'https://www.youtube.com/watch?v=j', titolo: 'jazz music - YouTube', ts: new Date(Date.now() - 120_000).toISOString() }] });
  // Il primo ritocco è di mezzo minuto fa: oltre i passi di un cursore trascinato, dentro i ritocchi di chi cerca il valore.
  await app.evaluate(async () => {
    const E = globalThis.SN_FILO_EVENTI;
    const primo = {
      id: 'c00zoom0001', ts: new Date(Date.now() - 30_000).toISOString(), tipo: 'zoom', via: 'interfaccia', dove: 'zoom',
      cambi: [{ chiave: 'zoom:youtube.com', prima: 125, dopo: 114 }],
    };
    await globalThis.SN_IL_FILO.transazione((t) => t.scrivi([E.eventoCambio(primo, { dispositivo: t.dispositivo })]));
  });
  const casa = await openTab('filo://newtab/');
  const righe = casa.locator('.dash-cambio', { hasText: 'zoom di youtube.com' });
  await expect(righe).toHaveCount(1);
  await expect(righe).toContainText('125% → 114%');
  await zoom(114, 87);
  await zoom(87, 100);
  await expect(righe).toContainText('zoom di youtube.com: 125% → 100% · con un gesto sulla pagina');
  await expect(righe).toHaveCount(1);

  const sopra = await casa.locator('.dash-pagine').last().boundingBox();
  const sotto = await righe.boundingBox();
  expect(sotto.y - (sopra.y + sopra.height)).toBeLessThanOrEqual(3);
  await casa.screenshot({ path: `${SHOTS}/home-coda-zoom-ritoccato.png` });

  await casa.reload();
  await expect(righe).toHaveCount(1);
  await expect(righe).toContainText('125% → 100%');
  await zoom(100, 125);
  await expect(righe).toHaveCount(0);
});

test('il saluto di oggi non si fonde col messaggio spontaneo di ieri: quello resta sotto «ieri», il saluto sta sotto «oggi»', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await app.evaluate(async (_e, ts) => {
    const E = globalThis.SN_FILO_EVENTI;
    const qui = await globalThis.SN_IL_FILO.dispositivo();
    const msg = { role: 'filo', text: 'Il timer della pasta è suonato.', spontaneo: true, motivi: [{ tipo: 'timer', testo: 'timer «pasta»' }] };
    const ev = [E.crea(E.TIPI.CHAT_APERTA, { chat: 'ieri' }, { ts, dispositivo: qui }), E.crea(E.TIPI.MESSAGGIO, { chat: 'ieri', msg }, { ts, dispositivo: qui, autore: 'filo' })];
    await globalThis.SN_IL_FILO.importa(ev.map(E.riga).join(''));
  }, alle(1, 20));
  await home(app);
  await modelli(app);
  await app.evaluate(() => globalThis.SN_FILO_PARLA.giro({ subito: [{ tipo: 'giornata' }] }));
  const page = await openTab('filo://newtab/');
  const saluto = page.locator('.dash-bubble-filo[data-spontaneo="1"]').last();
  await expect(saluto).toHaveText('Buongiorno.');
  await expect(saluto).not.toHaveClass(/dash-vecchio/);
  await expect(page.locator('.dash-bubble-filo.dash-vecchio', { hasText: 'Il timer della pasta è suonato.' })).toHaveCount(1);
});

test('una pagina tolta dal filo, o cancellata dalla Sicurezza, non torna dalla ricerca attraverso le schede chiuse', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const tolta = 'https://www.youtube.com/watch?v=orche';
  const cancellata = 'https://www.youtube.com/watch?v=delfini';
  // Visite di poco fa e cancellazione dell'ultima ora: un'ora del giorno fissa, o «oggi», cambiano esito dopo mezzanotte (#1599).
  await semina(app, { pagine: [{ url: tolta, titolo: 'YouTube: orche', ts: new Date(Date.now() - 1_200_000).toISOString() }, { url: cancellata, titolo: 'YouTube: delfini', ts: new Date(Date.now() - 600_000).toISOString() }] });
  await app.evaluate(async (_e, urls) => {
    for (const [url, title, closedAt, openedAt] of urls) await globalThis.SN_ARCHIVED_TABS.archive({ url, title, closedAt: closedAt || new Date().toISOString(), openedAt });
  }, [[tolta, 'YouTube: orche'], [cancellata, 'YouTube: delfini'], ['https://esempio.it/ieri', 'ieri', alle(1, 12), alle(1, 11)]]);
  const page = await openTab('filo://newtab/');
  const riga = page.locator('.dash-pagine').first();
  await riga.locator('.dash-pagine-testa').click();
  const orche = riga.locator('.dash-pagina', { hasText: 'YouTube: orche' });
  await orche.click({ button: 'right' });
  await menuDi(page).locator('.sn-menu').getByText('Togli dal filo', { exact: true }).click();
  await expect(orche).toHaveCount(0);
  const cerca = page.locator('#cercaInput');
  await cerca.fill('orche');
  await expect(page.locator('#cercaRisultati .dash-cerca-niente')).toBeVisible();
  const r = await page.evaluate(async () => self.chrome.runtime.sendMessage({ type: self.SN_MSG.MSG.FILO_PAGINE_CANCELLA, periodo: 'ultima_ora' }));
  expect(r.ok).toBe(true);
  await cerca.fill('');
  await cerca.fill('delfini');
  await expect(page.locator('#cercaRisultati .dash-cerca-niente')).toBeVisible();
  // Le schede chiuse di ieri restano: la cancellazione tocca solo il suo periodo.
  expect(await app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).map((t) => t.title))).toEqual(['ieri']);
});

test('il timer che suona ore dopo il saluto, con pagine visitate in mezzo, è un messaggio nuovo in fondo al filo', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  // Saluto e pagine sempre fra la mezzanotte e adesso: alle 00:03 un saluto «alle 00:05» sarebbe dopo il timer.
  const adesso = Date.now();
  const inizio = new Date(Math.min(mezzanotte(adesso) + 5 * 60_000, (mezzanotte(adesso) + adesso) / 2));
  const passo = (adesso - inizio.getTime()) / 5;
  await app.evaluate(async (_e, d) => {
    const E = globalThis.SN_FILO_EVENTI;
    const qui = await globalThis.SN_IL_FILO.dispositivo();
    const msg = { role: 'filo', text: 'Buongiorno.', spontaneo: true, motivi: [{ tipo: 'giornata' }] };
    const ev = [E.crea(E.TIPI.CHAT_APERTA, { chat: 'mattina' }, { ts: d.saluto, dispositivo: qui }), E.crea(E.TIPI.MESSAGGIO, { chat: 'mattina', msg }, { ts: d.saluto, dispositivo: qui, autore: 'filo' })];
    for (const p of d.pagine) ev.push(E.crea(E.TIPI.NAVIGAZIONE, { url: p.url, titolo: p.titolo }, { ts: p.ts, dispositivo: qui }));
    await globalThis.SN_IL_FILO.importa(ev.map(E.riga).join(''));
  }, {
    saluto: inizio.toISOString(),
    pagine: [1, 2, 3].map((k) => ({ url: `https://esempio.it/${k}`, titolo: `pagina ${k}`, ts: new Date(inizio.getTime() + k * passo).toISOString() })),
  });
  const casa = await home(app);
  await modelli(app);
  await app.evaluate(() => globalThis.SN_FILO_PARLA.giro({ subito: [{ tipo: 'timer', testo: 'timer «pasta»' }] }));
  const spontanei = casa.locator('.dash-bubble-filo[data-spontaneo="1"]');
  await expect(spontanei.last()).toHaveText('Il timer della pasta è suonato.');
  const page = await openTab('filo://newtab/');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Buongiorno.' })).toHaveText('Buongiorno.');
  const inFondo = await page.evaluate(() => {
    const figli = [...document.querySelectorAll('#bubbles > *')];
    const t = figli.findIndex((n) => n.classList.contains('dash-bubble') && /pasta/.test(n.textContent || ''));
    const p = figli.findIndex((n) => n.classList.contains('dash-pagine'));
    return p >= 0 && t > p;
  });
  expect(inFondo).toBe(true);
});

test('una pagina tolta dal filo mentre la sua scheda è aperta non torna nella ricerca quando la scheda si chiude', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const url = testServer.html('<title>orche marine</title><p>le orche</p>');
  const p = await openTab(url);
  await p.waitForFunction(() => document.title === 'orche marine');
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_IL_FILO.pagine()).length)).toBeGreaterThan(0);
  const page = await openTab('filo://newtab/');
  const riga = page.locator('.dash-pagine').last();
  await riga.locator('.dash-pagine-testa').click();
  const orche = riga.locator('.dash-pagina', { hasText: 'orche marine' });
  await orche.click({ button: 'right' });
  await menuDi(page).locator('.sn-menu').getByText('Togli dal filo', { exact: true }).click();
  await expect(orche).toHaveCount(0);
  await shell.evaluate(async (u) => {
    const s = await window.filoShell.tabs.snapshot();
    await window.filoShell.tabs.close(s.tabs.find((x) => x.url === u).id);
  }, url);
  await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    await window.filoShell.tabs.activate(s.tabs.filter((x) => String(x.url).startsWith('filo://newtab')).pop().id);
  });
  // Una pagina aperta dopo, sullo stesso sito, entra nelle schede chiuse come sempre.
  const dopo = testServer.html('<title>delfini</title>');
  const pd = await openTab(dopo);
  await pd.waitForFunction(() => document.title === 'delfini');
  await shell.evaluate(async (u) => {
    const s = await window.filoShell.tabs.snapshot();
    await window.filoShell.tabs.close(s.tabs.find((x) => x.url === u).id);
  }, dopo);
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).map((t) => t.title))).toEqual(['delfini']);
  await page.locator('#cercaInput').fill('orche');
  await expect(page.locator('#cercaRisultati .dash-cerca-niente')).toBeVisible();
});

test('dalla ricerca una pagina si toglie dal filo col tasto destro: tutte le sue visite e le schede chiuse', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const url = 'https://www.youtube.com/watch?v=orche';
  // Le due visite stanno nella stessa giornata anche subito dopo mezzanotte: un giorno in mezzo le metterebbe in due righe.
  await semina(app, { pagine: [{ url, titolo: 'YouTube: orche', ts: oggiFa(0.25, 1000) }, { url, titolo: 'YouTube: orche', ts: oggiFa(1 / 6, 2000) }] });
  await app.evaluate((_e, u) => globalThis.SN_ARCHIVED_TABS.archive({ url: u, title: 'YouTube: orche', closedAt: new Date().toISOString() }), url);
  const page = await openTab('filo://newtab/');
  await expect(page.locator('.dash-pagine-testo').last()).toHaveText('2 pagine, fra cui YouTube: orche');
  await page.locator('#cercaInput').fill('orche');
  const voce = page.locator('#cercaRisultati .dash-cerca-pagina', { hasText: 'YouTube: orche' });
  await expect(voce).toHaveCount(1);
  await voce.click({ button: 'right' });
  await menuDi(page).locator('.sn-menu').getByText('Togli dal filo', { exact: true }).click();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_IL_FILO.pagine()).length)).toBe(0);
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).length)).toBe(0);
  await expect(page.locator('.dash-pagine')).toHaveCount(0);
  await page.locator('#cercaInput').fill('');
  await page.locator('#cercaInput').fill('orche');
  await expect(page.locator('#cercaRisultati .dash-cerca-niente')).toBeVisible();
});

// Le pagine aperte in schede vere, una dopo l'altra; tornare alla home la fa rileggere come quando torna in vista.
async function visita(openTab, testServer, nome) {
  const url = testServer.html(`<title>${nome}</title><p>${nome}</p>`);
  const p = await openTab(url);
  await p.waitForFunction((n) => document.title === n, nome);
  return url;
}
async function tornaAllaHome(shell, page) {
  await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    const t = s.tabs.filter((x) => String(x.url).startsWith('filo://newtab')).pop();
    await window.filoShell.tabs.activate(t.id);
  });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}
const righePagine = (page) => page.locator('.dash-pagine .dash-pagine-testo');

test('tolta la prima pagina del gruppo in corso, la riga resta una sola, aperta, e prende le pagine che vengono dopo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await home(app);
  for (const n of ['alfa orche', 'beta', 'gamma']) await visita(openTab, testServer, n);
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_IL_FILO.pagine()).length)).toBe(3);
  const page = await openTab('filo://newtab/');
  const riga = page.locator('.dash-pagine').last();
  await riga.locator('.dash-pagine-testa').click();
  const alfa = riga.locator('.dash-pagina', { hasText: 'alfa orche' });
  await alfa.click({ button: 'right' });
  await menuDi(page).locator('.sn-menu').getByText('Togli dal filo', { exact: true }).click();
  await expect(righePagine(page)).toHaveText(['2 pagine, fra cui gamma']);
  await expect(page.locator('.dash-pagine')).toHaveClass(/dash-pagine-aperte/);
  await visita(openTab, testServer, 'delta');
  await tornaAllaHome(shell, page);
  await expect(righePagine(page)).toHaveText(['3 pagine, fra cui delta']);
  // Dalla ricerca, la prima del gruppo: stessa cosa.
  await page.locator('#cercaInput').fill('beta');
  await page.locator('#cercaRisultati .dash-cerca-pagina', { hasText: 'beta' }).click({ button: 'right' });
  await menuDi(page).locator('.sn-menu').getByText('Togli dal filo', { exact: true }).click();
  await expect(righePagine(page)).toHaveText(['2 pagine, fra cui delta']);
  await visita(openTab, testServer, 'epsilon');
  await tornaAllaHome(shell, page);
  await expect(righePagine(page)).toHaveText(['3 pagine, fra cui epsilon']);
});

test('pagine cancellate dalla Sicurezza escono subito dalla home già aperta', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await home(app);
  for (const n of ['alfa', 'beta']) await visita(openTab, testServer, n);
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_IL_FILO.pagine()).length)).toBe(2);
  const page = await openTab('filo://newtab/');
  await expect(righePagine(page)).toHaveText(['2 pagine, fra cui beta']);
  const sic = await openTab('filo://security/security.html');
  const r = await sic.evaluate(async () => self.chrome.runtime.sendMessage({ type: self.SN_MSG.MSG.FILO_PAGINE_CANCELLA, periodo: 'oggi' }));
  expect(r.ok).toBe(true);
  await expect(page.locator('.dash-pagine')).toHaveCount(0);
});

test('una scheda chiusa eliminata dall’archivio esce dal filo: niente riga nella home, niente ricerca', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await home(app);
  const delfini = await visita(openTab, testServer, 'delfini');
  const url = testServer.html('<title>orche marine</title><p>le orche</p>');
  const p = await openTab(url);
  await p.waitForFunction(() => document.title === 'orche marine');
  await shell.evaluate(async (u) => {
    const s = await window.filoShell.tabs.snapshot();
    await window.filoShell.tabs.close(s.tabs.find((x) => x.url === u).id);
  }, url);
  await expect.poll(() => app.evaluate(async (_e, u) => (await globalThis.SN_ARCHIVED_TABS.list()).filter((t) => t.url === u).length, url)).toBe(1);
  const page = await openTab('filo://newtab/');
  await expect(righePagine(page)).toHaveText(['2 pagine, fra cui orche marine']);
  const cron = await openTab('filo://quaderno/quaderno.html');
  const r = await cron.evaluate(async (u) => {
    const { MSG } = self.SN_MSG;
    const { tabs } = await self.chrome.runtime.sendMessage({ type: MSG.GET_ARCHIVED_TABS });
    return self.chrome.runtime.sendMessage({ type: MSG.REMOVE_ARCHIVED_TAB, id: tabs.find((x) => x.url === u).id });
  }, url);
  expect(r.ok).toBe(true);
  // La home già aperta lo vede subito; la pagina visitata in un'altra scheda resta.
  await expect(righePagine(page)).toHaveText(['1 pagina: delfini']);
  await page.locator('#cercaInput').fill('orche');
  await expect(page.locator('#cercaRisultati .dash-cerca-niente')).toBeVisible();
  // «Svuota archivio»: anche le visite delle altre schede chiuse.
  await shell.evaluate(async (u) => {
    const s = await window.filoShell.tabs.snapshot();
    await window.filoShell.tabs.close(s.tabs.find((x) => x.url === u).id);
  }, delfini);
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).length)).toBe(1);
  await cron.evaluate(async () => self.chrome.runtime.sendMessage({ type: self.SN_MSG.MSG.CLEAR_ARCHIVED_TABS }));
  await expect(page.locator('.dash-pagine')).toHaveCount(0);
});

test('senza un modello la frase dice perché e la strada porta ai Crediti', async ({ app }) => {
  const casa = await home(app);
  await expect(casa.locator('#homeMessage')).toContainText('codice d\'invito');
  await expect(casa.locator('#homeMessage')).toBeVisible();
});

test('con migliaia di eventi la home si apre senza attesa visibile', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await app.evaluate(async () => {
    const E = globalThis.SN_FILO_EVENTI;
    const qui = await globalThis.SN_IL_FILO.dispositivo();
    const ev = [];
    const ora = Date.now();
    for (let i = 0; i < 2500; i++) {
      const t = ora - (2500 - i) * 3600000;
      ev.push(E.crea(E.TIPI.MESSAGGIO, { chat: `c${Math.floor(i / 3)}`, msg: { role: i % 2 ? 'filo' : 'user', text: `messaggio ${i}` } }, { ts: new Date(t).toISOString(), dispositivo: qui }));
    }
    for (let i = 0; i < 15000; i++) ev.push(E.crea(E.TIPI.NAVIGAZIONE, { url: `https://s${i % 40}.it/${i}`, titolo: `Pagina ${i}` }, { ts: new Date(ora - (15000 - i) * 600000).toISOString(), dispositivo: qui }));
    await globalThis.SN_IL_FILO.importa(ev.map(E.riga).join(''));
  });
  const t0 = Date.now();
  const page = await openTab('filo://newtab/');
  await expect(page.locator('#bubbles .dash-bubble').last()).toHaveText('messaggio 2499', { timeout: 10_000 });
  const dt = Date.now() - t0;
  expect(dt).toBeLessThan(2500);
  const elementi = await page.locator('#bubbles > *').count();
  expect(elementi).toBeLessThan(400);
});

for (const tema of ['light', 'dark']) {
  test(`la coda del filo nel tema ${tema === 'light' ? 'chiaro' : 'scuro'}`, async ({ app, openTab }) => {
    test.setTimeout(60_000);
    await app.evaluate(async (_e, t) => { await globalThis.SN_STORAGE.updateSettings({ theme: t }); }, tema);
    await semina(app, {
      chats: [
        { id: 'a', messaggi: [{ role: 'user', text: 'quanto costa rifare 40 metri di grondaia?', ts: alle(2, 9) }, { role: 'filo', text: 'Fra 1.400 e 2.600 euro secondo il materiale.', ts: alle(2, 9, 1) }] },
        { id: 'b', messaggi: [{ role: 'user', text: 'trova un idraulico aperto sabato', ts: alle(1, 18) }, { role: 'filo', text: 'Due aperti sabato mattina: Rossi & figli e Idro24.', ts: alle(1, 18, 5) }] },
        { id: 'c', messaggi: [{ role: 'user', text: 'che treni ci sono domani per Bologna?', ts: alle(0, 0, 5) }, { role: 'filo', text: 'Il primo utile è il Frecciarossa delle 7:10.', ts: alle(0, 0, 6) }] },
      ],
      pagine: [
        { url: 'https://idraulici-milano.it/', titolo: 'Idraulici Milano', ts: alle(1, 18, 2) },
        { url: 'https://www.youtube.com/watch?v=o', titolo: 'YouTube: orche', ts: alle(1, 18, 3) },
      ],
    });
    const page = await openTab('filo://newtab/');
    await expect(page.locator('.dash-giorno', { hasText: 'oggi' })).toBeVisible();
    await page.locator('.dash-pagine-testa').first().click();
    await page.screenshot({ path: `${SHOTS}/home-coda-${tema}.png` });
  });
}


// #1525 — un indirizzo tagliato alla misura porterebbe altrove: dalla home si apre il suo sito, detto come tale.
test('una pagina con l’indirizzo tagliato alla misura si apre dal suo sito, non da un indirizzo a metà', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await home(app);
  const base = testServer.html('<title>Lunga</title><p>lunga</p>');
  const origine = new URL(base).origin;
  await app.evaluate(async (_e, u) => {
    await globalThis.SN_IL_FILO.registraVisita({ url: u, titolo: 'Pagina lunghissima' });
  }, `${base}?q=${'x'.repeat(10_000)}`);
  const page = await openTab('filo://newtab/');
  const riga = page.locator('.dash-pagine').last();
  await riga.locator('.dash-pagine-testa').click();
  const pagina = riga.locator('.dash-pagina', { hasText: 'Pagina lunghissima' });
  await expect(pagina).toHaveAttribute('href', `${origine}/`);
  await pagina.click({ button: 'right' });
  const menu = menuDi(page).locator('.sn-menu');
  await expect(menu.getByText('Apri il sito', { exact: true })).toBeVisible();
  await expect(menu.getByText('Riapri la pagina', { exact: true })).toHaveCount(0);
  await menu.getByText('Apri il sito', { exact: true }).click();
  const schede = async () => (await shell.evaluate(() => window.filoShell.tabs.snapshot())).tabs.map((t) => String(t.url));
  await expect.poll(async () => (await schede()).some((u) => u.replace(/^https?:\/\//, '').replace(/\/$/, '') === new URL(origine).host)).toBe(true);
  expect((await schede()).some((u) => u.includes('xxxx'))).toBe(false);
});
