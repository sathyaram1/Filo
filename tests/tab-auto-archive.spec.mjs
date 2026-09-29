// Auto-archiviazione / riordino tab (spec §2.1, §2.3) — orchestrazione.
//
// La decisione LLM viene STUBBATA (niente chiave/rete nei test): verifichiamo
// che, date le decisioni, il TabManager archivi le tab giuste, NON tocchi la
// scheda attiva, le metta nell'archivio e mostri il toast. Più: il ripristino
// dello scroll alla riapertura dall'archivio.

import { test, expect } from './fixtures/electron.mjs';

const mk = (title, color, h = 1500) =>
  `<!doctype html><html><head><title>${title}</title>${color ? `<meta name="theme-color" content="${color}">` : ''}</head>`
  + `<body style="margin:0"><div style="height:${h}px;background:#fff"></div></body></html>`;

test('runAutoTriage archivia le tab decise, tiene la attiva e mostra il toast', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab, mk('Alpha', 'rgb(200,40,40)'));
  await testServer.openReady(openTab, mk('Bravo', 'rgb(40,80,200)'));
  await testServer.openReady(openTab, mk('Charlie', '')); // ultima → attiva

  // Attendi che lo stato sia assestato: tutte e tre presenti e Charlie attiva.
  await expect.poll(async () => shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    const titles = s.tabs.map((t) => t.title);
    const active = s.tabs.find((t) => t.id === s.activeId);
    return ['Alpha', 'Bravo', 'Charlie'].every((x) => titles.includes(x)) && active && active.title === 'Charlie';
  }), { timeout: 8_000 }).toBe(true);

  // Stub della decisione LLM nel main: archivia SOLO "Alpha" (deterministico).
  const res = await app.evaluate(async ({ BrowserWindow }) => {
    globalThis.SN_TAB_TRIAGE_DECIDE = async ({ tabs }) => ({
      decisions: tabs.map((t, i) => ({ i, action: t.title === 'Alpha' ? 'archive' : 'keep', reason: 'test' })),
    });
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    return win._filoTabs.runAutoTriage({ trigger: 'test' });
  });
  expect(res.archived).toBe(1);

  // Il primo candidato web non-attivo è "Alpha": ora non è più tra le tab aperte.
  const titles = await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    return s.tabs.map((t) => t.title);
  });
  expect(titles).not.toContain('Alpha');
  expect(titles).toContain('Bravo');
  expect(titles).toContain('Charlie');

  // È finita nell'archivio.
  const archived = await app.evaluate(async () => await globalThis.SN_ARCHIVED_TABS.list());
  expect(archived.some((x) => /Alpha/.test(x.title || ''))).toBe(true);

  // La scheda attiva è ancora aperta (mai archiviata).
  const activeTitle = await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    const a = s.tabs.find((t) => t.id === s.activeId);
    return a ? a.title : null;
  });
  expect(activeTitle).toBe('Charlie');

  // Toast §2.3 mostrato nella shell.
  await expect.poll(() => shell.evaluate(() => {
    const el = document.querySelector('.shell-notif.show .shell-notif-msg');
    return !!(el && /cronologia/i.test(el.textContent || ''));
  }), { timeout: 6_000 }).toBe(true);
});

test('riaprire una scheda dall’archivio ripristina la posizione di scroll', async ({ app, shell, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, mk('Lunga', '', 4000));
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);

  // Scrolla in fondo → scrollPct alto.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(async () => shell.evaluate(async (i) => {
    const s = await window.filoShell.tabs.snapshot();
    const t = s.tabs.find((x) => x.id === i);
    return t ? t.scrollPct : 0;
  }, id), { timeout: 8_000 }).toBeGreaterThan(50);

  // Chiudi (→ archiviata con la sua scrollPosition) e ottieni l'URL salvato.
  await shell.evaluate(async (i) => window.filoShell.tabs.close(i), id);
  const url = await app.evaluate(async ({ BrowserWindow }) => {
    const list = await globalThis.SN_ARCHIVED_TABS.list();
    const e = list.find((x) => /Lunga/.test(x.title || ''));
    if (!e) return null;
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    win._filoTabs.openTab(e.url, { activate: true, restoreScrollPct: e.scrollPosition });
    return e.url;
  });
  expect(url).toBeTruthy();

  // La pagina riaperta torna scrollata (non da capo).
  await expect.poll(async () => {
    const p = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } });
    if (!p) return 0;
    try { return await p.evaluate(() => window.scrollY); } catch (_) { return 0; }
  }, { timeout: 10_000 }).toBeGreaterThan(100);
});

test('il riordino collassa le home duplicate e chiude le impostazioni (feedback #239)', async ({ app, shell, openTab, testServer }) => {
  // Scenario del feedback: home aperta più volte + una pagina impostazioni +
  // un sito. Prima il riordino toccava solo i siti web (chiudeva YouTube ma mai
  // home/impostazioni). Ora: le home duplicate si collassano da sole e
  // l'impostazione la archivia l'LLM; il sito web resta se l'LLM dice "keep".
  // (Al boot Filo apre già una home; qui ne aggiungiamo altre → home duplicate.)
  await testServer.openReady(openTab, mk('Sito', 'rgb(40,80,200)'));
  await openTab('filo://newtab/');            // home extra
  await openTab('filo://options/options.html'); // impostazioni
  await openTab('filo://newtab/');            // home extra (diventa attiva)

  // Assestamento: più home duplicate, una pagina options, un sito, home attiva.
  await expect.poll(async () => shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    const newtabs = s.tabs.filter((t) => /filo:\/\/newtab/.test(t.url || ''));
    const opts = s.tabs.filter((t) => /filo:\/\/options/.test(t.url || ''));
    const active = s.tabs.find((t) => t.id === s.activeId);
    return newtabs.length >= 2 && opts.length === 1 && !!active
      && /filo:\/\/newtab/.test(active.url || '');
  }), { timeout: 8_000 }).toBe(true);

  // LLM: tiene il sito, archivia la pagina impostazioni. Le home duplicate NON
  // dipendono dall'LLM (dedup deterministico): qui l'LLM le lascia "keep" apposta
  // per provare che vengono chiuse comunque.
  const res = await app.evaluate(async ({ BrowserWindow }) => {
    globalThis.SN_TAB_TRIAGE_DECIDE = async ({ tabs }) => ({
      decisions: tabs.map((t, i) => ({
        i,
        action: /filo:\/\/options/.test(t.url || '') ? 'archive' : 'keep',
        reason: 'test',
      })),
    });
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    return win._filoTabs.runAutoTriage({ trigger: 'manual' });
  });
  // Almeno 2 chiuse: la home duplicata (non attiva) + la pagina impostazioni.
  expect(res.archived).toBeGreaterThanOrEqual(2);

  const after = await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    const active = s.tabs.find((t) => t.id === s.activeId);
    return {
      urls: s.tabs.map((t) => t.url),
      activeUrl: active ? active.url : null,
    };
  });
  // Resta UNA sola home (l'attiva); la duplicata è stata chiusa.
  expect(after.urls.filter((u) => /filo:\/\/newtab/.test(u || '')).length).toBe(1);
  // La pagina impostazioni non c'è più.
  expect(after.urls.some((u) => /filo:\/\/options/.test(u || ''))).toBe(false);
  // La home attiva è ancora aperta e il sito web (keep) è rimasto.
  expect(/filo:\/\/newtab/.test(after.activeUrl || '')).toBe(true);
  expect(after.urls.some((u) => /^https?:/.test(u || ''))).toBe(true);
});

test('l’agente può lanciare la pulizia su richiesta (RUN_TAB_TRIAGE)', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab, mk('Uno', 'rgb(200,40,40)'));
  await testServer.openReady(openTab, mk('Due', 'rgb(40,80,200)'));
  // La pagina dalla quale parte la richiesta (impostazioni) diventa attiva e
  // interna. Usiamo options (istanza unica, non la home che al boot è già aperta
  // e verrebbe collassata come duplicata): la pagina attiva è sempre protetta,
  // così l'handle resta vivo per tutta la chiamata.
  const dash = await openTab('filo://options/options.html');

  // Stub: archivia tutti i candidati (le due tab web + eventuali home duplicate).
  await app.evaluate(async () => {
    globalThis.SN_TAB_TRIAGE_DECIDE = async ({ tabs }) => ({
      decisions: tabs.map((t, i) => ({ i, action: 'archive', reason: 'pulizia' })),
    });
  });

  // L'agente, dopo conferma, manda RUN_TAB_TRIAGE: lo simuliamo dalla pagina.
  const res = await dash.evaluate(async () =>
    await chrome.runtime.sendMessage({ type: 'run_tab_triage' }));
  expect(res.ok).toBe(true);
  expect(res.archived).toBeGreaterThanOrEqual(2);

  // Le due tab web non ci sono più; la pagina attiva (interna) resta aperta.
  const state = await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    const active = s.tabs.find((t) => t.id === s.activeId);
    return { titles: s.tabs.map((t) => t.title), activeUrl: active ? active.url : null };
  });
  expect(state.titles).not.toContain('Uno');
  expect(state.titles).not.toContain('Due');
  expect(/filo:\/\/options/.test(state.activeUrl || '')).toBe(true);
});

// #824 — il testo scritto in un modulo e non inviato non si perde mai per la
// pulizia, qualunque cosa decida il modello: la scheda resta aperta.

async function apriEsatta(app, shell, url) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  let page = null;
  await expect.poll(() => {
    page = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } });
    return !!page;
  }, { timeout: 10_000 }).toBe(true);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  return page;
}

const moduloDi = (shell, title) => shell.evaluate(async (t) => {
  const s = await window.filoShell.tabs.snapshot();
  const tab = s.tabs.find((x) => x.title === t);
  return tab ? tab.formDirty : null;
}, title);

const PAGINA_MODULO = `<!doctype html><html><head><title>Modulo</title></head><body>
  <form onsubmit="event.preventDefault()"><textarea id="messaggio"></textarea><button>Invia</button></form>
</body></html>`;

test('/pulisci e il bottone della home non chiudono la scheda con un modulo scritto e non inviato (#824)', async ({ app, shell, testServer, openTab }) => {
  await apriEsatta(app, shell, testServer.html(mk('Alpha', 'rgb(200,40,40)')));
  const modulo = await apriEsatta(app, shell, testServer.html(PAGINA_MODULO));
  const TESTO = 'Gentile assistenza, vi scrivo perché il mio ordine 🚚 <b>non</b> è arrivato';
  await modulo.locator('#messaggio').fill(TESTO);
  await expect.poll(() => moduloDi(shell, 'Modulo'), { timeout: 8_000 }).toBe(true);
  await apriEsatta(app, shell, testServer.html(mk('Bravo', 'rgb(40,80,200)')));
  // La richiesta parte da una pagina di Filo, come /pulisci e il bottone della home.
  const dash = await openTab('filo://options/options.html');

  // Il modello decide di archiviare TUTTO, anche la scheda col modulo.
  await app.evaluate(async () => {
    globalThis.SN_TAB_TRIAGE_DECIDE = async ({ tabs }) => ({
      decisions: tabs.map((t, i) => ({ i, action: 'archive', reason: 'pulizia' })),
    });
  });
  const res = await dash.evaluate(async () => await chrome.runtime.sendMessage({ type: 'run_tab_triage' }));
  expect(res.ok).toBe(true);
  expect(res.archived).toBeGreaterThanOrEqual(2);

  const titoli = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.map((t) => t.title));
  expect(titoli).toContain('Modulo');
  expect(titoli).not.toContain('Alpha');
  expect(titoli).not.toContain('Bravo');
  // Il testo è ancora lì, nella scheda rimasta aperta.
  expect(await modulo.locator('#messaggio').inputValue()).toBe(TESTO);
  await expect.poll(async () => app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).length), { timeout: 5_000 }).toBeGreaterThan(0);
  const archiviate = await app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).map((x) => x.title));
  expect(archiviate).not.toContain('Modulo');
});

test('se l’utente scrive mentre il modello sta decidendo, quella scheda resta aperta (#824)', async ({ app, shell, testServer }) => {
  await apriEsatta(app, shell, testServer.html(mk('Uno', 'rgb(200,40,40)')));
  await apriEsatta(app, shell, testServer.html(mk('Due', 'rgb(40,80,200)')));
  await apriEsatta(app, shell, testServer.html(mk('Tre', '')));

  const res = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.SN_TAB_TRIAGE_DECIDE = async ({ tabs }) => {
      // A decisione in corso l'utente scrive in "Due": il segnale arriva adesso.
      const due = win._filoTabs.tabs.find((t) => t.title === 'Due');
      win._filoTabs.setTabActivity(due.id, { formDirty: true });
      return { decisions: tabs.map((t, i) => ({ i, action: 'archive', reason: 'test' })) };
    };
    return win._filoTabs.runAutoTriage({ trigger: 'idle' });
  });
  expect(res.archived).toBeGreaterThanOrEqual(1);

  const titoli = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.map((t) => t.title));
  expect(titoli).toContain('Due');
  expect(titoli).toContain('Tre');
  expect(titoli).not.toContain('Uno');
});

test('conta solo il testo ancora da inviare: spunte, invio e cambio pagina non proteggono la scheda (#824)', async ({ app, shell, testServer }) => {
  const dopo = testServer.html(mk('Dopo', ''));
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Campi</title></head><body>
    <label><input type="checkbox" id="spunta"> ricordami</label>
    <select id="scelta"><option>uno</option><option>due</option></select>
    <textarea id="nota"></textarea>
    <form id="ricerca" onsubmit="event.preventDefault()"><input id="q" type="search"><button>Cerca</button></form>
    <a id="via" href="${dopo}">avanti</a>
  </body></html>`));
  const attesa = () => page.waitForTimeout(800);

  await page.locator('#spunta').check();
  await page.locator('#scelta').selectOption('due');
  await attesa();
  expect(await moduloDi(shell, 'Campi')).toBe(false);

  await page.locator('#nota').fill('appunto a metà');
  await expect.poll(() => moduloDi(shell, 'Campi'), { timeout: 8_000 }).toBe(true);

  // Inviare la ricerca non cancella l'appunto scritto fuori dal modulo.
  await page.locator('#q').fill('meteo');
  await page.locator('#q').press('Enter');
  await attesa();
  expect(await moduloDi(shell, 'Campi')).toBe(true);

  // Svuotato l'appunto non resta niente da perdere.
  await page.locator('#nota').fill('');
  await expect.poll(() => moduloDi(shell, 'Campi'), { timeout: 8_000 }).toBe(false);

  await page.locator('#q').fill('treni per Roma');
  await expect.poll(() => moduloDi(shell, 'Campi'), { timeout: 8_000 }).toBe(true);
  await page.locator('#q').press('Enter');
  await expect.poll(() => moduloDi(shell, 'Campi'), { timeout: 8_000 }).toBe(false);

  // Una pagina nuova non eredita il testo di quella di prima.
  await page.locator('#nota').fill('bozza');
  await expect.poll(() => moduloDi(shell, 'Campi'), { timeout: 8_000 }).toBe(true);
  await page.locator('#via').click();
  await expect.poll(() => moduloDi(shell, 'Dopo'), { timeout: 8_000 }).toBe(false);
});

test('le impostazioni di Filo salvano da sole: scriverci non le protegge dalla pulizia (#824)', async ({ shell, openTab }) => {
  const opzioni = await openTab('filo://options/options.html');
  await opzioni.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await opzioni.evaluate(() => {
    const el = document.querySelector('input[type="text"], input:not([type]), textarea');
    el.value = 'prova';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await opzioni.waitForTimeout(800);
  const sporca = await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    const t = s.tabs.find((x) => /filo:\/\/options/.test(x.url || ''));
    return t ? t.formDirty : null;
  });
  expect(sporca).toBe(false);
});
