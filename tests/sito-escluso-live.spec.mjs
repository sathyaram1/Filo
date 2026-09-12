// Spegnere Filo su un sito vale subito, anche sulle schede già aperte.
//
// «Domini esclusi» (Opzioni → Altro) è l'interruttore con cui l'utente dice
// «qui Filo non lo voglio». La decisione la prende il codice che gira dentro la
// pagina, e la prendeva una volta sola, al caricamento: chi escludeva un sito
// mentre la scheda su quel sito era aperta non vedeva succedere niente — tasto
// destro, menu di Filo, tutto ancora lì — finché non ricaricava. E, al
// contrario, una scheda aperta su un sito escluso restava spenta anche dopo
// averlo tolto dall'elenco.
//
// Qui si prova la cosa dal punto di vista dell'utente, sulla stessa scheda:
// escludo → il menu di Filo sparisce; tolgo l'esclusione → torna.
//
// Senza il fix il primo controllo è rosso (il menu resta) e il secondo pure
// (la pagina nata esclusa non si riaccende mai).

import { test, expect } from './fixtures/electron.mjs';

// Hostname vero risolto al loopback dal fixture: l'elenco dei domini esclusi
// scarta gli indirizzi numerici, quindi 127.0.0.1 non entrerebbe in lista.
const SITO = 'blocked.test';

const salva = (shell, settings) =>
  shell.evaluate((s) => window.filoShell.message({ type: 'update_settings', settings: s }), settings);

// Tasto destro sulla pagina: il menu di Filo compare?
const menuCompare = (page) => page.evaluate(async () => {
  for (const el of document.querySelectorAll('.sn-menu')) el.remove();
  document.body.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
  await new Promise((r) => setTimeout(r, 500));
  return !!document.querySelector('.sn-menu');
});

async function apriSulSito(openTab, testServer) {
  const url = testServer.html('<h1>pagina</h1><p>una frase qualsiasi</p>').replace('127.0.0.1', SITO);
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  return page;
}

test('escludere il sito spegne Filo sulla scheda già aperta, e toglierlo lo riaccende', async ({ shell, openTab, testServer }) => {
  await salva(shell, { blocklist: [] });
  const web = await apriSulSito(openTab, testServer);

  expect(await menuCompare(web), 'su un sito non escluso il menu di Filo deve comparire').toBe(true);

  await salva(shell, { blocklist: [SITO] });
  await expect.poll(() => menuCompare(web), { timeout: 8000 })
    .toBe(false);

  // Si può togliere ciò che si è aggiunto, e vale sempre sulla stessa scheda.
  await salva(shell, { blocklist: [] });
  await expect.poll(() => menuCompare(web), { timeout: 8000 })
    .toBe(true);
});

test('una scheda aperta su un sito già escluso si riaccende quando l\'utente lo toglie dall\'elenco', async ({ shell, openTab, testServer }) => {
  await salva(shell, { blocklist: [SITO] });
  const web = await apriSulSito(openTab, testServer);

  expect(await menuCompare(web), 'su un sito escluso il menu di Filo non deve comparire').toBe(false);

  await salva(shell, { blocklist: [] });
  await expect.poll(() => menuCompare(web), { timeout: 8000 })
    .toBe(true);
});

test('un sito escluso resta escluso anche dopo altri cambi di preferenze', async ({ shell, openTab, testServer }) => {
  await salva(shell, { blocklist: [SITO] });
  const web = await apriSulSito(openTab, testServer);
  expect(await menuCompare(web)).toBe(false);

  // Cambi che non c'entrano con l'elenco non devono riaccendere Filo lì.
  await salva(shell, { theme: 'dark' });
  await salva(shell, { themeTokens: { accent: '#1e90ff' } });
  await web.waitForTimeout(600);
  expect(await menuCompare(web), 'un cambio di tema non deve riaccendere Filo su un sito escluso').toBe(false);
});
