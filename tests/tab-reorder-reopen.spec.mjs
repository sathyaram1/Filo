// Riordino/ripristino delle schede alla riapertura di Filo (feedback #266).
//
// Due garanzie che il feedback "le tab non sono chiuse/riordinate come
// dovrebbero" richiede:
//   1) il riordino cromatico della barra avviene a OGNI giro di triage
//      (riapertura compresa), NON solo quando qualcosa viene archiviato;
//   2) la sessione salva e ripristina il colore identità di ogni scheda, così
//      la barra riparte già tinta e il riordino ha i dati subito.
// #349: alla riapertura vera il modello sa da quanto ogni scheda non si usa, le vecchie si archiviano, e un avviso
// dice sempre com'è andata, anche quando il giudizio non arriva.

import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/electron.mjs';

const SHOTS = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'tests', '.shots');

const mk = (title, color) =>
  `<!doctype html><html><head><title>${title}</title>`
  + `${color ? `<meta name="theme-color" content="${color}">` : ''}</head>`
  + `<body style="margin:0"><div style="height:1200px;background:#fff"></div></body></html>`;

// La regola d'ordine della barra, dal modulo condiviso: l'ordine atteso si calcola dai colori REALI assegnati.
createRequire(import.meta.url)('../src/shared/tabColor.js');
const TC = globalThis.SN_TAB_COLOR;
const tinta = (c) => { const p = TC.parseRgb(c); return p ? TC.rgbToHsl(...p)[0] * 360 : NaN; };

test('alla riapertura le schede vengono riordinate per colore anche senza archiviare nulla', async ({ app, shell, openTab, testServer }) => {
  // Aperte in ordine NON cromatico (blu → verde → rosso): dopo il riordino
  // devono finire per tinta (rosso → verde → blu).
  await testServer.openReady(openTab, mk('Blu', 'rgb(40,80,200)'));
  await testServer.openReady(openTab, mk('Verde', 'rgb(40,200,80)'));
  await testServer.openReady(openTab, mk('Rosso', 'rgb(200,40,40)')); // ultima → attiva

  // Attendi che ognuna abbia il SUO colore dal content script: le tre pagine stanno sullo stesso host, e il
  // colore identità si ricorda per host, quindi appena aperta una scheda porta quello della sorella.
  const dichiarato = { Blu: 'rgb(40,80,200)', Verde: 'rgb(40,200,80)', Rosso: 'rgb(200,40,40)' };
  await expect.poll(async () => {
    const web = await shell.evaluate(async () => {
      const s = await window.filoShell.tabs.snapshot();
      return s.tabs.filter((t) => /127\.0\.0\.1/.test(t.url || ''))
        .map((t) => ({ title: t.title, identityColor: t.identityColor }));
    });
    return web.length === 3 && web.every((t) => dichiarato[t.title]
      && Math.abs(tinta(t.identityColor) - tinta(dichiarato[t.title])) < 2);
  }, { timeout: 12_000 }).toBe(true);

  // Ordine di inserimento e ordine cromatico atteso, dai colori REALI assegnati.
  const before = await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    return s.tabs.filter((t) => /127\.0\.0\.1/.test(t.url || ''))
      .map((t) => ({ title: t.title, identityColor: t.identityColor }));
  });
  const insertionOrder = before.map((t) => t.title);
  const expectedOrder = [...before]
    .sort((a, b) => TC.compareRainbow(a.identityColor, b.identityColor))
    .map((t) => t.title);
  // Sanity: lo scenario è non-banale (l'ordine cromatico differisce da quello
  // d'inserimento), altrimenti il test passerebbe anche senza riordino.
  expect(expectedOrder).not.toEqual(insertionOrder);

  // Stub LLM: TIENI tutto → nessuna archiviazione. Prima del fix, con 0 archivi
  // il riordino non partiva affatto.
  const res = await app.evaluate(async ({ BrowserWindow }) => {
    globalThis.SN_TAB_TRIAGE_DECIDE = async ({ tabs }) => ({
      decisions: tabs.map((t, i) => ({ i, action: 'keep', reason: 'test' })),
    });
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    return win._filoTabs.runAutoTriage({ trigger: 'reopen' });
  });
  expect(res.archived).toBe(0);

  // La barra è stata riordinata per colore pur non avendo archiviato nulla.
  const after = await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    return s.tabs.filter((t) => /127\.0\.0\.1/.test(t.url || '')).map((t) => t.title);
  });
  expect(after).toEqual(expectedOrder);
  // E lo dice (#349): senza avviso «ho guardato e tenuto tutto» e «non sono partito» erano uguali.
  await expect.poll(() => avvisi(shell), { timeout: 6_000 }).toContain('Schede riordinate, nessuna da chiudere');
});

// Gli avvisi a schermo: altri possono stare accanto (la chiave salvata senza portachiavi, nelle prove).
const avvisi = (shell) => shell.evaluate(() => [...document.querySelectorAll('.shell-notif.show .shell-notif-msg')]
  .map((el) => el.textContent));

// Un modello finto che fa quello che chiede il prompt della riapertura: archivia le schede non toccate da ore.
// Registra il prompt, così si vede cosa Filo gli ha detto delle schede riaperte.
async function modelloCheArchiviaLeVecchie(app, risposta = null) {
  await app.evaluate(async ({}, risposta) => {
    const T = globalThis.SN_TEST_MODELS;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'test-key', tavily: '' },
      models: { ...T.models },
      modelRegistry: { ...T.registry },
      autoArchive: { enabled: true, onClose: true, onIdle: false, idleHours: 6 },
    });
    globalThis.__promptRiordino = [];
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => ({ vectors: texts.map(() => [0.5, 0.2, 0.9, 0.1]) });
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const sistema = String((messages[0] && messages[0].content) || '');
      const utente = messages.slice(1).map((m) => String(m.content || '')).join('\n');
      const fine = (text) => ({ text, provider: attempts[0].provider, model: attempts[0].model, usage: {} });
      if (/METADATI/.test(sistema + utente)) return fine('{"suspicious":false,"reason":null,"confidence":"low"}');
      if (!/gestore delle schede/.test(sistema)) return fine('ok');
      globalThis.__promptRiordino.push({ sistema, utente });
      if (risposta != null) return fine(risposta);
      const decisions = [];
      for (const riga of utente.split('\n')) {
        const m = /^#(\d+)\s/.exec(riga);
        if (!m) continue;
        const inattiva = /inattiva da (\d+)min/.exec(riga);
        decisions.push({ i: Number(m[1]), action: inattiva && Number(inattiva[1]) >= 600 ? 'archive' : 'keep', reason: 'test' });
      }
      return fine(JSON.stringify({ decisions }));
    };
  }, risposta);
}

const pagina = (titolo, colore, testo) => `<!doctype html><html><head><title>${titolo}</title>`
  + `<meta name="theme-color" content="${colore}"></head><body><h1>${titolo}</h1><p>${testo}</p></body></html>`;

test.describe('la riapertura vera', () => {
  // Un sito per scheda: il colore identità si ricorda per sito, e quattro pagine dello stesso host ne avrebbero uno.
  test.use({ hostInPiu: ['blu.test', 'vecchia.test', 'verde.test', 'rosso.test'] });

  test('riaprendo Filo la scheda lasciata da giorni va nel filo della home, le altre si riordinano, e l’avviso lo dice (#349)', async ({ app, shell, testServer }) => {
    await modelloCheArchiviaLeVecchie(app);
    const su = (host, html) => testServer.html(html).replace('127.0.0.1', host);
    const schede = [
      { titolo: 'Blu', url: su('blu.test', pagina('Blu', 'rgb(40,80,200)', 'Il documento su cui lavoro')), colore: 'rgb(40, 80, 200)', usata: 2 },
      { titolo: 'Vecchia', url: su('vecchia.test', pagina('Vecchia', 'rgb(230,200,40)', 'Le notizie di tre giorni fa')), colore: 'rgb(230, 200, 40)', usata: 3 * 24 * 60 },
      { titolo: 'Verde', url: su('verde.test', pagina('Verde', 'rgb(40,200,80)', 'Una chat aperta')), colore: 'rgb(40, 200, 80)', usata: 5 },
      // Senza colore salvato: il riordino deve aspettare quello che dice la pagina.
      { titolo: 'Rosso', url: su('rosso.test', pagina('Rosso', 'rgb(200,40,40)', 'Una pagina di lavoro')), colore: null, usata: 8 },
    ];
    const ora = Date.now();
    await app.evaluate(async ({ BrowserWindow }, { schede, ora }) => {
      const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
      await globalThis.SN_STORAGE.setRaw(tm._sessionKey(), {
        tabs: schede.map((s) => s.url),
        colors: schede.map((s) => s.colore),
        aperte: schede.map(() => new Date(ora - 4 * 24 * 3600 * 1000).toISOString()),
        usate: schede.map((s) => new Date(ora - s.usata * 60 * 1000).toISOString()),
        activeIndex: 0,
      });
      await tm.restoreSession();
    }, { schede, ora });

    await expect.poll(() => avvisi(shell), { timeout: 40_000 }).toContain('Schede riordinate, 1 chiusa. La ritrovi nel filo della home');

    // Il modello ha saputo che è una riapertura e da quanto ogni scheda non si usa: senza, ogni scheda riaperta
    // risultava «inattiva da 0min» (il primo segnale della pagina contava come uso) e la teneva.
    const [chiesto] = await app.evaluate(() => globalThis.__promptRiordino);
    expect(chiesto.sistema).toContain('RIAPERTURA');
    const riga = (titolo) => chiesto.utente.split('\n').find((r) => r.includes(`"${titolo}"`)) || '';
    const inattiva = (titolo) => Number((/inattiva da (\d+)min/.exec(riga(titolo)) || [])[1]);
    expect(inattiva('Vecchia')).toBeGreaterThanOrEqual(3 * 24 * 60 - 2);
    // Riaperta, la pagina riparte dall'inizio: «scroll 0%» direbbe «letta a metà», che non si sa.
    expect(riga('Vecchia')).not.toMatch(/scroll \d+%/);
    expect(inattiva('Verde')).toBeLessThan(60);
    expect(inattiva('Rosso')).toBeLessThan(60);

    const dopo = await shell.evaluate(async () => {
      const s = await window.filoShell.tabs.snapshot();
      return s.tabs.filter((t) => /\.test:/.test(t.url || '')).map((t) => ({ title: t.title, identityColor: t.identityColor }));
    });
    expect(dopo.map((t) => t.title)).not.toContain('Vecchia');
    const archiviate = await app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).map((x) => x.title));
    expect(archiviate).toContain('Vecchia');
    // Ordinate per tinta coi colori veri, quello di Rosso compreso; lo scenario non è già in ordine.
    expect(dopo.find((t) => t.title === 'Rosso').identityColor).toBeTruthy();
    const atteso = [...dopo].sort((a, b) => TC.compareRainbow(a.identityColor, b.identityColor)).map((t) => t.title);
    expect(atteso).toEqual(['Rosso', 'Verde', 'Blu']);
    expect(dopo.map((t) => t.title)).toEqual(atteso);

    const vista = app.windows().find((w) => { try { return w.url().startsWith('filo://shell/avvisi.html'); } catch (_) { return false; } });
    mkdirSync(SHOTS, { recursive: true });
    await (vista || shell).screenshot({ path: join(SHOTS, 'riordino-riapertura-avviso.png') });
  });

  test('una risposta del modello che non si legge riordina lo stesso e lo dice, invece di sembrare un «tieni tutto» (#349)', async ({ app, shell, testServer }) => {
    await modelloCheArchiviaLeVecchie(app, 'Non saprei proprio.');
    const su = (host, html) => testServer.html(html).replace('127.0.0.1', host);
    await app.evaluate(async ({ BrowserWindow }, urls) => {
      const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
      await globalThis.SN_STORAGE.setRaw(tm._sessionKey(), { tabs: urls, colors: ['rgb(40, 80, 200)', 'rgb(200, 40, 40)'], activeIndex: 0 });
      await tm.restoreSession();
    }, [su('blu.test', pagina('Blu', 'rgb(40,80,200)', 'uno')), su('rosso.test', pagina('Rosso', 'rgb(200,40,40)', 'due'))]);

    // Il giudizio mancato di un giro automatico lo dice l'avviso della pulizia non riuscita (#1618), uno solo.
    await expect.poll(async () => (await avvisi(shell)).filter((t) => t.startsWith('La pulizia automatica non è riuscita a valutare le schede')).length, { timeout: 40_000 }).toBe(1);
    expect((await avvisi(shell)).some((t) => t.startsWith('Schede riordinate'))).toBe(false);
    const titoli = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs
      .filter((t) => /\.test:/.test(t.url || '')).map((t) => t.title));
    expect(titoli).toEqual(['Rosso', 'Blu']);
  });

  test('una scheda spostata a mano mentre la riapertura finisce resta dove l’ha messa l’utente (#349)', async ({ app, shell, testServer }) => {
    const su = (host, html) => testServer.html(html).replace('127.0.0.1', host);
    const nome = { blu: 'Blu', verde: 'Verde', rosso: 'Rosso' };
    const barra = async () => (await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs
      .map((t) => ({ id: t.id, url: t.url || '' }))))
      .filter((t) => /\.test:/.test(t.url)).map((t) => ({ id: t.id, nome: nome[new URL(t.url).hostname.split('.')[0]] }));
    await app.evaluate(async ({ BrowserWindow }, urls) => {
      await globalThis.SN_STORAGE.updateSettings({ autoArchive: { enabled: true, onClose: true, onIdle: false, idleHours: 6 } });
      // Il modello tiene tutto, col tempo di una risposta vera.
      globalThis.SN_TAB_TRIAGE_DECIDE = async ({ tabs }) => {
        await new Promise((r) => setTimeout(r, 1500));
        return { decisions: tabs.map((_, i) => ({ i, action: 'keep', reason: 'test' })) };
      };
      const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
      await globalThis.SN_STORAGE.setRaw(tm._sessionKey(), { tabs: urls, colors: ['rgb(40, 80, 200)', 'rgb(40, 200, 80)', 'rgb(200, 40, 40)'], activeIndex: 0 });
      await tm.restoreSession();
    }, [su('blu.test', pagina('Blu', 'rgb(40,80,200)', 'uno')), su('verde.test', pagina('Verde', 'rgb(40,200,80)', 'due')), su('rosso.test', pagina('Rosso', 'rgb(200,40,40)', 'tre'))]);

    const prima = await barra();
    expect(prima.map((t) => t.nome)).toEqual(['Blu', 'Verde', 'Rosso']);
    await shell.evaluate(async (id) => window.filoShell.tabs.move(id, (await window.filoShell.tabs.snapshot()).tabs.length - 1),
      prima.find((t) => t.nome === 'Verde').id);
    await expect.poll(async () => (await barra()).map((t) => t.nome)).toEqual(['Blu', 'Rosso', 'Verde']);

    await expect.poll(() => avvisi(shell), { timeout: 40_000 }).toContain('Schede lasciate come le hai messe, nessuna da chiudere');
    expect((await barra()).map((t) => t.nome)).toEqual(['Blu', 'Rosso', 'Verde']);
  });
});

test('la sessione salva e ripristina il colore identità delle schede', async ({ app, shell, openTab, testServer }) => {
  // Save side: una scheda con identità colorata finisce in sessionState con il
  // suo colore, allineato indice-per-indice agli URL.
  await testServer.openReady(openTab, mk('Colorata', 'rgb(200,40,40)'));
  await expect.poll(async () => shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    const t = s.tabs.find((x) => /127\.0\.0\.1/.test(x.url || ''));
    return !!(t && t.identityColor);
  }), { timeout: 12_000 }).toBe(true);

  const state = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    return win._filoTabs.sessionState();
  });
  expect(Array.isArray(state.colors)).toBe(true);
  expect(state.colors.length).toBe(state.tabs.length);
  const webIdx = state.tabs.findIndex((u) => /127\.0\.0\.1/.test(u || ''));
  expect(webIdx).toBeGreaterThanOrEqual(0);
  expect(state.colors[webIdx]).toBeTruthy();

  // Restore side: seminata una sessione con un colore, restoreSession lo applica
  // subito alla scheda ripristinata (letto in-process, prima che i content
  // script ricalcolino). Pagina senza favicon/theme così solo il colore
  // ripristinato può essere presente in quell'istante.
  const url = testServer.html('<!doctype html><html><head><title>Ripristina</title></head><body>plain</body></html>');
  const restored = await app.evaluate(async ({ BrowserWindow }, args) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tm = win._filoTabs;
    const key = tm._sessionKey();
    await globalThis.SN_STORAGE.setRaw(key, { tabs: [args.url], colors: [args.color], activeIndex: 0 });
    await tm.restoreSession();
    const snap = tm.snapshot();
    const t = snap.tabs.find((x) => x.url === args.url);
    return t ? t.identityColor : null;
  }, { url, color: 'rgb(12,34,56)' });
  expect(restored).toBe('rgb(12,34,56)');
});
