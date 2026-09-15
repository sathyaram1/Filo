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
// I casi sotto sono indirizzi veri di siti comuni. Quelli che il quinto giro
// aveva marcato RILIEVO — l'indirizzo perso pur non contenendo nessuna persona
// — sono stati CORRETTI: qui adesso l'attesa è il comportamento giusto, e
// tornare alla regola di prima li fa diventare rossi.
//
// Cos'è cambiato: la regola generale non tiene più i soli segmenti fatti di
// sole lettere (per addizione), ma toglie le FORME che identificano — email,
// IBAN, codici fiscali, numeri lunghi, esadecimali, UUID, token misti, cifre da
// cinque in su. I nomi scritti a lettere restano coperti dalle altre due
// regole, che non sono cambiate: la parola che annuncia una persona e il primo
// pezzo sui siti dove lì ci va sempre qualcuno — a meno che non sia una sezione
// pubblica riconoscibile.

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

test('le sezioni pubbliche dei siti «col nome in testa» non sono nomi utente', async ({ app }) => {
  // Nessuno di questi primi pezzi è una persona: sono le sezioni del sito, e
  // sono proprio i punti da cui una sessione di aiuto parte più spesso. Prima
  // uscivano tutti come «/[ID]», cioè identici e inservibili.
  expect(await ripulisci(app, 'https://github.com/settings/security')).toBe('/settings/security');
  expect(await ripulisci(app, 'https://github.com/notifications')).toBe('/notifications');
  expect(await ripulisci(app, 'https://x.com/explore')).toBe('/explore');
  expect(await ripulisci(app, 'https://twitch.tv/directory/gaming')).toBe('/directory/gaming');
  // e il nome utente in testa resta un nome utente
  expect(await ripulisci(app, 'https://github.com/mariorossi/progetto')).toBe('/[ID]/progetto');
});

test('il nome di una pagina con estensione non dice chi sei: resta', async ({ app }) => {
  expect(await ripulisci(app, 'https://www.comune.milano.it/servizi/carta-identita.html')).toBe('/servizi/carta-identita.html');
  expect(await ripulisci(app, 'https://www.unicredit.it/it/privati/conti-e-carte.html')).toBe('/it/privati/conti-e-carte.html');
  expect(await ripulisci(app, 'https://www.trenitalia.com/it/biglietti-e-abbonamenti.html')).toBe('/it/biglietti-e-abbonamenti.html');
  expect(await ripulisci(app, 'https://www.booking.com/mybooking.it.html')).toBe('/mybooking.it.html');
});

test('una cifra o un trattino basso non cancellano un pezzo, e «/c/» sui negozi è la categoria', async ({ app }) => {
  expect(await ripulisci(app, 'https://outlook.live.com/mail/0/inbox')).toBe('/mail/0/inbox');
  expect(await ripulisci(app, 'https://dashboard.stripe.com/settings/user_settings')).toBe('/settings/user_settings');
  expect(await ripulisci(app, 'https://shop.example.com/v2/user_settings')).toBe('/v2/user_settings');
  // Sui negozi `/c/` è la categoria, ed è esattamente il punto di partenza
  // utile; resta un marcatore di persona solo sui siti di video, dove indica
  // il canale di qualcuno.
  expect(await ripulisci(app, 'https://www.zalando.it/c/scarpe-donna/')).toBe('/c/scarpe-donna/');
  expect(await ripulisci(app, 'https://www.youtube.com/c/MarioRossi/videos')).toBe('/c/[ID]/videos');
});

test('e quello che resta basta a distinguere due percorsi dello stesso sito, dentro il prompt', async ({ app }) => {
  const testo = await app.evaluate(() => globalThis.SN_PATHS_SAFETY.formatKnownPathsForPrompt([
    { domain: 'github.com', initialUrl: '/settings/security', intent: 'disattivare le notifiche', steps: [{ selector: '#a', action: 'click' }] },
    { domain: 'github.com', initialUrl: '/notifications', intent: 'cambiare la password', steps: [{ selector: '#b', action: 'click' }] },
  ]));
  // Due percorsi che partono da due pagine diverse dello stesso sito arrivano
  // all'assistente con due provenienze diverse: prima erano tutti «da /[ID]» e
  // non aveva più niente con cui scegliere fra i due.
  expect(testo).toContain('(da /settings/security)');
  expect(testo).toContain('(da /notifications)');
});

test('e il numero di conto resta fuori: quella è una forma, e si toglie', async ({ app }) => {
  expect(await ripulisci(app, 'https://negozio.it/ordini/847362')).toBe('/ordini/[NUMERO]');
  expect(await ripulisci(app, 'https://sito.it/ordine/9f2c1b7a4e5d6c8b9a0f1e2d')).toBe('/ordine/[ID]');
  expect(await ripulisci(app, 'https://sito.it/messaggi/mario.rossi@posta.it')).toBe('/messaggi/[EMAIL]');
});
