// Feedback alpha #350: «aggiungi il comando /riordina che riordina tutte le tab
// (come se fosse stato chiuso e riaperto Filo)». Nuovo comando slash della
// dashboard che riordina la striscia per colore (§1.3, lo stesso riordino della
// riapertura di Filo) SENZA archiviare/chiudere nulla — a differenza di /pulisci.
//
// Sette garanzie, tutte ASSERISCONO il successo:
//   1) "/riordina" è classificato come comando Filo (arancione), non
//      shell/sconosciuto;
//   2) inviato dalla nuova scheda, riordina davvero le tab web per tinta
//      lasciandole TUTTE aperte (nessuna archiviazione);
//   3) con una scheda sola risponde "già in ordine" invece di tacere;
//   4) la scheda su cui eri resta quella attiva anche dopo il riordino;
//   5) riordinare due volte di fila: la seconda è un non-fare, e lo dice;
//   6) "/riordina" con parole in più resta un comando riconosciuto;
//   7) i siti col favicon bianco o nero vanno alle due estremità dell'arcobaleno
//      e quelli senza favicon in coda (#822), anche con saturazione_tab a 0;
//      un rosso che tende al rosa (Netflix) sta in testa accanto al rosso (#822.1).
//
// I casi 3-6 stavano in uno spec a parte, nato per una verifica e finito nel
// repo per sbaglio: cancellandolo sono spariti quattro controlli che nessun
// altro test rifà. Stanno qui perché è qui che si va a cercarli.

import { createRequire } from 'node:module';
import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

const mk = (title, color) =>
  `<!doctype html><html><head><title>${title}</title>`
  + `${color ? `<meta name="theme-color" content="${color}">` : ''}</head>`
  + `<body style="margin:0"><div style="height:1200px;background:#fff"></div></body></html>`;

// La regola d'ordine della barra, dal modulo condiviso: l'ordine atteso si calcola dai colori REALI assegnati.
createRequire(import.meta.url)('../src/shared/tabColor.js');
const { compareRainbow } = globalThis.SN_TAB_COLOR;

async function submit(page, command) {
  await page.evaluate((cmd) => {
    const input = document.getElementById('input');
    const form = document.getElementById('inputForm');
    input.value = cmd;
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }, command);
}

test('"/riordina" è riconosciuto come comando Filo', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  const input = page.locator('#input');
  await expect(input).toBeVisible({ timeout: 8_000 });

  await input.fill('/riordina');
  await expect(input).toHaveClass(/is-cmd-filo/);
  await expect(input).not.toHaveClass(/is-cmd-unknown/);
});

test('"/riordina" riordina le schede per colore senza chiuderne nessuna', async ({ shell, openTab, testServer }) => {
  // Aperte in ordine NON cromatico (blu → verde → rosso): dopo /riordina devono
  // finire per tinta (rosso → verde → blu).
  await testServer.openReady(openTab, mk('Blu', 'rgb(40,80,200)'));
  await testServer.openReady(openTab, mk('Verde', 'rgb(40,200,80)'));
  await testServer.openReady(openTab, mk('Rosso', 'rgb(200,40,40)'));

  // La nuova scheda da cui invieremo il comando: il filtro sulle schede web la
  // lascia fuori dal confronto.
  const dash = await openTab(NEWTAB);
  await expect(dash.locator('#input')).toBeVisible({ timeout: 8_000 });

  // Attendi che tutte e tre le web tab abbiano titolo reale e tre colori
  // identità distinti: vedi schedePronte. Un tab appena creato riporta per un
  // attimo "Nuova scheda" prima che il suo <title> raggiunga la barra, e parte
  // col colore in cache del dominio, cioè con quello della scheda aperta prima.
  await schedePronte(shell);

  const before = await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    return s.tabs.filter((t) => /127\.0\.0\.1/.test(t.url || ''))
      .map((t) => ({ title: t.title, identityColor: t.identityColor }));
  });
  const insertionOrder = before.map((t) => t.title);
  const expectedOrder = [...before]
    .sort((a, b) => compareRainbow(a.identityColor, b.identityColor))
    .map((t) => t.title);
  // Sanity: scenario non-banale, altrimenti passerebbe anche senza riordino.
  expect(expectedOrder).not.toEqual(insertionOrder);

  // Invia "/riordina" dalla nuova scheda. Nessuna conferma (deterministico).
  await submit(dash, '/riordina');

  // La barra è stata riordinata per colore, e TUTTE e tre le schede web sono
  // ancora aperte (nessuna archiviazione — è la differenza da /pulisci).
  await expect.poll(async () => shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    return s.tabs.filter((t) => /127\.0\.0\.1/.test(t.url || '')).map((t) => t.title);
  }), { timeout: 15_000 }).toEqual(expectedOrder);
});

// L'ultima riga che Filo ha scritto in chat.
async function ultimaRigaFilo(page) {
  return page.evaluate(() => {
    const bolle = [...document.querySelectorAll('.dash-bubble-filo')];
    const ultima = bolle[bolle.length - 1];
    return ultima ? ultima.textContent.trim() : '';
  });
}

// Aspetta che le tre schede web abbiano preso il loro colore identità E il loro
// titolo vero: prima di quel momento il riordino non ha su cosa lavorare, e una
// scheda appena aperta si chiama ancora "Nuova scheda" (il suo <title> arriva
// alla striscia un istante dopo). Chi cerca la scheda "Rosso" troppo presto non
// la trova, e il rosso parla dell'attesa invece che del riordino.
// I tre colori devono anche essere TRE, cioè diversi fra loro. Filo tiene il
// colore identità in una cache per dominio, e qui le tre pagine stanno sullo
// stesso dominio (il mini server dei test): una scheda appena aperta parte con
// il colore in cache, cioè con quello della pagina aperta prima, e lo corregge
// quando il suo content script ha finito. In quella finestra le tre schede
// hanno un colore (la riga sopra è verde) ma è lo STESSO, l'ordine cromatico
// coincide con quello di apertura, e il riordino sembra non aver fatto niente.
async function schedePronte(shell) {
  await expect.poll(async () => shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    const web = s.tabs.filter((t) => /127\.0\.0\.1/.test(t.url || ''));
    const titoli = web.map((t) => t.title).sort();
    const colori = new Set(web.map((t) => t.identityColor));
    return web.length === 3
      && web.every((t) => !!t.identityColor)
      && colori.size === 3
      && JSON.stringify(titoli) === JSON.stringify(['Blu', 'Rosso', 'Verde']);
  }), { timeout: 12_000, message: 'le tre schede non hanno ancora tre colori distinti' }).toBe(true);
}

// I colori non solo ci sono: hanno anche SMESSO di cambiare. Una pagina appena
// aperta può correggere il proprio colore identità un istante dopo averlo dato
// (il content script lo ricalcola quando la pagina ha finito di caricare), e un
// colore che cambia dopo un riordino rende il riordino successivo un lavoro
// vero invece che un non-fare. Chi vuole verificare che riordinare due volte
// non muova niente deve prima aspettare che non ci sia più niente da muovere:
// due letture uguali a distanza di mezzo secondo.
async function coloriFermi(shell) {
  const leggi = () => shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    return JSON.stringify(s.tabs
      .filter((t) => /127\.0\.0\.1/.test(t.url || ''))
      .map((t) => [t.id, t.identityColor]));
  });
  await schedePronte(shell);
  await expect.poll(async () => {
    const prima = await leggi();
    await new Promise((r) => setTimeout(r, 500));
    return (await leggi()) === prima;
  }, { timeout: 15_000, message: 'i colori identità continuano a cambiare' }).toBe(true);
}

test('"/riordina" con una scheda sola risponde "già in ordine", e la dashboard resta viva', async ({ openTab }) => {
  const dash = await openTab(NEWTAB);
  await expect(dash.locator('#input')).toBeVisible({ timeout: 8_000 });

  await submit(dash, '/riordina');

  // Ogni azione ha un esito: anche il non-fare si dice, altrimenti l'utente non
  // sa se il comando è arrivato.
  await expect.poll(() => ultimaRigaFilo(dash), { timeout: 8_000 }).toContain('già in ordine');
  await expect(dash.locator('#input')).toBeVisible();
});

test('dopo "/riordina" resti sulla scheda su cui eri', async ({ shell, openTab, testServer }) => {
  await testServer.openReady(openTab, mk('Blu', 'rgb(40,80,200)'));
  await testServer.openReady(openTab, mk('Verde', 'rgb(40,200,80)'));
  await testServer.openReady(openTab, mk('Rosso', 'rgb(200,40,40)'));
  const dash = await openTab(NEWTAB);
  await expect(dash.locator('#input')).toBeVisible({ timeout: 8_000 });
  await schedePronte(shell);

  // Torna su "Rosso" e ricorda su quale scheda sei: riordinare cambia il posto
  // delle schede, non quella che stai guardando.
  const attivaPrima = await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    const rossa = s.tabs.find((t) => t.title === 'Rosso');
    if (rossa) await window.filoShell.tabs.activate(rossa.id);
    return rossa ? rossa.id : null;
  });
  expect(attivaPrima).toBeTruthy();

  await submit(dash, '/riordina');

  await expect.poll(async () => shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    return s.activeId;
  }), { timeout: 10_000 }).toBe(attivaPrima);
});

test('"/riordina" due volte di fila: la seconda non muove niente e lo dice', async ({ shell, openTab, testServer }) => {
  await testServer.openReady(openTab, mk('Blu', 'rgb(40,80,200)'));
  await testServer.openReady(openTab, mk('Verde', 'rgb(40,200,80)'));
  await testServer.openReady(openTab, mk('Rosso', 'rgb(200,40,40)'));
  const dash = await openTab(NEWTAB);
  await expect(dash.locator('#input')).toBeVisible({ timeout: 8_000 });
  await coloriFermi(shell);

  await submit(dash, '/riordina');
  await expect.poll(() => ultimaRigaFilo(dash), { timeout: 8_000 }).toContain('riordinate per colore');

  await submit(dash, '/riordina');
  await expect.poll(() => ultimaRigaFilo(dash), { timeout: 8_000 }).toContain('già in ordine');
});

test('"/riordina" con parole in più resta un comando riconosciuto', async ({ openTab }) => {
  const dash = await openTab(NEWTAB);
  const input = dash.locator('#input');
  await expect(input).toBeVisible({ timeout: 8_000 });

  await input.fill('/riordina adesso per favore');
  await expect(input).toHaveClass(/is-cmd-filo/);
  await expect(input).not.toHaveClass(/is-cmd-unknown/);
});

// #822: un favicon bianco o nero è un colore identità (grigio) e sta all'estremità; senza favicon si va in coda.
const iconaPiena = (fill) => `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="${fill}"/></svg>`)}`;
const conIcona = (title, fill) =>
  `<!doctype html><html><head><title>${title}</title>`
  + `${fill ? `<link rel="icon" href="${iconaPiena(fill)}">` : ''}</head>`
  + '<body style="margin:0"><div style="height:1200px;background:#fff"></div></body></html>';
// In ordine di apertura, che non è quello arcobaleno.
const SCHEDE = [
  ['Nero', 'rgb(0,0,0)', 'rgb(0, 0, 0)'],
  ['Senza', null, null],
  ['Blu', 'rgb(0,0,255)', 'rgb(0, 0, 255)'],
  ['Bianco', 'rgb(255,255,255)', 'rgb(255, 255, 255)'],
  ['Rosso', 'rgb(255,0,0)', 'rgb(255, 0, 0)'],
];

async function riordinaBiancoNeroEColori({ shell, openTab, testServer }) {
  for (const [titolo, fill] of SCHEDE) await testServer.openReady(openTab, conIcona(titolo, fill));
  const dash = await openTab(NEWTAB);
  await expect(dash.locator('#input')).toBeVisible({ timeout: 8_000 });
  const webTabs = () => shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    return s.tabs.filter((t) => /127\.0\.0\.1/.test(t.url || '')).map((t) => ({ title: t.title, identityColor: t.identityColor || null }));
  });
  // Ognuna col SUO colore: appena aperta, una scheda porta quello in cache per l'host, cioè della sorella.
  await expect.poll(async () => Object.fromEntries((await webTabs()).map((t) => [t.title, t.identityColor])), {
    timeout: 15_000, message: 'le cinque schede non hanno ancora il loro colore identità',
  }).toEqual(Object.fromEntries(SCHEDE.map(([titolo, , identita]) => [titolo, identita])));

  await submit(dash, '/riordina');
  await expect.poll(async () => (await webTabs()).map((t) => t.title), { timeout: 15_000 })
    .toEqual(['Bianco', 'Rosso', 'Blu', 'Nero', 'Senza']);
}

test('"/riordina": il bianco in testa, il nero in fondo ai colori, senza favicon in coda', async ({ shell, openTab, testServer }) => {
  await riordinaBiancoNeroEColori({ shell, openTab, testServer });
});

test('"/riordina" con saturazione_tab a 0: le schede grigie a schermo restano in ordine di tinta', async ({ shell, openTab, testServer }) => {
  await shell.evaluate((st) => window.filoShell.message({ type: 'update_settings', settings: st }), { tabColor: { saturazione_tab: 0 } });
  await riordinaBiancoNeroEColori({ shell, openTab, testServer });
});
