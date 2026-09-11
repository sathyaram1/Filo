// Verifica #584, giro 5 — quanto resta della pagina di partenza, dopo la
// pulizia.
//
// La pulizia dell'indirizzo è il pezzo che ha chiuso il rilievo grave del terzo
// giro: un nome utente dentro l'indirizzo rimetteva insieme i percorsi della
// stessa persona. La regola che lo chiude tiene solo i segmenti che sono
// PAROLE (lettere ed eventuali trattini, fino a quaranta caratteri) e sui siti
// dove il primo pezzo è sempre una persona butta via il primo pezzo comunque.
//
// Qui si guarda l'altro lato: cosa resta, a chi legge, di «da che punto del
// sito si parte». Un percorso condiviso serve a questo, e l'indirizzo è l'unica
// cosa che lo dice — i passi dicono dove cliccare, non da dove partire.
//
// I casi sotto sono indirizzi veri di siti comuni, e fissano il comportamento
// di oggi. Quelli marcati RILIEVO perdono l'indirizzo pur non contenendo
// nessuna persona: sono il rilievo del quinto giro, non il comportamento
// desiderato. Quando verranno corretti questi casi diventeranno rossi, ed è
// giusto così: chi corregge aggiorna l'attesa.

import { test, expect } from '../../fixtures/electron.mjs';

// La pulizia sta nel processo principale: la si interroga lì, dove gira.
async function ripulisci(app, url) {
  return app.evaluate(
    (_e, u) => globalThis.SN_PATHS_COLLECTOR._internal.normalizedPath(u),
    url,
  );
}

test('gli indirizzi che contengono una persona escono senza: la difesa del terzo giro tiene', async ({ app }) => {
  const casi = [
    ['https://negozio.it/u/mario.rossi/ordini/847362', 'mario'],
    ['https://github.com/mariorossi/progetto', 'mariorossi'],
    ['https://x.com/mariorossi', 'mariorossi'],
    ['https://www.linkedin.com/in/mario-rossi', 'mario'],
    ['https://sito.it/clienti/MarioRossi/fatture', 'MarioRossi'],
    ['https://sito.it/utente/anna.bianchi/impostazioni', 'anna'],
  ];
  for (const [url, nome] of casi) {
    const out = await ripulisci(app, url);
    expect(out.toLowerCase()).not.toContain(nome.toLowerCase());
  }
});

test('gli indirizzi senza nessuna persona restano leggibili', async ({ app }) => {
  const casi = [
    ['https://www.amazon.it/gp/css/order-history', '/gp/css/order-history'],
    ['https://www.poste.it/area-personale/spedizioni', '/area-personale/spedizioni'],
    ['https://www.ikea.com/it/it/customer-service/returns-claims/', '/it/it/customer-service/returns-claims/'],
    ['https://www.spotify.com/it/account/subscription/', '/it/account/subscription/'],
  ];
  for (const [url, atteso] of casi) {
    expect(await ripulisci(app, url)).toBe(atteso);
  }
});

test('RILIEVO: sui trenta siti «col nome in testa» il primo pezzo sparisce anche quando è una sezione pubblica', async ({ app }) => {
  // Nessuno di questi primi pezzi è una persona: sono le sezioni del sito, e
  // sono proprio i punti da cui una sessione di aiuto parte più spesso.
  expect(await ripulisci(app, 'https://github.com/settings/security')).toBe('/[ID]/security');
  expect(await ripulisci(app, 'https://github.com/notifications')).toBe('/[ID]');
  expect(await ripulisci(app, 'https://x.com/explore')).toBe('/[ID]');
  expect(await ripulisci(app, 'https://www.instagram.com/accounts/edit/')).toBe('/[ID]/edit/');
  expect(await ripulisci(app, 'https://twitch.tv/directory/gaming')).toBe('/[ID]/gaming');
});

test('RILIEVO: il nome di una pagina con estensione sparisce, perché ha un punto dentro', async ({ app }) => {
  expect(await ripulisci(app, 'https://www.comune.milano.it/servizi/carta-identita.html')).toBe('/servizi/[ID]');
  expect(await ripulisci(app, 'https://www.unicredit.it/it/privati/conti-e-carte.html')).toBe('/it/privati/[ID]');
  expect(await ripulisci(app, 'https://www.trenitalia.com/it/biglietti-e-abbonamenti.html')).toBe('/it/[ID]');
  expect(await ripulisci(app, 'https://www.booking.com/mybooking.it.html')).toBe('/[ID]');
});

test('RILIEVO: una cifra o un trattino basso in un pezzo lo cancellano, e «/c/» tratta la categoria come una persona', async ({ app }) => {
  expect(await ripulisci(app, 'https://outlook.live.com/mail/0/inbox')).toBe('/mail/[ID]/inbox');
  expect(await ripulisci(app, 'https://dashboard.stripe.com/settings/user_settings')).toBe('/settings/[ID]');
  expect(await ripulisci(app, 'https://shop.example.com/v2/user_settings')).toBe('/[ID]/[ID]');
  // `c` sta fra i marcatori di persona per via dei canali; sui negozi è la
  // categoria, e la categoria è esattamente il punto di partenza utile.
  expect(await ripulisci(app, 'https://www.zalando.it/c/scarpe-donna/')).toBe('/c/[ID]/');
});

test('RILIEVO: e all’assistente l’indirizzo arriva così, dentro il prompt', async ({ app }) => {
  const testo = await app.evaluate(() => globalThis.SN_PATHS.formatForPrompt([
    { initialUrl: '/[ID]', intent: 'disattivare le notifiche', steps: [{ selector: '#a', action: 'click' }] },
    { initialUrl: '/[ID]', intent: 'cambiare la password', steps: [{ selector: '#b', action: 'click' }] },
  ]));
  // Due percorsi che partono da due pagine diverse dello stesso sito si
  // presentano all'assistente con la stessa provenienza: «da /[ID]».
  expect((testo.match(/da \/\[ID\]\)/g) || []).length).toBe(2);
});
