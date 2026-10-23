// #1506 — il confine fra i siti e le pagine di Filo: una scheda del web o la finestrella di accesso non arrivano su
// un filo:// (tranne la home nuda), e un mittente che non ha una vista di Filo non vale come Filo anche su un filo://.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { navigazioneVersoFilo, paginaDeiBloccati } = require('../../src/main/services/navigazioneVersoFilo.js');
const { daFilo, vistaInterna, origineDi, filoNegatoAllaPagina } = require('../../src/main/services/handlers/origine.js');
const { avvisoIndirizzoFermato } = require('../../src/main/services/indirizzoFermato.js');

const PAGINA_ERRORE = 'filo://error/error.html?url=https%3A%2F%2Fbanca.example%2F&code=-105&desc=Chiama+il+numero+verde';

test('da una scheda del web le pagine di Filo si fermano, anche la pagina d’errore coi parametri del sito', () => {
  for (const u of ['filo://options/', 'filo://options/options.html#avanzate', PAGINA_ERRORE, 'FILO://OPTIONS/', 'filo:options', 'filo://security/security.html']) {
    assert.equal(navigazioneVersoFilo(u, { interna: false }), true, u);
  }
});

test('dalla finestrella vale lo stesso: senza dire niente la vista non è di Filo', () => {
  assert.equal(navigazioneVersoFilo('filo://options/'), true);
  assert.equal(navigazioneVersoFilo(PAGINA_ERRORE), true);
});

test('la finestrella non arriva nemmeno sulla home nuda: lì non diventerebbe mai una home vera', () => {
  assert.equal(navigazioneVersoFilo('filo://newtab/', { finestrella: true }), true);
  assert.equal(navigazioneVersoFilo('filo://options/', { finestrella: true }), true);
  assert.equal(navigazioneVersoFilo('https://accounts.google.com/', { finestrella: true }), false);
});

test('la home nuda resta raggiungibile, ma non coi parametri che legge', () => {
  assert.equal(navigazioneVersoFilo('filo://newtab/', { interna: false }), false);
  assert.equal(navigazioneVersoFilo('filo://newtab', { interna: false }), false);
  assert.equal(navigazioneVersoFilo('filo://newtab/?chat=abc', { interna: false }), true);
  assert.equal(navigazioneVersoFilo('filo://newtab/#evento', { interna: false }), true);
  assert.equal(navigazioneVersoFilo('filo://newtab/dashboard.html', { interna: false }), true);
});

test('da una scheda di Filo ogni filo:// passa, e gli altri schemi non sono affar suo', () => {
  assert.equal(navigazioneVersoFilo('filo://options/', { interna: true }), false);
  assert.equal(navigazioneVersoFilo(PAGINA_ERRORE, { interna: true }), false);
  for (const u of ['https://sito.example/', 'http://127.0.0.1:8080/x', 'about:blank', 'mailto:a@b.it', '', null, 'non un indirizzo']) {
    assert.equal(navigazioneVersoFilo(u, { interna: false }), false, String(u));
  }
});

test('«Gestisci i siti bloccati» è solo la pagina della sicurezza, senza parametri', () => {
  assert.equal(paginaDeiBloccati('filo://security/security.html'), true);
  assert.equal(paginaDeiBloccati('filo://security/'), true);
  assert.equal(paginaDeiBloccati('filo://security/security.html?da=sito'), false);
  assert.equal(paginaDeiBloccati('filo://security/altro.html'), false);
  assert.equal(paginaDeiBloccati('filo://options/'), false);
  assert.equal(paginaDeiBloccati('https://security/security.html'), false);
});

test('la vista decide se un mittente è Filo, non l’indirizzo', () => {
  assert.equal(vistaInterna({ isShell: true }), true);
  assert.equal(vistaInterna({ riserva: true, tab: { id: 'r' } }), true);
  assert.equal(vistaInterna({ tab: { isInternal: true } }), true);
  assert.equal(vistaInterna({ tab: { isInternal: false } }), false);
  assert.equal(vistaInterna({ tab: null }), false);
  assert.equal(vistaInterna({ tab: null, segnata: true }), true);
});

test('un mittente senza scheda, che non è la barra, su un filo:// non vale come Filo', () => {
  const finestrella = { tab: null, url: 'filo://options/options.html', isShell: false, interna: vistaInterna({ tab: null }) };
  assert.equal(origineDi(finestrella), '');
  assert.equal(daFilo(origineDi(finestrella), finestrella), false);
  // Anche se un servizio si calcola l'origine da solo dall'indirizzo.
  assert.equal(daFilo('filo://options/options.html', finestrella), false);

  const webSuErrore = { tab: { url: 'https://banca.example/' }, url: PAGINA_ERRORE, interna: false };
  assert.equal(origineDi(webSuErrore), 'https://banca.example/');
  assert.equal(daFilo(PAGINA_ERRORE, webSuErrore), false);

  const schedaInterna = { tab: { url: 'filo://options/options.html' }, url: 'filo://options/options.html', interna: true };
  assert.equal(origineDi(schedaInterna), 'filo://options/options.html');
  assert.equal(daFilo(origineDi(schedaInterna), schedaInterna), true);

  const barra = { tab: null, url: 'filo://shell/shell.html', isShell: true, interna: true };
  assert.equal(daFilo(origineDi(barra), barra), true);
  // Un mittente costruito a mano dal main (senza `interna`) resta com'era.
  assert.equal(daFilo(origineDi({ url: 'filo://menu/' }), { url: 'filo://menu/' }), true);
});

test('un sito apre una pagina di Filo dai canali solo col clic dell’utente', () => {
  const sito = (gesto) => ({ tab: { url: 'https://sito.example/' }, url: 'https://sito.example/', interna: false, wc: gesto ? { _filoGestoUiAlle: Date.now() } : {} });
  assert.equal(filoNegatoAllaPagina('filo://options/', sito(false), 'https://sito.example/'), true);
  assert.equal(filoNegatoAllaPagina(PAGINA_ERRORE, sito(false), 'https://sito.example/'), true);
  assert.equal(filoNegatoAllaPagina('filo://options/', sito(true), 'https://sito.example/'), false);
  assert.equal(filoNegatoAllaPagina('filo://newtab/', sito(false), 'https://sito.example/'), false);
  assert.equal(filoNegatoAllaPagina(undefined, sito(false), 'https://sito.example/'), false);
  assert.equal(filoNegatoAllaPagina('https://altro.example/', sito(false), 'https://sito.example/'), false);
  const dopoIlServer = { ...sito(false), wc: { _filoGestoAlle: Date.now() - 10_000 } };
  assert.equal(filoNegatoAllaPagina('filo://redteam/redteam.html?attempt=x', dopoIlServer, 'https://sito.example/'), false);
  const vecchio = { ...sito(false), wc: { _filoGestoAlle: Date.now() - 60_000 } };
  assert.equal(filoNegatoAllaPagina('filo://options/', vecchio, 'https://sito.example/'), true);
  const home = { tab: { url: 'filo://newtab/' }, url: 'filo://newtab/', interna: true, wc: {} };
  assert.equal(filoNegatoAllaPagina('filo://options/', home, 'filo://newtab/'), false);
});

test('la notifica di una pagina di Filo fermata dice cosa è successo', () => {
  assert.equal(avvisoIndirizzoFermato('filo://options/options.html').testo, 'Un sito non può aprire le pagine di Filo');
});
