// #760 — il riquadro di terzi rotto dai cookie: quando le regole bastano, quando si chiede al modello, come si legge
// la sua risposta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const R = require(join(__dirname, '..', '..', 'src', 'main', 'services', 'riquadriRottiRegole.js'));

test('il segnaposto noto di un servizio si riconosce a regole, col nome del servizio', () => {
  assert.deepEqual(R.riconosci({ host: 'www.instagram.com', testo: 'Log in to see photos and videos from friends.' }), { nome: 'Instagram', via: 'regola' });
  assert.deepEqual(R.riconosci({ host: 'platform.twitter.com', testo: 'Something went wrong, but don’t fret — let’s give it another shot.' }), { nome: 'X', via: 'regola' });
  assert.deepEqual(R.riconosci({ host: 'www.youtube-nocookie.com', testo: 'Accedi per confermare che non sei un bot' }), { nome: 'YouTube', via: 'regola' });
  assert.equal(R.riconosci({ host: 'disqus.com', testo: 'We were unable to load Disqus.' }).nome, 'Disqus');
});

test('la frase che chiede i cookie vale per qualunque riquadro, anche di un servizio che Filo non conosce', () => {
  assert.deepEqual(R.riconosci({ host: 'embed.sconosciuto.io', testo: 'Per vedere il contenuto attiva i cookie.' }), { nome: null, via: 'regola' });
  assert.ok(R.riconosci({ host: 'player.esempio.de', testo: 'Bitte Cookies aktivieren' }));
  assert.ok(R.riconosci({ host: 'x.example', testo: 'Please enable third-party cookies to continue' }));
});

test('un riquadro che funziona non si riconosce: il testo di un post qualunque, o il segnaposto di un altro servizio', () => {
  assert.equal(R.riconosci({ host: 'www.instagram.com', testo: 'Foto di gattini al mare, 120 like' }), null);
  // «Log in to see» su un dominio che non è Instagram non è il segnaposto di Instagram.
  assert.equal(R.riconosci({ host: 'www.esempio.it', testo: 'Log in to see more' }), null);
  assert.equal(R.riconosci({ host: 'www.instagram.com', testo: '' }), null);
});

test('google.com conta come Google Maps solo sull\'indirizzo delle mappe', () => {
  assert.equal(R.servizioDi('www.google.com', '/maps/embed?pb=1').nome, 'Google Maps');
  assert.equal(R.servizioDi('maps.google.com', '/').nome, 'Google Maps');
  assert.equal(R.servizioDi('accounts.google.com', '/signin'), null);
  assert.equal(R.riconosci({ host: 'accounts.google.com', percorso: '/signin', testo: 'Sign in to continue' }), null);
});

test('il modello si chiama solo per un riquadro che sembra rotto: vuoto, errore, invito ad accedere', () => {
  const misura = { larghezza: 500, altezza: 400 };
  assert.equal(R.sembraRotto({ ...misura, testo: '', media: 0 }), true);
  assert.equal(R.sembraRotto({ ...misura, testo: 'Errore: contenuto non disponibile', media: 0 }), true);
  assert.equal(R.sembraRotto({ ...misura, testo: 'Accedi per continuare', media: 0 }), true);
  assert.equal(R.sembraRotto({ ...misura, testo: 'Accedi', media: 0, password: true }), true);
});

test('un riquadro che funziona, una pubblicità o un pixel invisibile non arrivano al modello', () => {
  const misura = { larghezza: 500, altezza: 400 };
  // Contenuto vero con un «Accedi» accanto: funziona.
  assert.equal(R.sembraRotto({ ...misura, testo: 'Accedi · Il mio post sulle vacanze', media: 2 }), false);
  // Un articolo lungo che nomina un errore funziona.
  const lungo = Array.from({ length: 120 }, (_, i) => `parola${i}`).join(' ') + ' error';
  assert.equal(R.sembraRotto({ ...misura, testo: lungo, media: 0 }), false);
  // Formati delle pubblicità e riquadri troppo piccoli.
  assert.equal(R.sembraRotto({ larghezza: 300, altezza: 250, testo: '', media: 0 }), false);
  assert.equal(R.sembraRotto({ larghezza: 728, altezza: 90, testo: '', media: 0 }), false);
  assert.equal(R.sembraRotto({ larghezza: 1, altezza: 1, testo: '', media: 0 }), false);
  // Un video che si vede.
  assert.equal(R.sembraRotto({ ...misura, testo: '', media: 1 }), false);
});

test('la domanda al modello porta l\'immagine del riquadro e il sito che dice il main', () => {
  const m = R.messaggi({ immagine: 'data:image/jpeg;base64,AAA', sito: 'spotify.com' });
  const u = m.find((x) => x.role === 'user');
  assert.ok(u.content.some((p) => p.type === 'image_url' && p.image_url.url === 'data:image/jpeg;base64,AAA'));
  assert.ok(u.content.some((p) => p.type === 'text' && p.text.includes('spotify.com')));
});

test('la risposta del modello: solo il formato chiesto; il nome si mostra solo se il sito lo conferma', () => {
  assert.deepEqual(R.leggiRisposta('{"rotto": true, "servizio": "Spotify"}', 'spotify.com'), { rotto: true, nome: 'Spotify' });
  assert.deepEqual(R.leggiRisposta('Ecco: {"rotto": false, "servizio": "Spotify"}', 'spotify.com'), { rotto: false, nome: 'Spotify' });
  // Un nome che il sito non conferma (o un testo scritto dal riquadro) lascia il posto al nome del sito.
  assert.deepEqual(R.leggiRisposta('{"rotto": true, "servizio": "La tua banca"}', 'esempio.io'), { rotto: true, nome: 'esempio.io' });
  assert.equal(R.leggiRisposta('{"rotto": true, "servizio": "<b>x</b>"}', 'x.io').nome, 'x.io');
  // Fuori formato: «non so», e non si mostra niente.
  assert.equal(R.leggiRisposta('sì, è rotto', 'esempio.io'), null);
  assert.equal(R.leggiRisposta('{"rotto": "sì"}', 'esempio.io'), null);
  assert.equal(R.leggiRisposta('', 'esempio.io'), null);
});
