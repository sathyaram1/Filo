// #1561 — il filo è la sola fonte di quello che è successo: la stessa azione fatta dalla chat e dall'interfaccia lascia
// lo stesso evento, un cambio d'impostazione si annulla ancora con un clic (anche quelli del registro di prima), una
// scheda aperta e chiusa compare nel filo. Ogni prova guarda il filo vero, su disco.

import { test as base, expect, chiudiApp, argomentiScala } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';
import { barraPage, comandaBarra, pannelloFermo, statoBarra } from './helpers/barra.mjs';
import { createServer } from 'node:http';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// `semeDisco`: lo storage.json con cui parte l'app, come lo lascia una versione di prima.
const test = base.extend({
  semeDisco: [null, { option: true }],
  app: async ({ semeDisco }, use) => {
    const userData = cartellaTemporanea('filo-test-');
    if (semeDisco) writeFileSync(join(userData, 'storage.json'), JSON.stringify(semeDisco));
    const app = await electron.launch({
      args: [...argomentiScala, '.'],
      cwd: APP_ROOT,
      env: { ...process.env, FILO_USER_DATA: userData, FILO_TEST_ACCOLTO: '1', NODE_ENV: 'test' },
    });
    await use(app);
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  },
});

async function trovaPagina(app, prova, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const p = app.windows().find((w) => { try { return prova(w.url()); } catch (_) { return false; } });
    if (p) { await p.waitForLoadState('domcontentloaded'); return p; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('pagina non trovata');
}
const homeDi = (app) => trovaPagina(app, (u) => u.startsWith('filo://newtab') && !u.includes('incognito'));
const impostazioni = (app) => app.evaluate(async () => globalThis.SN_STORAGE.getSettings());
const registro = (app) => app.evaluate(async () => globalThis.SN_REGISTRO_CAMBI.lista());
const accaduti = (app, tipi) => app.evaluate(async (_e, t) => {
  await globalThis.SN_IL_FILO.quandoFermo();
  return globalThis.SN_IL_FILO.accaduti({ tipi: t });
}, tipi);
const righeDelFilo = async (app) => {
  const file = await app.evaluate(async () => {
    await globalThis.SN_REGISTRO_CAMBI.attesa();
    await globalThis.SN_IL_FILO.quandoFermo();
    return globalThis.SN_IL_FILO.percorso();
  });
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((r) => JSON.parse(r)) : [];
};
const storageGrezzo = (app) => app.evaluate(async () => globalThis.chrome.storage.local.get(null));

async function configura(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      theme: 'light',
    });
  });
}

async function modelloFinto(app, giri) {
  await app.evaluate(async (_e, g) => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__finto_restore = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta, onToolCall }) => {
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text && onDelta) onDelta(giro.text);
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  }, giri);
}
const ripristina = (app) => app.evaluate(() => { try { globalThis.__finto_restore?.(); } catch (_) {} });

async function scrivi(page, testo, risposta) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: risposta })).toBeVisible({ timeout: 10_000 });
}

// Quello che di un cambio non dipende da chi l'ha chiesto né da quando.
const sostanza = (e) => ({ tipo: e.tipo, cambi: e.cambi });

test('il tema messo dalla chat e dalle Preferenze lascia lo stesso cambio nel filo; dalla chat anche l\'azione, con parametri ed esito', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await configura(app);

  const page = await homeDi(app);
  await modelloFinto(app, [
    // Dopo un'impostazione cambiata Filo chiude il turno: la risposta arriva insieme all'azione.
    { text: 'Fatto.', toolCalls: [{ id: 't1', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"tema","valore":"scuro"}' }] },
  ]);
  await scrivi(page, 'tema scuro', 'Fatto.');
  await expect.poll(async () => (await impostazioni(app)).theme).toBe('dark');
  const daChat = (await registro(app)).filter((e) => e.via === 'chat' && e.cambi.some((c) => c.chiave === 'theme')).pop();
  expect(daChat).toMatchObject({ cambi: [{ chiave: 'theme', prima: 'light', dopo: 'dark' }] });

  // Rimesso il chiaro senza passare da una pagina, la stessa cosa dalle Preferenze.
  await app.evaluate(async () => globalThis.SN_STORAGE.updateSettings({ theme: 'light' }));
  const pref = await openTab('filo://preferences/preferences.html');
  await expect(pref.locator('#theme')).toHaveValue('light');
  await pref.locator('#theme').selectOption('dark');
  await expect.poll(async () => (await impostazioni(app)).theme).toBe('dark');
  const daPagina = (await registro(app)).filter((e) => e.via === 'interfaccia' && e.cambi.some((c) => c.chiave === 'theme')).pop();
  expect(daPagina).toMatchObject({ dove: 'preferences' });
  expect(sostanza(daPagina)).toEqual(sostanza(daChat));

  // Il cambio sta nel filo su disco, con chi l'ha fatto; storage.json non ha più un registro suo.
  const righe = await righeDelFilo(app);
  const nelFilo = (id) => righe.filter((r) => r.tipo === 'cambio' && r.cambio === id);
  expect(nelFilo(daPagina.id)[0]).toMatchObject({ autore: 'utente', via: 'interfaccia', ambito: 'impostazioni' });
  expect(nelFilo(daChat.id)[0]).toMatchObject({ autore: 'filo', via: 'chat', ambito: 'impostazioni' });
  expect('filo_cambi' in await storageGrezzo(app)).toBe(false);

  // Dalla chat resta anche l'azione: cosa è stato chiesto, com'è andata e quale cambio ha fatto.
  await expect.poll(async () => (await accaduti(app, ['azione'])).length).toBe(1);
  const [azione] = await accaduti(app, ['azione']);
  expect(azione).toMatchObject({ nome: 'IMPOSTA_PREFERENZA', parametri: { chiave: 'tema', valore: 'scuro' }, autore: 'filo', via: 'chat' });
  expect(azione.esito.eseguita).toBe(true);
  expect(azione.esito.cambi).toContain(daChat.id);
  expect(typeof azione.chat).toBe('string');
  await ripristina(app);
});

test('un cambio fatto dalle Preferenze si annulla ancora con un clic dalla home, e l\'annullo resta nel filo', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await configura(app);
  const pref = await openTab('filo://preferences/preferences.html');
  await pref.locator('#theme').selectOption('dark');
  await expect.poll(async () => (await impostazioni(app)).theme).toBe('dark');

  const casa = await openTab('filo://newtab/');
  const riga = casa.locator('.dash-cambio', { hasText: 'tema: chiaro → scuro' });
  await expect(riga).toHaveCount(1);
  await riga.hover();
  await riga.locator('.dash-cambio-annulla', { hasText: 'annulla' }).click();
  await expect.poll(async () => (await impostazioni(app)).theme).toBe('light');
  await expect(riga).toHaveClass(/dash-cambi-annullato/);
  await casa.screenshot({ path: 'tests/.shots/filo-accaduti-annullo-dalla-home.png' });

  const lista = await registro(app);
  const cambio = lista.find((e) => e.cambi.some((c) => c.chiave === 'theme' && c.dopo === 'dark'));
  const annullo = lista.find((e) => e.annulla === cambio.id);
  expect(annullo.cambi[0]).toMatchObject({ chiave: 'theme', prima: 'dark', dopo: 'light' });
  expect((await righeDelFilo(app)).some((r) => r.tipo === 'cambio' && r.cambio === annullo.id && r.annulla === cambio.id)).toBe(true);
});

test.describe('un file di dati di prima, col registro dei cambi in storage.json', () => {
  const poco = (min) => new Date(Date.now() - min * 60_000).toISOString();
  test.use({
    semeDisco: {
      settings: { theme: 'dark' },
      filo_onboarding: { done: true },
      filo_cambi: [{ id: 'c0vecchio01', ts: poco(20), tipo: 'impostazioni', via: 'interfaccia', dove: 'preferences', cambi: [{ chiave: 'theme', prima: 'light', dopo: 'dark' }] }],
    },
  });
  test('il cambio di prima si vede nella home e si annulla con un clic; il registro vecchio lascia storage.json', async ({ app, openTab }) => {
    test.setTimeout(60_000);
    const casa = await openTab('filo://newtab/');
    const riga = casa.locator('.dash-cambio', { hasText: 'tema: chiaro → scuro' });
    await expect(riga).toHaveCount(1);
    await riga.hover();
    await riga.locator('.dash-cambio-annulla', { hasText: 'annulla' }).click();
    await expect.poll(async () => (await impostazioni(app)).theme).toBe('light');
    expect('filo_cambi' in await storageGrezzo(app)).toBe(false);
    const righe = await righeDelFilo(app);
    expect(righe.filter((r) => r.tipo === 'cambio').map((r) => r.annulla || r.cambio)).toEqual(['c0vecchio01', 'c0vecchio01']);
  });
});

test('una scheda aperta e chiusa compare nel filo: aperta, la sua pagina, chiusa; chi torna davanti anche', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const prima = (await accaduti(app, ['scheda.aperta', 'scheda.chiusa', 'scheda.davanti'])).length;
  const page = await testServer.openReady(openTab, '<!doctype html><title>Orche</title><body><h1>Orche</h1></body>');
  const url = page.url();
  const scheda = await shell.evaluate(async (u) => (await window.filoShell.tabs.snapshot()).tabs.find((t) => t.url === u).id, url);
  await shell.evaluate((id) => window.filoShell.tabs.close(id), scheda);
  await expect(shell.locator('.tab')).toHaveCount(1);

  await expect.poll(async () => (await accaduti(app, ['scheda.chiusa'])).some((e) => e.scheda === scheda)).toBe(true);
  const schede = (await accaduti(app, ['scheda.aperta', 'scheda.chiusa', 'scheda.davanti'])).slice(prima);
  const sue = schede.filter((e) => e.scheda === scheda).map((e) => e.tipo);
  expect(sue[0]).toBe('scheda.aperta');
  expect(sue[sue.length - 1]).toBe('scheda.chiusa');
  expect(sue.filter((t) => t === 'scheda.aperta')).toHaveLength(1);
  expect(sue.filter((t) => t === 'scheda.chiusa')).toHaveLength(1);
  // Chiusa quella davanti, la home torna davanti.
  const dopoChiusa = schede.slice(schede.findIndex((e) => e.tipo === 'scheda.chiusa' && e.scheda === scheda) + 1);
  expect(dopoChiusa.some((e) => e.tipo === 'scheda.davanti' && e.scheda !== scheda)).toBe(true);
  // La pagina sta nella visita con la stessa scheda: le schede non ripetono gli indirizzi, che si cancellano con lei.
  const pagine = await app.evaluate(async () => globalThis.SN_IL_FILO.pagine());
  expect(pagine.some((p) => p.url === url && p.scheda === scheda)).toBe(true);
  const righe = await righeDelFilo(app);
  expect(righe.filter((r) => r.scheda === scheda && r.tipo.startsWith('scheda.')).every((r) => !('url' in r))).toBe(true);
});

test('rete caduta, un avviso, un timer che suona, un download e un documento scritto entrano nel filo, una volta ciascuno', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const { createServer } = await import('node:http');
  const PDF = Buffer.from('%PDF-1.4\n% finto\n' + 'x'.repeat(2048));
  // Un nome nuovo a ogni corsa: nella cartella dei download uno già presente prenderebbe «(2)».
  const NOME = `bolletta-${Date.now()}.pdf`;
  const srv = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': PDF.length, 'Content-Disposition': `attachment; filename="${NOME}"` });
    res.end(PDF);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    // Il computer: una lettura col Wi-Fi, poi senza rete. Una seconda lettura uguale non è un evento nuovo.
    const PIENO = { batteria: { livello: 42, inCarica: false, collegata: false }, rete: { online: true, tipo: 'wifi', nome: 'Casa' }, bluetooth: { acceso: true, dispositivi: [] } };
    await app.evaluate(async (_e, l) => {
      globalThis.__sistemaFinto = l;
      await globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(async () => globalThis.__sistemaFinto);
    }, PIENO);
    await app.evaluate(async () => {
      globalThis.__sistemaFinto = { ...globalThis.__sistemaFinto, rete: { online: false } };
      await globalThis.SN_SISTEMA_MAIN._perProve.leggiOra();
      await globalThis.SN_SISTEMA_MAIN._perProve.leggiOra();
    });
    await expect.poll(async () => (await accaduti(app, ['sistema'])).map((e) => [e.cosa, e.online])).toEqual([['rete', false]]);

    // Un avviso di Filo e un timer da un secondo.
    await app.evaluate(async () => {
      await globalThis.SN_FILO_MEMORY.addNotification({ kind: 'info', text: 'Aggiornamento pronto' });
      await globalThis.SN_FILO_MEMORY.addTimer({ label: 'pasta', seconds: 1 });
    });
    await expect.poll(async () => (await accaduti(app, ['notifica'])).map((e) => e.testo)).toEqual(['Aggiornamento pronto']);
    await expect.poll(async () => (await accaduti(app, ['timer.scattato'])).map((e) => e.nome), { timeout: 15_000 }).toEqual(['pasta']);

    // Un download: l'inizio e la fine.
    const page = await testServer.openReady(openTab, `<!doctype html><title>Bolletta</title><body><a id="pdf" href="http://127.0.0.1:${srv.address().port}/${NOME}">scarica</a></body>`);
    await page.locator('#pdf').click();
    await expect.poll(async () => (await accaduti(app, ['download'])).map((e) => [e.file, e.stato]), { timeout: 20_000 })
      .toEqual([[NOME, 'iniziato'], [NOME, 'finito']]);

    // Il documento dell'editor: scritto, una volta per la sessione di scrittura.
    const ed = await openTab('filo://editor/editor.html');
    await ed.waitForSelector('#doc');
    await ed.click('#doc');
    await ed.keyboard.type('Lista della spesa');
    await ed.keyboard.press('Control+s');
    await expect(ed.locator('.ed-save-state')).toHaveText('Salvato');
    await ed.keyboard.type(', pane');
    await ed.keyboard.press('Control+s');
    await expect(ed.locator('.ed-save-state')).toHaveText('Salvato');
    await expect.poll(async () => (await accaduti(app, ['file'])).filter((e) => e.azione === 'scritto').length).toBe(1);
    const [scritto] = (await accaduti(app, ['file'])).filter((e) => e.azione === 'scritto');
    expect(scritto).toMatchObject({ autore: 'utente', via: 'interfaccia' });

    // Tornare a un documento solo per leggerlo, anche subito, è un'apertura.
    await ed.click('#docSwitch');
    await ed.locator('.ed-doc-new').first().click();
    await ed.click('#doc');
    await ed.keyboard.type('Ricette');
    await ed.keyboard.press('Control+s');
    await expect(ed.locator('.ed-save-state')).toHaveText('Salvato');
    await ed.click('#docSwitch');
    const lista = ed.locator('.ed-doc-item:not(.active)').first();
    const spesa = await lista.getAttribute('data-id');
    const aperture = async () => (await accaduti(app, ['file'])).filter((e) => e.azione === 'aperto' && e.file === spesa).length;
    const primaDelRitorno = await aperture();
    await lista.click();
    await expect(ed.locator('#doc')).toContainText('Lista della spesa');
    await expect.poll(aperture).toBe(primaDelRitorno + 1);
    // Leggerla non la scrive.
    expect((await accaduti(app, ['file'])).filter((e) => e.azione === 'scritto' && e.file === spesa)).toHaveLength(1);

    // Il timer che continua a suonare non scatta di nuovo nel filo.
    await new Promise((r) => setTimeout(r, 6_000));
    expect((await accaduti(app, ['timer.scattato'])).length).toBe(1);
  } finally {
    try { srv.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => srv.close(r));
  }
});

test('la ricerca sul web e il comando della barra che l\'Aiuto fa da sé lasciano l\'azione nel filo, come dalla chat', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const azioni = async (nome) => (await accaduti(app, ['azione'])).filter((e) => e.nome === nome);
  await app.evaluate(async () => {
    globalThis.__cercaVera = globalThis.SN_WEB_SEARCH.search;
    globalThis.SN_WEB_SEARCH.search = async () => ({ provider: 'finto', results: [{ title: 'Gotta', url: 'https://esempio.test/', content: '…' }] });
  });
  try {
    await app.evaluate(async () => {
      await globalThis.SN_EXECUTE_FILO_ACTION({ type: 'CERCA_WEB', query: 'orari della piscina' }, { chatId: 'c-piscina' });
    });
    await expect.poll(async () => (await azioni('CERCA_WEB')).length).toBe(1);
    // Il pannello dell'Aiuto chiede la ricerca e i comandi della barra per strade sue, non da executeFiloAction.
    const page = await openTab('filo://options/options.html');
    await page.waitForFunction(() => !!window.SN_MSG, null, { timeout: 10_000 });
    await page.evaluate(() => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.WEB_SEARCH, query: 'sintomi della gotta' }));
    await expect.poll(async () => (await azioni('CERCA_WEB')).length).toBe(2);
    const [chat, aiuto] = await azioni('CERCA_WEB');
    expect(chat).toMatchObject({ via: 'chat', esito: { eseguita: true } });
    expect(aiuto).toMatchObject({ via: 'assistente', autore: 'filo', parametri: { query: 'sintomi della gotta' }, esito: { eseguita: true } });
    expect(aiuto.chat).toBeUndefined();

    await page.evaluate(() => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.SHELL_ACTION, command: 'account', assistente: true }));
    await expect.poll(async () => (await azioni('COMANDO_BARRA')).map((e) => [e.parametri.comando, e.esito.eseguita, e.via])).toEqual([['account', true, 'assistente']]);

    // Le icone della home passano dalla stessa porta per un clic dell'utente: non sono azioni di Filo.
    const casa = await homeDi(app);
    await casa.locator('.dash-ctrl[data-command="settings"]').click();
    await casa.keyboard.press('Escape');
    await casa.locator('.dash-ctrl[data-command="account"]').click();
    await new Promise((r) => setTimeout(r, 1000));
    expect((await azioni('COMANDO_BARRA')).map((e) => [e.parametri.comando, e.via])).toEqual([['account', 'assistente']]);
    // Il riordino chiesto da un tasto della home passa dalla porta dell'Aiuto: resta un gesto dell'utente.
    await casa.evaluate(() => chrome.runtime.sendMessage({ type: self.SN_MSG.MSG.FILO_RUN_ACTION, action: { type: 'PULISCI_TAB' }, interfaccia: true }));
    await expect.poll(async () => (await azioni('PULISCI_TAB')).map((e) => [e.via, e.autore])).toEqual([['interfaccia', 'utente']]);
  } finally {
    await app.evaluate(() => { globalThis.SN_WEB_SEARCH.search = globalThis.__cercaVera; }).catch(() => {});
  }
});

test('il volume chiesto alla chat e quello dato coi tasti della home lasciano la stessa azione nel filo, una per strada', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const azioniVolume = async () => (await accaduti(app, ['azione'])).filter((e) => e.nome === 'VOLUME');
  await app.evaluate(async () => {
    await globalThis.SN_EXECUTE_FILO_ACTION({ type: 'VOLUME', livello: 30 }, { chatId: 'c-volume' });
  });
  await expect.poll(async () => (await azioniVolume()).length).toBe(1);

  const casa = await openTab('filo://newtab/');
  await casa.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: 'sistema_comanda', richiesta: { cosa: 'volume', livello: 30 } }, r)));
  await expect.poll(async () => (await azioniVolume()).length).toBe(2);
  const [chat, home] = await azioniVolume();
  const sostanzaAzione = (e) => ({ nome: e.nome, parametri: e.parametri, esito: e.esito });
  expect(sostanzaAzione(home)).toEqual(sostanzaAzione(chat));
  expect(chat).toMatchObject({ via: 'chat', autore: 'filo', chat: 'c-volume', parametri: { livello: 30 } });
  expect(home).toMatchObject({ via: 'interfaccia', autore: 'utente' });
  expect(home.chat).toBeUndefined();
});

// I tasti che vanno dritti al punto che fa la cosa, senza la porta delle azioni: lasciano la stessa azione della chat.
test('«Installa» sulla carta, un sito tolto dal Quaderno e un\'icona spostata lasciano l\'azione nel filo, come chiesti alla chat', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const azioni = async (nome) => (await accaduti(app, ['azione'])).filter((e) => e.nome === nome);
  const manda = (pagina, msg) => pagina.evaluate((m) => new Promise((r) => chrome.runtime.sendMessage(m, r)), msg);
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.addKeepOpen('web.whatsapp.com');
    await globalThis.SN_FILO_MEMORY.addKeepOpen('mail.example.com');
    const icona = globalThis.SN_DISPOSIZIONE_ICONE.DEFAULT.bar[0];
    await globalThis.SN_EXECUTE_FILO_ACTION({ type: 'INSTALLA_AGGIORNAMENTO' }, { chatId: 'c-tasti' });
    await globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NON_TENERE_APERTA', sito: 'web.whatsapp.com', confirmed: true }, { chatId: 'c-tasti' });
    await globalThis.SN_EXECUTE_FILO_ACTION({ type: 'SPOSTA_ICONA', icona, dove: 'altro', confirmed: true }, { chatId: 'c-tasti' });
  });
  for (const nome of ['INSTALLA_AGGIORNAMENTO', 'NON_TENERE_APERTA', 'SPOSTA_ICONA']) {
    await expect.poll(async () => (await azioni(nome)).map((e) => e.via), { message: nome }).toEqual(['chat']);
  }

  const casa = await openTab('filo://newtab/');
  await manda(casa, { type: 'filo_installa_aggiornamento' });
  const quaderno = await openTab('filo://quaderno/quaderno.html');
  expect((await manda(quaderno, { type: 'filo_memory_forget', sempreAperta: 'mail.example.com' })).ok).toBe(true);
  // L'icona trascinata col mouse sulla freccia di «Altro…» della barra laterale, dove le icone si spostano (#1246).
  const icona = await app.evaluate(() => globalThis.SN_DISPOSIZIONE_ICONE.DEFAULT.bar[1]);
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  const b = await barra.locator(`#nav .ico[data-id="${icona}"]`).boundingBox();
  const cassetto = await barra.locator('#nav [data-altro]').boundingBox();
  await barra.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await barra.mouse.down();
  await barra.mouse.move(b.x + b.width / 2 + 2, b.y + b.height / 2 - 6, { steps: 3 });
  await barra.mouse.move(b.x + b.width / 2, cassetto.y + cassetto.height - 3, { steps: 8 });
  await barra.mouse.up();
  await expect.poll(async () => (await statoBarra(app)).secondary).toContain(icona);
  for (const nome of ['INSTALLA_AGGIORNAMENTO', 'NON_TENERE_APERTA', 'SPOSTA_ICONA']) {
    await expect.poll(async () => (await azioni(nome)).map((e) => e.via), { message: nome }).toEqual(['chat', 'interfaccia']);
  }
  const [, dalQuaderno] = await azioni('NON_TENERE_APERTA');
  expect(dalQuaderno).toMatchObject({ autore: 'utente', parametri: { sito: 'mail.example.com' }, esito: { eseguita: true } });
  expect(dalQuaderno.chat).toBeUndefined();
  const [, dallaCarta] = await azioni('INSTALLA_AGGIORNAMENTO');
  expect(dallaCarta.esito.eseguita).toBe(false);
  expect(dallaCarta.esito.errore).toBeTruthy();
});

test('gli avvisi nella cornice della finestra e quelli brevi nelle pagine entrano nel filo, una volta per avviso', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await openTab('filo://newtab/');
  await openTab('filo://quaderno/quaderno.html');
  const testi = async () => (await accaduti(app, ['notifica'])).map((e) => [e.testo, e.genere]);
  await app.evaluate(async () => {
    const rq = process.mainModule.require;
    const A = rq(rq('node:path').join(process.cwd(), 'src/main/services/avvisoFinestra.js'));
    A.avvisoNellaFinestra('Le pagine salvate per dopo sono al massimo 500.', { chiave: 'prova-cornice' });
    rq(rq('node:path').join(process.cwd(), 'src/main/services/handlers.js'))
      .broadcastToTabs({ type: globalThis.SN_MSG.MSG.SHOW_TOAST, text: 'Feedback inviato, ma non sono riuscito a caricare: foto', duration: 6000 });
  });
  await expect(shell.locator('.shell-notif-msg', { hasText: 'Le pagine salvate per dopo' })).toHaveCount(1);
  await expect.poll(testi).toEqual(expect.arrayContaining([
    ['Le pagine salvate per dopo sono al massimo 500.', 'finestra'],
    ['Feedback inviato, ma non sono riuscito a caricare: foto', 'pagina'],
  ]));
  expect((await testi()).filter(([t]) => t.startsWith('Feedback inviato'))).toHaveLength(1);
});

// Il punto che fa la cosa la segna per tutte le strade: la pagina degli scaricamenti, «Annulla» del nome, il menu della
// scheda e la proposta sulla pagina bloccata lasciano la stessa azione della chat.
test('aprire e rinominare uno scaricamento dalla sua pagina e instradare una scheda lasciano l\'azione nel filo, una per gesto', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const azioni = async (nome) => (await accaduti(app, ['azione'])).filter((e) => e.nome === nome);
  const manda = (pagina, msg) => pagina.evaluate((m) => new Promise((r) => chrome.runtime.sendMessage(m, r)), msg);
  const PDF = Buffer.from('%PDF-1.4\n% finto\n' + 'x'.repeat(2048));
  const NOME = `scan_${Date.now()}.pdf`;
  const srv = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': PDF.length, 'Content-Disposition': `attachment; filename="${NOME}"` });
    res.end(PDF);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><title>Bolletta</title><body><a id="pdf" href="http://127.0.0.1:${srv.address().port}/${NOME}">scarica</a></body>`);
    await page.locator('#pdf').click();
    await expect.poll(async () => (await accaduti(app, ['download'])).map((e) => e.stato), { timeout: 20_000 }).toContain('finito');
    const [{ scaricamento }] = await accaduti(app, ['download']);

    const dl = await openTab('filo://downloads/downloads.html');
    await dl.waitForFunction(() => !!window.SN_MSG, null, { timeout: 10_000 });
    expect((await manda(dl, { type: 'download_open_file', id: scaricamento })).ok).toBe(true);
    const nome = await manda(dl, { type: 'file_rinomina', downloadId: scaricamento, nome: 'Bolletta luce ottobre' });
    expect(nome.ok).toBe(true);
    expect((await manda(dl, { type: 'file_rimetti_nomi', coppie: [{ attuale: nome.a, prima: NOME }] })).ok).toBe(true);

    await expect.poll(async () => (await azioni('APRI_FILE')).map((e) => [e.parametri.file, e.esito.eseguita, e.via])).toEqual([[NOME, true, 'interfaccia']]);
    await expect.poll(async () => (await azioni('RINOMINA_FILE')).map((e) => [e.parametri.file, e.parametri.nome, e.esito.eseguita, e.autore]))
      .toEqual([[NOME, 'Bolletta luce ottobre.pdf', true, 'utente'], ['Bolletta luce ottobre.pdf', NOME, true, 'utente']]);

    // Il menu della scheda e la proposta sulla pagina bloccata: senza un fornitore non si instrada, e l'azione lo dice.
    const id = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w._filoTabs).find(Boolean).activeId);
    await shell.evaluate((i) => window.filoShell.tabs.setProxy(i, 'fr'), id);
    await app.evaluate(({ BrowserWindow }, i) => BrowserWindow.getAllWindows().map((w) => w._filoTabs).find(Boolean).geoProposeAccept(i, 'us'), id);
    await expect.poll(async () => (await azioni('PROXY_TAB')).map((e) => [e.parametri.country, e.esito.eseguita, e.esito.errore]))
      .toEqual([['fr', false, 'not_configured'], ['us', false, 'not_configured']]);
    expect((await azioni('PROXY_TAB'))[0]).toMatchObject({ via: 'interfaccia', autore: 'utente' });
  } finally {
    try { srv.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => srv.close(r));
  }
});

test('cancellate le pagine di oggi o di un sito, se ne vanno anche gli avvisi che ne nominano lo scaricamento o il sito', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const PDF = Buffer.from('%PDF-1.4\n% finto\n' + 'x'.repeat(2048));
  const NOME = `referto-clinica-${Date.now()}.pdf`;
  const srv = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': PDF.length, 'Content-Disposition': `attachment; filename="${NOME}"` });
    res.end(PDF);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const avvisi = async (parola) => (await accaduti(app, ['notifica'])).filter((e) => String(e.testo).includes(parola));
  try {
    // «Sito bloccato» nasce dal suo sito: se ne va con le pagine di quel sito, gli altri avvisi restano.
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w._filoTabs).find(Boolean)
      ._notifyBlocked({ host: 'casino-esempio.com', target: 'https://casino-esempio.com/premio', reason: 'lists' }));
    await expect.poll(async () => (await avvisi('Sito bloccato')).map((e) => e.url)).toEqual(['https://casino-esempio.com/premio']);
    await app.evaluate(() => globalThis.SN_IL_FILO.cancellaPagine({ da: null, a: null, sito: 'casino-esempio.com' }));
    await expect.poll(async () => (await avvisi('Sito bloccato')).length).toBe(0);

    const page = await testServer.openReady(openTab, `<!doctype html><title>Referto</title><body><a id="pdf" href="http://127.0.0.1:${srv.address().port}/${NOME}">scarica</a></body>`);
    await page.locator('#pdf').click();
    await expect.poll(async () => (await avvisi('referto-clinica')).length, { timeout: 20_000, message: 'l\'avviso di fine scaricamento entra nel filo' }).toBe(1);
    // «Cancella oggi» dalla Sicurezza.
    const sic = await openTab('filo://security/security.html');
    await sic.waitForLoadState('domcontentloaded');
    expect((await sic.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: 'filo_pagine_cancella', periodo: 'oggi' }, r)))).ok).toBe(true);
    await expect.poll(async () => (await accaduti(app, ['download'])).length).toBe(0);
    expect(await avvisi('referto-clinica'), 'dal filo non resta il nome del file scaricato oggi').toEqual([]);
    expect(readFileSync(await app.evaluate(async () => { await globalThis.SN_IL_FILO.quandoFermo(); return globalThis.SN_IL_FILO.percorso(); }), 'utf8'))
      .not.toContain('referto-clinica');
  } finally {
    try { srv.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => srv.close(r));
  }
});

// Un'azione su un file scaricato porta il sito da cui è arrivato, chiunque la faccia: se ne va con le pagine di quel sito.
test('cancellate le pagine del sito da cui viene uno scaricamento, se ne vanno anche l\'apertura e i nomi dati al file, dai tasti e dalla chat', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const PDF = Buffer.from('%PDF-1.4\n% finto\n' + 'x'.repeat(2048));
  const NOME = `referto-clinica-${Date.now()}.pdf`;
  const srv = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': PDF.length, 'Content-Disposition': `attachment; filename="${NOME}"` });
    res.end(PDF);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const manda = (pagina, msg) => pagina.evaluate((m) => new Promise((r) => chrome.runtime.sendMessage(m, r)), msg);
  const sulFile = async () => (await accaduti(app, ['azione'])).filter((e) => /APRI_FILE|RINOMINA_FILE/.test(e.nome));
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><title>Referto</title><body><a id="pdf" href="http://127.0.0.1:${srv.address().port}/${NOME}">scarica</a></body>`);
    await page.locator('#pdf').click();
    await expect.poll(async () => (await accaduti(app, ['download'])).map((e) => e.stato), { timeout: 20_000 }).toContain('finito');
    const [{ scaricamento, url }] = await accaduti(app, ['download']);

    const dl = await openTab('filo://downloads/downloads.html');
    await dl.waitForFunction(() => !!window.SN_MSG, null, { timeout: 10_000 });
    expect((await manda(dl, { type: 'download_open_file', id: scaricamento })).ok).toBe(true);
    const nome = await manda(dl, { type: 'file_rinomina', downloadId: scaricamento, nome: 'referto clinica ortopedica' });
    expect(nome.ok).toBe(true);
    // Chiesto alla chat, col percorso di adesso: il file cambia nome e l'azione sa da dove era arrivato.
    await app.evaluate(async (_e, p) => {
      await globalThis.SN_EXECUTE_FILO_ACTION({ type: 'RINOMINA_FILE', percorsi: [p], nome: 'referto clinica ginocchio' }, { chatId: 'c-referto', confirmed: true });
    }, nome.a);
    await expect.poll(async () => (await sulFile()).length).toBe(3);
    expect((await sulFile()).map((e) => e.url), 'ogni azione sul file porta il sito da cui è arrivato').toEqual([url, url, url]);

    await app.evaluate(() => globalThis.SN_IL_FILO.cancellaPagine({ da: null, a: null, sito: '127.0.0.1' }));
    await expect.poll(async () => (await accaduti(app, ['download'])).length).toBe(0);
    expect((await accaduti(app)).filter((e) => JSON.stringify(e).includes('referto')).map((e) => [e.tipo, e.nome || e.testo]),
      'nel filo non resta niente che nomini il file di quel sito').toEqual([]);
    expect(readFileSync(await app.evaluate(async () => { await globalThis.SN_IL_FILO.quandoFermo(); return globalThis.SN_IL_FILO.percorso(); }), 'utf8'))
      .not.toContain('referto');
  } finally {
    try { srv.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => srv.close(r));
  }
});

// Quello che l'Aiuto fa dentro una conversazione porta la sua chat, come la chat della home: se ne va con lei.
test('tolta dalla Cronologia la conversazione dell\'Aiuto, se ne vanno anche le ricerche e le azioni che l\'Aiuto ci ha fatto', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const manda = (pagina, msg) => pagina.evaluate((m) => new Promise((r) => chrome.runtime.sendMessage(m, r)), msg);
  const della = async (parola) => (await accaduti(app)).filter((e) => JSON.stringify(e).includes(parola));
  await app.evaluate(async () => {
    globalThis.__cercaVera = globalThis.SN_WEB_SEARCH.search;
    // Come la ricerca vera: lascia la sua ricerca nel filo, poi i risultati.
    globalThis.SN_WEB_SEARCH.search = async ({ query }) => {
      await globalThis.SN_ACCADUTI.ricerca({ testo: query, motore: 'finto', risultati: 1 });
      return { provider: 'finto', results: [{ title: 'Gotta', url: 'https://esempio.test/', content: '…' }] };
    };
  });
  try {
    const page = await openTab('filo://options/options.html');
    await page.waitForFunction(() => !!window.SN_MSG, null, { timeout: 10_000 });
    const conv = await manda(page, {
      type: 'filo_conversazione_app', app: 'aiuto', rif: 'pannello-1', soggetto: 'medicina.it', dove: 'https://medicina.it/gotta',
      messaggi: [{ role: 'user', text: 'cerca sintomi della gotta' }, { role: 'filo', text: 'Ecco cosa ho trovato.' }],
    });
    expect(conv.ok, JSON.stringify(conv)).toBe(true);
    await manda(page, { type: 'web_search', query: 'sintomi della gotta' });
    await manda(page, { type: 'shell_action', command: 'account', assistente: true });
    await expect.poll(async () => (await della('gotta')).map((e) => [e.tipo, e.chat])).toEqual([['ricerca', conv.id], ['azione', conv.id]]);
    expect((await accaduti(app, ['azione'])).filter((e) => e.nome === 'COMANDO_BARRA').map((e) => e.chat)).toEqual([conv.id]);
    // Un'altra conversazione dell'Aiuto nella stessa scheda: quello che arriva dopo è suo, non di quella di prima.
    await manda(page, { type: 'filo_aiuto_nuovo' });
    await manda(page, { type: 'web_search', query: 'orari della piscina' });
    await expect.poll(async () => (await della('piscina')).map((e) => e.chat)).toEqual([undefined, undefined]);

    expect((await manda(page, { type: 'filo_chat_delete', id: conv.id })).ok).toBe(true);
    await expect.poll(async () => (await della('gotta')).length).toBe(0);
    expect((await accaduti(app, ['azione'])).filter((e) => e.nome === 'COMANDO_BARRA')).toEqual([]);
    expect((await della('piscina')).length, 'quello che non era della conversazione tolta resta').toBe(2);
    expect(readFileSync(await app.evaluate(async () => { await globalThis.SN_IL_FILO.quandoFermo(); return globalThis.SN_IL_FILO.percorso(); }), 'utf8'))
      .not.toContain('gotta');
  } finally {
    await app.evaluate(() => { globalThis.SN_WEB_SEARCH.search = globalThis.__cercaVera; }).catch(() => {});
  }
});

test('ogni avviso che la cornice mostra entra nel filo, anche quelli che non passano dall\'avviso della finestra e quelli della cornice stessa', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const testi = async () => (await accaduti(app, ['notifica'])).filter((e) => e.genere === 'finestra').map((e) => e.testo);
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().map((w) => w._filoTabs).find(Boolean);
    tm._showTriageToast('Schede riordinate, 2 chiuse. Le ritrovi nel filo della home');
    tm._geoToast('Aperto da Stati Uniti');
  });
  await shell.evaluate(() => window.filoNotify('Link copiato'));
  await expect(shell.locator('.shell-notif-msg', { hasText: 'Link copiato' })).toHaveCount(1);
  await expect.poll(testi).toEqual(expect.arrayContaining([expect.stringContaining('Schede riordinate'), 'Aperto da Stati Uniti', 'Link copiato']));
  // Rinnovato con lo stesso testo resta un avviso solo.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w._filoTabs).find(Boolean)._geoToast('Aperto da Stati Uniti'));
  await new Promise((r) => setTimeout(r, 800));
  expect((await testi()).filter((t) => t === 'Aperto da Stati Uniti')).toHaveLength(1);
});

test('una scheda rimessa alla riapertura di Filo resta la stessa nel filo: chiusa, si sa quale pagina era', async () => {
  test.setTimeout(150_000);
  const userData = cartellaTemporanea('filo-test-');
  const srv = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<!doctype html><title>Ricetta lasagne</title><h1>lasagne</h1>'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/lasagne`;
  const lancia = () => electron.launch({
    args: [...argomentiScala, '.'], cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, FILO_TEST_ACCOLTO: '1', NODE_ENV: 'test' },
  });
  const idDi = (app) => app.evaluate(({ BrowserWindow }, u) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const t = w._filoTabs && w._filoTabs.tabs.find((x) => String(x.url || '').startsWith(u));
      if (t) return t.id;
    }
    return null;
  }, url);
  let app;
  try {
    app = await lancia();
    let shell = await primaFinestra(app);
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    await expect.poll(() => app.evaluate(async () => (await globalThis.SN_IL_FILO.pagine()).length)).toBe(1);
    const prima = await idDi(app);
    await new Promise((r) => setTimeout(r, 1000));
    await chiudiApp(app);

    app = await lancia();
    shell = await primaFinestra(app);
    await expect.poll(() => idDi(app), { timeout: 20_000 }).toBe(prima);
    await shell.evaluate((i) => window.filoShell.tabs.close(i), prima);
    await expect.poll(async () => (await accaduti(app, ['scheda.chiusa'])).map((e) => e.scheda)).toContain(prima);
    const [visita] = await app.evaluate(async () => globalThis.SN_IL_FILO.pagine());
    expect(visita).toMatchObject({ url, scheda: prima });
  } finally {
    if (app) await chiudiApp(app);
    try { srv.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => srv.close(r));
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
