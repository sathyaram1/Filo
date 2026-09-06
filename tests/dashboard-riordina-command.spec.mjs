// Feedback alpha #350: «aggiungi il comando /riordina che riordina tutte le tab
// (come se fosse stato chiuso e riaperto Filo)». Nuovo comando slash della
// dashboard che riordina la striscia per colore (§1.3, lo stesso riordino della
// riapertura di Filo) SENZA archiviare/chiudere nulla — a differenza di /pulisci.
//
// Sei garanzie, tutte ASSERISCONO il successo:
//   1) "/riordina" è classificato come comando Filo (arancione), non
//      shell/sconosciuto;
//   2) inviato dalla nuova scheda, riordina davvero le tab web per tinta
//      lasciandole TUTTE aperte (nessuna archiviazione);
//   3) con una scheda sola risponde "già in ordine" invece di tacere;
//   4) la scheda su cui eri resta quella attiva anche dopo il riordino;
//   5) riordinare due volte di fila: la seconda è un non-fare, e lo dice;
//   6) "/riordina" con parole in più resta un comando riconosciuto.
//
// I casi 3-6 stavano in uno spec a parte, nato per una verifica e finito nel
// repo per sbaglio: cancellandolo sono spariti quattro controlli che nessun
// altro test rifà. Stanno qui perché è qui che si va a cercarli.

import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

const mk = (title, color) =>
  `<!doctype html><html><head><title>${title}</title>`
  + `${color ? `<meta name="theme-color" content="${color}">` : ''}</head>`
  + `<body style="margin:0"><div style="height:1200px;background:#fff"></div></body></html>`;

// Replica di hueOf del main per calcolare l'ordine cromatico atteso dai colori
// REALI assegnati dall'app.
function hueOf(rgbStr) {
  const m = /rgba?\(([^)]+)\)/.exec(rgbStr || '');
  if (!m) return Infinity;
  const p = m[1].split(',').map((s) => parseFloat(s.trim()));
  if (p.length < 3 || p.some((n) => Number.isNaN(n))) return Infinity;
  const r = p[0] / 255, g = p[1] / 255, b = p[2] / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx === mn) return Infinity;
  const d = mx - mn;
  let h;
  if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h / 6) * 360;
}

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

  // La nuova scheda da cui invieremo il comando (pagina interna: hue Infinity,
  // resta in coda al riordino, non disturba l'ordine delle tab web).
  const dash = await openTab(NEWTAB);
  await expect(dash.locator('#input')).toBeVisible({ timeout: 8_000 });

  // Attendi che tutte e tre le web tab abbiano colore identità E titolo reale:
  // un tab appena creato riporta per un attimo "Nuova scheda" prima che il suo
  // <title> raggiunga la barra — aspettarlo evita che lo snapshot catturi un
  // titolo transitorio.
  await expect.poll(async () => shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    const web = s.tabs.filter((t) => /127\.0\.0\.1/.test(t.url || ''));
    const titles = web.map((t) => t.title).sort();
    return web.length === 3
      && web.every((t) => !!t.identityColor)
      && JSON.stringify(titles) === JSON.stringify(['Blu', 'Rosso', 'Verde']);
  }), { timeout: 12_000 }).toBe(true);

  const before = await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    return s.tabs.filter((t) => /127\.0\.0\.1/.test(t.url || ''))
      .map((t) => ({ title: t.title, identityColor: t.identityColor }));
  });
  const insertionOrder = before.map((t) => t.title);
  const expectedOrder = [...before]
    .sort((a, b) => hueOf(a.identityColor) - hueOf(b.identityColor))
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
async function schedePronte(shell) {
  await expect.poll(async () => shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    const web = s.tabs.filter((t) => /127\.0\.0\.1/.test(t.url || ''));
    const titoli = web.map((t) => t.title).sort();
    return web.length === 3
      && web.every((t) => !!t.identityColor)
      && JSON.stringify(titoli) === JSON.stringify(['Blu', 'Rosso', 'Verde']);
  }), { timeout: 12_000 }).toBe(true);
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
  await coloriPronti(shell);
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
  await coloriPronti(shell);

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
