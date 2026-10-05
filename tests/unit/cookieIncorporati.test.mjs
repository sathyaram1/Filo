// #758 — le decisioni sui cookie dei contenuti incorporati di terzi: chi si declassa a solo-di-sessione, quando si
// cancella, quando un cookie dice che l'utente è entrato con un account.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const R = require(join(__dirname, '..', '..', 'src', 'main', 'services', 'cookieIncorporatiRegole.js'));

const S = (...v) => new Set(v);

test('il cookie di un riquadro di terze parti si declassa; il sito della scheda mai', () => {
  const base = { modo: 'default', aperti: S('articolo.it'), protetti: S() };
  // instagram.com dentro articolo.it, dove l'utente non è entrato: dura la visita.
  assert.equal(R.daDeclassare({ ...base, sito: 'instagram.com', ospiti: S('articolo.it') }), true);
  // il sito della pagina che ospita: i suoi cookie sono suoi.
  assert.equal(R.daDeclassare({ ...base, sito: 'articolo.it', ospiti: S('articolo.it') }), false);
  // lo stesso sito aperto in una scheda sua: non si tocca nemmeno quando compare incorporato altrove.
  assert.equal(R.daDeclassare({ ...base, aperti: S('articolo.it', 'instagram.com'), sito: 'instagram.com', ospiti: S('articolo.it') }), false);
});

test('i siti con accesso e i «resta connesso» non si declassano; in Manuale e Privacy non si fa niente', () => {
  const v = { sito: 'instagram.com', ospiti: S('articolo.it'), aperti: S('articolo.it') };
  assert.equal(R.daDeclassare({ ...v, modo: 'default', protetti: S('instagram.com') }), false);
  assert.equal(R.daDeclassare({ ...v, modo: 'manual', protetti: S() }), false);
  assert.equal(R.daDeclassare({ ...v, modo: 'privacy', protetti: S() }), false);
  // senza un ospite non c'è niente da declassare: il cookie non è nato in un riquadro.
  assert.equal(R.daDeclassare({ ...v, modo: 'default', protetti: S(), ospiti: S() }), false);
});

test('i cookie del riquadro se ne vanno quando nessuna scheda ospita più il sito, passato il margine', () => {
  const voce = { sito: 'instagram.com', ospiti: S('articolo.it'), nomi: S('mid'), chiusoDa: 0 };
  const stato = (aperti, ora) => ({ aperti, protetti: S(), ora, margine: 60_000 });
  // finché l'articolo è aperto non si cancella niente.
  assert.deepEqual(R.esitoVoce(voce, stato(S('articolo.it'), 1_000)), { azione: 'aspetta', chiusoDa: 0 });
  // chiuso l'articolo parte il margine.
  const primo = R.esitoVoce(voce, stato(S(), 10_000));
  assert.deepEqual(primo, { azione: 'aspetta', chiusoDa: 10_000 });
  voce.chiusoDa = primo.chiusoDa;
  assert.equal(R.esitoVoce(voce, stato(S(), 60_000)).azione, 'aspetta');
  assert.equal(R.esitoVoce(voce, stato(S(), 70_000)).azione, 'cancella');
  // riaperto l'articolo il margine si azzera: chi torna sulla pagina ritrova il riquadro come l'aveva lasciato.
  assert.deepEqual(R.esitoVoce(voce, stato(S('articolo.it'), 65_000)), { azione: 'aspetta', chiusoDa: 0 });
  // il sito stesso aperto in una scheda vale come ospite.
  assert.equal(R.esitoVoce(voce, stato(S('instagram.com'), 70_000)).azione, 'aspetta');
  // entrato nel frattempo con un account: non c'è più niente da cancellare.
  assert.equal(R.esitoVoce(voce, { aperti: S(), protetti: S('instagram.com'), ora: 70_000, margine: 60_000 }).azione, 'dimentica');
});

test('un cookie di sessione nuovo dopo la pagina di accesso dice che l\'utente è entrato', () => {
  const prima = new Map([['sessionid', 'vecchio'], ['csrftoken', 'abc']]);
  assert.equal(R.segnaleDiAccesso({ name: 'sessionid', value: 'nuovo' }, prima), true);
  assert.equal(R.segnaleDiAccesso({ name: 'ds_user_id', value: '42' }, prima), true);
  // lo stesso cookie con lo stesso valore: era già lì, nessuno è entrato adesso.
  assert.equal(R.segnaleDiAccesso({ name: 'sessionid', value: 'vecchio' }, prima), false);
  // i cookie anti-falsificazione, di consenso e di statistica cambiano anche per un visitatore.
  assert.equal(R.segnaleDiAccesso({ name: 'csrftoken', value: 'nuovo' }, prima), false);
  assert.equal(R.segnaleDiAccesso({ name: 'cookieconsent', value: 'si' }, prima), false);
  assert.equal(R.segnaleDiAccesso({ name: '_ga', value: 'x' }, prima), false);
  // un cookie del server dal nome qualunque conta solo se la pagina chiedeva una password.
  assert.equal(R.segnaleDiAccesso({ name: 'xs', value: '1', httpOnly: true }, prima), false);
  assert.equal(R.segnaleDiAccesso({ name: 'xs', value: '1', httpOnly: true }, prima, { forte: true }), true);
  assert.equal(R.segnaleDiAccesso({ name: 'ab_test', value: '1' }, prima, { forte: true }), false);
  assert.equal(R.segnaleDiAccesso({ name: '', value: '1' }, prima, { forte: true }), false);
});

test('i nomi dei cookie di accesso dei siti veri sono riconosciuti, i tecnici no', () => {
  for (const n of ['sessionid', 'SID', 'auth_token', 'c_user', 'remember_web_1', 'jwt', 'access_token', 'li_at_oauth']) {
    assert.equal(R.nomeDiAccesso(n), true, n);
  }
  for (const n of ['_ga', '_gid', 'ct0csrf', '__cf_bm', 'cf_clearance', '_fbp', 'euconsent-v2', '__utma', '']) {
    assert.equal(R.nomeDiAccesso(n), false, n);
  }
});

test('solo l\'invio di un accesso apre la finestra in cui un cookie nuovo vale come accesso, non la pagina vista', () => {
  const scritte = { credenziali: true };
  // una scrittura verso il sito dopo una password scritta dall'utente.
  assert.equal(R.richiestaDiAccesso({ method: 'POST', url: 'https://x.it/login', resourceType: 'mainFrame' }, scritte), true);
  assert.equal(R.richiestaDiAccesso({ method: 'put', url: 'https://x.it/api/session', resourceType: 'xhr' }, scritte), true);
  // la stessa scrittura senza password scritta: le statistiche in POST di una home col modulo d'accesso.
  assert.equal(R.richiestaDiAccesso({ method: 'POST', url: 'https://x.it/log', resourceType: 'xhr' }), false);
  assert.equal(R.richiestaDiAccesso({ method: 'POST', url: 'https://x.it/log', resourceType: 'ping' }, { credenziali: false }), false);
  // il ritorno da «Continua con…» e il link d'accesso via email: pagine aperte, non richieste della pagina.
  assert.equal(R.richiestaDiAccesso({ method: 'GET', url: 'https://x.it/cb?code=1&state=2', resourceType: 'mainFrame' }), true);
  assert.equal(R.richiestaDiAccesso({ method: 'GET', url: 'https://x.it/auth/verify?token=abc', resourceType: 'mainFrame' }), true);
  assert.equal(R.richiestaDiAccesso({ method: 'GET', url: 'https://x.it/api/feed?token=abc', resourceType: 'xhr' }), false);
  // la pagina d'accesso aperta, o una richiesta della pagina, senza invio: nessun accesso.
  assert.equal(R.richiestaDiAccesso({ method: 'GET', url: 'https://x.it/login', resourceType: 'mainFrame' }, scritte), false);
  assert.equal(R.richiestaDiAccesso({ method: 'GET', url: 'https://x.it/visita', resourceType: 'xhr' }), false);
  assert.equal(R.richiestaDiAccesso({ method: 'OPTIONS', url: 'https://x.it/login' }, scritte), false);
  assert.equal(R.richiestaDiAccesso({ method: 'GET', url: 'https://x.it/?code=1', resourceType: 'mainFrame' }), false);
  assert.equal(R.richiestaDiAccesso({}), false);
});


test('un Set-Cookie partizionato con scadenza futura si riconosce; una cancellazione o un cookie già di sessione no', () => {
  const ora = Date.parse('2026-10-05T12:00:00Z');
  assert.equal(R.nomePartizionatoConScadenza('chips=1; Max-Age=3600; Path=/; SameSite=None; Secure; Partitioned', ora), 'chips');
  assert.equal(R.nomePartizionatoConScadenza('id=a=b; Secure; partitioned; Expires=Wed, 21 Oct 2027 07:28:00 GMT', ora), 'id');
  // una scadenza passata o un Max-Age a zero cancellano il cookie: toglierla lo farebbe rinascere.
  assert.equal(R.nomePartizionatoConScadenza('chips=; Max-Age=0; Secure; Partitioned', ora), null);
  assert.equal(R.nomePartizionatoConScadenza('chips=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; Partitioned', ora), null);
  assert.equal(R.nomePartizionatoConScadenza('chips=1; Secure; Partitioned', ora), null);
  // non partizionato: lo declassa l'ascolto dei cookie, non l'intestazione.
  assert.equal(R.nomePartizionatoConScadenza('mid=1; Max-Age=3600; Secure; SameSite=None', ora), null);
  assert.equal(R.nomePartizionatoConScadenza('partitioned=1; Max-Age=3600', ora), null);
  assert.equal(R.nomePartizionatoConScadenza('', ora), null);
});
