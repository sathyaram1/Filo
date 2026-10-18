// #869 — Il centro della home è la coda del filo: lo scambio di prima in fondo anche in una scheda nuova, i segni dei
// giorni e i giorni prima sbiaditi, «risali» a pezzi senza salti, nessuna chiamata al modello aprendo schede, Filo che
// scrive quando suona un timer (e un secondo evento nello stesso messaggio), le pagine visitate ripiegate che si riaprono
// e si tolgono anche dal disco, la ricerca nel filo senza la chat, le azioni fatte dall'interfaccia come righe sottili.

import { test, expect } from './fixtures/electron.mjs';
import { home, modelloFinto, chiedi } from './helpers/chatFinta.mjs';
import { readFileSync, mkdirSync } from 'node:fs';

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
  const chats = await app.evaluate(async () => (await globalThis.SN_IL_FILO.chats()).filter((c) => !c.app).map((c) => c.messages.map((m) => m.text)));
  expect(chats).toEqual([['come cacciano le orche?', 'Le orche cacciano in branco.', 'e le balene?', 'Sì, anche le balene.']]);
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
  await balene.click();
  await expect.poll(async () => (await schede()).filter((u) => u === urls[1]).length).toBe(quante + 1);

  await page.bringToFront();
  await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    const t = s.tabs.filter((x) => String(x.url).startsWith('filo://newtab')).pop();
    await window.filoShell.tabs.activate(t.id);
  });
  const visita = await balene.getAttribute('data-id');
  await balene.click({ button: 'right' });
  await page.locator('.sn-menu').getByText('Togli dal filo', { exact: true }).click();
  await expect(balene).toHaveCount(0);
  await expect(riga.locator('.dash-pagine-testo')).toHaveText('2 pagine, fra cui delfini');
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

