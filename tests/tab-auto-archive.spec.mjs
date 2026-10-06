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
    <form id="attivita" onsubmit="event.preventDefault()"><input id="q" type="text"><button>Aggiungi</button></form>
    <a id="via" href="${dopo}">avanti</a>
  </body></html>`));
  const attesa = () => page.waitForTimeout(800);

  await page.locator('#spunta').check();
  await page.locator('#scelta').selectOption('due');
  await attesa();
  expect(await moduloDi(shell, 'Campi')).toBe(false);

  await page.locator('#nota').fill('appunto a metà');
  await expect.poll(() => moduloDi(shell, 'Campi'), { timeout: 8_000 }).toBe(true);

  // Inviare un modulo di una riga non cancella l'appunto scritto fuori da lui.
  await page.locator('#q').fill('comprare il latte');
  await page.locator('#q').press('Enter');
  await attesa();
  expect(await moduloDi(shell, 'Campi')).toBe(true);

  // Svuotato l'appunto non resta niente da perdere.
  await page.locator('#nota').fill('');
  await expect.poll(() => moduloDi(shell, 'Campi'), { timeout: 8_000 }).toBe(false);

  await page.locator('#q').fill('chiamare il medico');
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

// La pulizia guarda cosa c'è nei campi quando decide: il testo ancora da inviare
// tiene aperta la scheda anche in un riquadro, dopo Indietro o dopo un invio
// respinto; un campo che la pagina ha svuotato dopo l'invio non protegge più.

const titoliAperti = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.map((t) => t.title));

async function pulisciTutto(app, shell, testServer) {
  await apriEsatta(app, shell, testServer.html('<!doctype html><title>Altra</title><p>altra pagina'));
  return app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.SN_TAB_TRIAGE_DECIDE = async ({ tabs }) => ({
      decisions: tabs.map((t, i) => ({ i, action: 'archive', reason: 'pulizia' })),
    });
    return win._filoTabs.runAutoTriage({ trigger: 'manual' });
  });
}

test('il testo scritto in un riquadro di un altro sito tiene aperta la scheda (#824)', async ({ app, shell, testServer }) => {
  const dentro = testServer.html('<!doctype html><html><body><textarea id="t" style="width:300px;height:100px"></textarea></body></html>', { pubblico: true });
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Riquadro</title></head><body>
    <iframe id="f" src="${dentro}" style="width:400px;height:200px"></iframe></body></html>`));
  const TESTO = 'Commento lungo scritto nel riquadro dei commenti';
  await page.frameLocator('#f').locator('#t').click();
  await page.keyboard.type(TESTO);
  await expect.poll(() => moduloDi(shell, 'Riquadro'), { timeout: 8_000 }).toBe(true);

  await pulisciTutto(app, shell, testServer);
  expect(await titoliAperti(shell)).toContain('Riquadro');
  expect(await page.frameLocator('#f').locator('#t').inputValue()).toBe(TESTO);

  // Svuotato il riquadro la pagina non ha più niente da perdere.
  await page.frameLocator('#f').locator('#t').fill('');
  await expect.poll(() => moduloDi(shell, 'Riquadro'), { timeout: 8_000 }).toBe(false);
});

test('la bozza che il browser rimette nel campo tornando Indietro tiene aperta la scheda (#824)', async ({ app, shell, testServer }) => {
  const b = testServer.html('<!doctype html><title>Dopo</title><p>pagina dopo');
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Lettera</title></head><body>
    <form action="/x" method="post"><textarea name="m" id="m"></textarea><button>Invia</button></form><a id="via" href="${b}">vai</a></body></html>`));
  const TESTO = 'Bozza della lettera al padrone di casa';
  await page.locator('#m').click();
  await page.keyboard.type(TESTO);
  await expect.poll(() => moduloDi(shell, 'Lettera'), { timeout: 8_000 }).toBe(true);
  await page.locator('#via').click();
  await expect.poll(() => moduloDi(shell, 'Dopo'), { timeout: 8_000 }).toBe(false);
  await page.goBack();
  await page.waitForFunction(() => document.title === 'Lettera');
  await expect(page.locator('#m')).toHaveValue(TESTO);
  await expect.poll(() => moduloDi(shell, 'Lettera'), { timeout: 8_000 }).toBe(true);

  await pulisciTutto(app, shell, testServer);
  expect(await titoliAperti(shell)).toContain('Lettera');
  expect(await page.locator('#m').inputValue()).toBe(TESTO);
});

test('un «Invia» respinto dalla pagina non conta come inviato (#824)', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Candidatura</title></head><body>
    <form id="f"><textarea id="m"></textarea><input id="mail" type="email"><button>Invia</button></form><p id="err"></p>
    <script>document.getElementById('f').addEventListener('submit', (e) => { e.preventDefault(); if (!document.getElementById('mail').value) document.getElementById('err').textContent = 'Manca la mail'; });</script>
    </body></html>`));
  const TESTO = 'Lettera di presentazione lunga e scritta con cura';
  await page.locator('#m').click();
  await page.keyboard.type(TESTO);
  await expect.poll(() => moduloDi(shell, 'Candidatura'), { timeout: 8_000 }).toBe(true);
  await page.locator('button').click();
  await expect(page.locator('#err')).toHaveText('Manca la mail');
  await page.waitForTimeout(500);
  expect(await moduloDi(shell, 'Candidatura')).toBe(true);

  await pulisciTutto(app, shell, testServer);
  expect(await titoliAperti(shell)).toContain('Candidatura');
  expect(await page.locator('#m').inputValue()).toBe(TESTO);
});

test('un commento pubblicato o un messaggio mandato, col campo svuotato dalla pagina, non proteggono più la scheda (#824)', async ({ app, shell, testServer }) => {
  const social = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Social</title></head><body>
    <div id="ed" contenteditable="true" style="min-height:60px;border:1px solid"></div><button id="pub">Pubblica</button><ul id="lista"></ul>
    <script>pub.onclick = () => { const li = document.createElement('li'); li.textContent = ed.textContent; lista.append(li); ed.innerHTML = ''; };</script>
    </body></html>`));
  // Cancellare a mano tutto il testo di un editor ricco toglie la protezione.
  await social.locator('#ed').click();
  await social.keyboard.type('prima prova');
  await expect.poll(() => moduloDi(shell, 'Social'), { timeout: 8_000 }).toBe(true);
  await social.keyboard.press('ControlOrMeta+A');
  await social.keyboard.press('Backspace');
  await expect.poll(() => moduloDi(shell, 'Social'), { timeout: 8_000 }).toBe(false);
  await social.keyboard.type('Bel post!');
  await expect.poll(() => moduloDi(shell, 'Social'), { timeout: 8_000 }).toBe(true);
  await social.locator('#pub').click();
  await expect(social.locator('#lista li')).toHaveText('Bel post!');

  const chat = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Chat</title></head><body>
    <textarea id="chat"></textarea><button id="manda">Manda</button><ul id="lista"></ul>
    <script>manda.onclick = () => { const li = document.createElement('li'); li.textContent = chat.value; lista.append(li); chat.value = ''; };</script>
    </body></html>`));
  await chat.locator('#chat').click();
  await chat.keyboard.type('Ciao, arrivo alle 8');
  await expect.poll(() => moduloDi(shell, 'Chat'), { timeout: 8_000 }).toBe(true);
  await chat.locator('#manda').click();
  await expect(chat.locator('#lista li')).toHaveText('Ciao, arrivo alle 8');

  const bozza = await apriEsatta(app, shell, testServer.html(PAGINA_MODULO.replace('Modulo', 'Bozza')));
  await bozza.locator('#messaggio').fill('ancora da mandare');
  await expect.poll(() => moduloDi(shell, 'Bozza'), { timeout: 8_000 }).toBe(true);

  await pulisciTutto(app, shell, testServer);
  const aperte = await titoliAperti(shell);
  expect(aperte).not.toContain('Social');
  expect(aperte).not.toContain('Chat');
  expect(aperte).toContain('Bozza');
});

// Conta il testo che l'area mostra, anche se non è arrivato con la digitazione
// normale in un campo dove Filo era già caricato.

// Come ProseMirror, Tiptap, Slate, Lexical, Draft, CKEditor 5: l'incolla lo fa l'editor.
const EDITOR_RICCO = `<div id="ed" contenteditable="true" style="min-height:80px;border:1px solid"></div>
  <script>ed.addEventListener('paste', (e) => { e.preventDefault(); const p = document.createElement('p'); p.textContent = e.clipboardData.getData('text/plain'); ed.appendChild(p); });</script>`;

test('un editor classico in un riquadro scritto dalla pagina tiene aperta la scheda, e svuotato non più (#824)', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Blog</title></head><body>
    <iframe id="f" style="width:500px;height:200px"></iframe>
    <script>const d = document.getElementById('f').contentDocument; d.open(); d.write('<!doctype html><html><body contenteditable="true" style="min-height:150px"></body></html>'); d.close();</script>
    </body></html>`));
  const corpo = page.frameLocator('#f').locator('body');
  const TESTO = 'Articolo scritto nell’editor del blog';
  await corpo.click();
  await page.keyboard.type(TESTO);
  await expect.poll(() => moduloDi(shell, 'Blog'), { timeout: 8_000 }).toBe(true);

  await pulisciTutto(app, shell, testServer);
  expect(await titoliAperti(shell)).toContain('Blog');
  expect(await corpo.textContent()).toBe(TESTO);

  await corpo.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await expect.poll(() => moduloDi(shell, 'Blog'), { timeout: 8_000 }).toBe(false);
});

test('una bozza incollata in un editor ricco, con Ctrl+V o con «Incolla» di Filo, tiene aperta la scheda (#824)', async ({ app, shell, testServer }) => {
  const tastiera = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Ricco</title></head><body>${EDITOR_RICCO}</body></html>`));
  const TESTO = 'Bozza lunga preparata altrove e incollata qui';
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), TESTO);
  await tastiera.locator('#ed').click();
  await tastiera.keyboard.press('ControlOrMeta+V');
  await expect(tastiera.locator('#ed')).toHaveText(TESTO);
  await expect.poll(() => moduloDi(shell, 'Ricco'), { timeout: 8_000 }).toBe(true);

  const menu = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Menu</title></head><body>${EDITOR_RICCO}</body></html>`));
  await menu.locator('#ed').click();
  await menu.locator('#ed').click({ button: 'right' });
  await expect(menu.locator('.sn-menu')).toBeVisible();
  await menu.locator('.sn-menu').getByText('Incolla', { exact: true }).first().click();
  await expect(menu.locator('#ed')).toHaveText(TESTO);
  await expect.poll(() => moduloDi(shell, 'Menu'), { timeout: 8_000 }).toBe(true);

  await pulisciTutto(app, shell, testServer);
  const aperte = await titoliAperti(shell);
  expect(aperte).toContain('Ricco');
  expect(aperte).toContain('Menu');
});

test('il codice scritto in un editor che riceve i tasti in una casella nascosta tiene aperta la scheda (#824)', async ({ app, shell, testServer }) => {
  // Com'è fatto CodeMirror 5: la casella che riceve i tasti sta dentro l'editor e si svuota subito.
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Codice</title></head><body>
    <div id="cm" style="border:1px solid;font-family:monospace;min-height:60px">
      <div style="overflow:hidden;position:relative;width:3px;height:0"><textarea id="hid" style="position:absolute;bottom:-1em;padding:0;width:1px;height:1em;outline:none"></textarea></div>
      <div id="righe"><span>1</span> <span id="codice"></span></div>
    </div>
    <button id="svuota">Esegui</button>
    <script>
      cm.addEventListener('mousedown', (e) => { e.preventDefault(); hid.focus(); });
      hid.addEventListener('input', () => { setTimeout(() => { codice.textContent += hid.value; hid.value = ''; }, 20); });
      svuota.onclick = () => { codice.textContent = ''; };
    </script></body></html>`));
  const TESTO = 'function ciao() {}';
  await page.locator('#cm').click();
  await page.keyboard.type(TESTO);
  await expect(page.locator('#codice')).toHaveText(TESTO);
  await expect.poll(() => moduloDi(shell, 'Codice'), { timeout: 8_000 }).toBe(true);

  await pulisciTutto(app, shell, testServer);
  expect(await titoliAperti(shell)).toContain('Codice');
  expect(await page.locator('#codice').textContent()).toBe(TESTO);

  // L'editor tornato com'era prima di scriverci non ha più niente da perdere.
  await page.locator('#svuota').click();
  await expect(page.locator('#codice')).toHaveText('');
  await pulisciTutto(app, shell, testServer);
  expect(await titoliAperti(shell)).not.toContain('Codice');
});

test('una casella di ricerca non protegge la scheda, anche coi risultati dal vivo e prima di Invio (#824)', async ({ app, shell, testServer }) => {
  const BRANI = ['Yesterday', 'Let It Be', 'Hey Jude', 'Imagine'];
  const conRisultati = (titolo, campo) => testServer.html(`<!doctype html><html><head><title>${titolo}</title></head><body>
    ${campo}<ul id="ris"></ul>
    <script>const B = ${JSON.stringify(BRANI)};
      q.addEventListener('input', () => { ris.innerHTML = ''; for (const b of B.filter((x) => x.toLowerCase().includes(q.value.toLowerCase()))) { const li = document.createElement('li'); li.textContent = b; ris.append(li); } });</script>
    </body></html>`);
  for (const [titolo, campo] of [
    ['Musica', '<input id="q" type="search" placeholder="Cosa vuoi ascoltare?">'],
    ['Negozio', '<div role="search"><input id="q" type="text" aria-label="Cerca"></div>'],
    ['Motore', '<form role="search" onsubmit="event.preventDefault()"><textarea id="q" name="q"></textarea></form>'],
  ]) {
    const page = await apriEsatta(app, shell, conRisultati(titolo, campo));
    await page.locator('#q').click();
    await page.keyboard.type('hey');
    await expect(page.locator('#ris li')).toHaveText(['Hey Jude']);
  }
  await expect.poll(() => moduloDi(shell, 'Musica'), { timeout: 2_000 }).toBe(false);
  expect(await moduloDi(shell, 'Negozio')).toBe(false);
  expect(await moduloDi(shell, 'Motore')).toBe(false);

  await pulisciTutto(app, shell, testServer);
  const aperte = await titoliAperti(shell);
  expect(aperte).not.toContain('Musica');
  expect(aperte).not.toContain('Negozio');
  expect(aperte).not.toContain('Motore');
});

// Il testo dell'utente si segue per contenuto: quando la pagina lo sposta in un altro campo, o
// il server lo rimette nella pagina che risponde, è ancora da proteggere; pubblicato no.

test('il testo spostato dalla pagina in un altro campo, o rimandato dal server, tiene aperta la scheda (#824)', async ({ app, shell, testServer }) => {
  const TESTO = 'Il mio post lungo sul viaggio in Islanda, scritto con calma';
  const post = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Post</title></head><body>
    <div id="box"><div id="ed" contenteditable="true" style="min-height:80px;border:1px solid"></div></div><button id="md">Markdown</button>
    <script>md.onclick = () => { const t = document.createElement('textarea'); t.id = 'ta'; t.value = ed.innerText; box.replaceChildren(t); };</script>
    </body></html>`));
  await post.locator('#ed').click();
  await post.keyboard.type(TESTO);
  await post.locator('#md').click();
  await expect(post.locator('#ta')).toHaveValue(TESTO);

  // Anteprima, invio respinto dal server, passo dopo di un modulo a pagine: il testo torna nella risposta.
  const risposte = {
    Anteprima: `<p>Manca l'oggetto</p><form method="post"><textarea name="m" id="m">${TESTO}</textarea><button>Salva</button></form>`,
    Passo: `<form method="post"><input type="hidden" name="m" value="${TESTO}"><input name="tel"><button>Invia</button></form>`,
  };
  for (const [titolo, corpo] of Object.entries(risposte)) {
    const dopo = testServer.html(`<!doctype html><html><head><title>${titolo}</title></head><body>${corpo}</body></html>`);
    const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Prima ${titolo}</title></head><body>
      <form method="post" action="${dopo}"><textarea name="m" id="m"></textarea><button id="via">Avanti</button></form></body></html>`));
    await page.locator('#m').click();
    await page.keyboard.type(TESTO);
    await page.locator('#via').click();
    await page.waitForFunction((t) => document.title === t && document.documentElement.dataset.filoReady === '1', titolo);
  }

  // Pubblicato: il riquadro sparisce col testo dentro, e il testo compare come commento.
  const social = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Commenti</title></head><body>
    <div id="box"><div id="ed" contenteditable="true" style="min-height:60px;border:1px solid"></div><button id="pub">Rispondi</button></div><ul id="lista"></ul>
    <script>pub.onclick = () => { const li = document.createElement('li'); li.textContent = ed.textContent; lista.append(li); box.remove(); };</script>
    </body></html>`));
  await social.locator('#ed').click();
  await social.keyboard.type(TESTO);
  await social.locator('#pub').click();
  await expect(social.locator('#lista li')).toHaveText(TESTO);

  // Una ricerca rimandata nella casella della pagina dei risultati non è una bozza.
  const risultati = testServer.html('<!doctype html><html><head><title>Risultati</title></head><body><form method="post"><input name="dove" id="dove" value="Reykjavik"><button>Cerca</button></form><p>12 alberghi</p></body></html>');
  const cerca = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Alberghi</title></head><body>
    <form method="post" action="${risultati}"><input name="dove" id="dove" placeholder="Dove vuoi andare?"><button>Cerca</button></form></body></html>`));
  await cerca.locator('#dove').click();
  await cerca.keyboard.type('Reykjavik');
  await cerca.locator('button').click();
  await cerca.waitForFunction(() => document.title === 'Risultati' && document.documentElement.dataset.filoReady === '1');

  await pulisciTutto(app, shell, testServer);
  const aperte = await titoliAperti(shell);
  expect(aperte).toContain('Post');
  expect(aperte).toContain('Anteprima');
  expect(aperte).toContain('Passo');
  expect(aperte).not.toContain('Commenti');
  expect(aperte).not.toContain('Risultati');
});

test('il testo di un campo tolto dalla pagina tiene aperta la scheda finché non ricompare nella pagina (#824)', async ({ app, shell, testServer }) => {
  // Procedura a passi: «Avanti» toglie il primo passo, la lettera resta solo nella memoria della pagina.
  const domanda = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Domanda</title></head><body>
    <form onsubmit="event.preventDefault()"><div id="passo">
      <textarea id="lettera" style="width:400px;height:100px"></textarea><button type="button" id="avanti">Avanti</button></div></form>
    <script>const dati = {}; avanti.onclick = () => { dati.lettera = lettera.value;
      passo.innerHTML = '<input id="tel" type="tel"><button>Invia candidatura</button>'; };</script>
    </body></html>`));
  await domanda.locator('#lettera').click();
  await domanda.keyboard.type('Lettera di presentazione scritta con cura 🙂');
  await domanda.locator('#avanti').click();
  await expect(domanda.locator('#tel')).toBeVisible();

  // Vale anche per un campo di una riga.
  const iscrizione = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Iscrizione</title></head><body>
    <div id="passo"><input id="via" style="width:300px"><button id="avanti">Avanti</button></div>
    <script>avanti.onclick = () => { passo.innerHTML = '<p>Passo 2 di 3</p>'; };</script>
    </body></html>`));
  await iscrizione.locator('#via').click();
  await iscrizione.keyboard.type('Via dei Mille 12, scala B');
  await iscrizione.locator('#avanti').click();
  await expect(iscrizione.getByText('Passo 2 di 3')).toBeVisible();

  // Una password non è una bozza.
  const accesso = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Accesso</title></head><body>
    <div id="box"><input id="pw" type="password"><button id="entra">Entra</button></div>
    <script>entra.onclick = () => { box.innerHTML = '<p>Benvenuto</p>'; };</script>
    </body></html>`));
  // Su http Filo avvisa delle password con un riquadro sopra la pagina: il campo si raggiunge col fuoco.
  await accesso.locator('#pw').focus();
  await accesso.keyboard.type('segreta123');
  await accesso.locator('#entra').evaluate((b) => b.click());
  await expect(accesso.getByText('Benvenuto')).toBeVisible();

  await pulisciTutto(app, shell, testServer);
  const aperte = await titoliAperti(shell);
  expect(aperte).toContain('Domanda');
  expect(aperte).toContain('Iscrizione');
  expect(aperte).not.toContain('Accesso');
  expect(await domanda.evaluate(() => dati.lettera)).toBe('Lettera di presentazione scritta con cura 🙂');
});

test('il testo scritto in un campo dentro un componente della pagina tiene aperta la scheda (#824)', async ({ app, shell, testServer }) => {
  const chiuso = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Chiuso</title></head><body>
    <x-campo style="display:block"></x-campo>
    <script>customElements.define('x-campo', class extends HTMLElement { constructor() { super();
      const r = this.attachShadow({ mode: 'closed' }); r.innerHTML = '<textarea style="width:300px;height:80px"></textarea>'; window.__ta = r.querySelector('textarea'); } });</script>
    </body></html>`));
  await chiuso.mouse.click(60, 40);
  await chiuso.keyboard.type('Testo nel componente chiuso');
  expect(await chiuso.evaluate(() => window.__ta.value)).toBe('Testo nel componente chiuso');

  const ombra = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Ombra</title></head><body>
    <x-ed style="display:block"></x-ed>
    <script>customElements.define('x-ed', class extends HTMLElement { connectedCallback() {
      const r = this.attachShadow({ mode: 'open' }); const f = document.createElement('iframe');
      f.style.cssText = 'width:500px;height:200px'; r.append(f);
      const d = f.contentDocument; d.open(); d.write('<!doctype html><html><body contenteditable="true" style="min-height:150px"></body></html>'); d.close(); } });</script>
    </body></html>`));
  const corpo = ombra.frameLocator('x-ed iframe').locator('body');
  await corpo.click();
  await ombra.keyboard.type('Articolo nell’editor del componente');
  await expect(corpo).toHaveText('Articolo nell’editor del componente');

  await pulisciTutto(app, shell, testServer);
  const aperte = await titoliAperti(shell);
  expect(aperte).toContain('Chiuso');
  expect(aperte).toContain('Ombra');
});

test('un numero o una data messi dai pulsanti della pagina non proteggono la scheda, «Incolla» di Filo sì (#824)', async ({ app, shell, testServer }) => {
  const negozio = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Negozio</title></head><body>
    <input id="qta" type="number" value="1" min="1"><button id="piu">+</button>
    <input id="arrivo" type="text" placeholder="Arrivo" readonly><button id="giorno">12</button>
    <script>piu.onclick = () => { qta.stepUp(); qta.dispatchEvent(new Event('change', { bubbles: true })); };
      giorno.onclick = () => { arrivo.value = '12/10/2026'; arrivo.dispatchEvent(new Event('input', { bubbles: true })); arrivo.dispatchEvent(new Event('change', { bubbles: true })); };</script>
    </body></html>`));
  await negozio.locator('#piu').click();
  await negozio.locator('#piu').click();
  await negozio.locator('#giorno').click();
  await expect(negozio.locator('#qta')).toHaveValue('3');
  await expect(negozio.locator('#arrivo')).toHaveValue('12/10/2026');
  await negozio.waitForTimeout(800);
  expect(await moduloDi(shell, 'Negozio')).toBe(false);

  const TESTO = 'Risposta preparata altrove e incollata con Filo';
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), TESTO);
  const nota = await apriEsatta(app, shell, testServer.html('<!doctype html><html><head><title>Nota</title></head><body><textarea id="t" style="width:300px;height:80px"></textarea></body></html>'));
  await nota.locator('#t').click();
  await nota.locator('#t').click({ button: 'right' });
  await expect(nota.locator('.sn-menu')).toBeVisible();
  await nota.locator('.sn-menu').getByText('Incolla', { exact: true }).first().click();
  await expect(nota.locator('#t')).toHaveValue(TESTO);
  await expect.poll(() => moduloDi(shell, 'Nota'), { timeout: 8_000 }).toBe(true);

  await pulisciTutto(app, shell, testServer);
  const aperte = await titoliAperti(shell);
  expect(aperte).not.toContain('Negozio');
  expect(aperte).toContain('Nota');
});
