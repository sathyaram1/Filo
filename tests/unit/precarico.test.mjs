// Il precarico dei link (#1985): quali link partono, il tetto dei link a schermo e quando il main li ferma.
// Le regole stanno in src/shared/precarico.js; il comportamento nella pagina lo prova tests/precarico-link.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
require('../../src/shared/stessoSito.js');
const P = require('../../src/shared/precarico.js');

const PAGINA = 'https://www.esempio.it/notizie/oggi';
const motivo = (href, extra = {}) => P.motivoEscluso({ href, ...extra }, PAGINA);

test('un link dello stesso sito si precarica, anche da un altro sottodominio', () => {
  assert.equal(motivo('https://www.esempio.it/notizie/ieri'), '');
  assert.equal(motivo('https://blog.esempio.it/articolo'), '');
  assert.equal(motivo('https://www.esempio.it/notizie/ieri#commenti'), '');
});

test('verso un altro sito, o con un altro schema, non parte', () => {
  assert.equal(motivo('https://altro.it/pagina'), 'altro-sito');
  assert.equal(motivo('http://www.esempio.it/pagina'), 'altro-sito');
  // Due siti diversi sotto lo stesso suffisso pubblico.
  assert.equal(P.motivoEscluso({ href: 'https://bob.github.io/x' }, 'https://alice.github.io/'), 'altro-sito');
});

test('i link che fanno qualcosa non partono mai', () => {
  assert.equal(motivo('https://www.esempio.it/cerca?q=1'), 'query');
  assert.equal(motivo('https://www.esempio.it/cerca?'), 'query');
  assert.equal(motivo('javascript:void 0'), 'schema');
  assert.equal(motivo('mailto:a@esempio.it'), 'schema');
  assert.equal(motivo('https://www.esempio.it/notizie/oggi#sezione'), 'stessa-pagina');
  assert.equal(motivo('https://www.esempio.it/x', { rel: 'external nofollow' }), 'nofollow');
  assert.equal(motivo('https://www.esempio.it/x', { download: true }), 'download');
  assert.equal(motivo('https://www.esempio.it/x', { target: '_blank' }), 'altra-scheda');
  assert.equal(motivo('https://www.esempio.it/x', { target: '_self' }), '');
  for (const p of ['/logout', '/account/log-out', '/auth/signout', '/sign_out', '/logoff', '/user/delete-account', '/cart/remove/3',
    '/newsletter/unsubscribe', '/profilo/esci', '/ordine/cancella', '/Elimina', '/opt-out', '/abbonamento/disiscriviti']) {
    assert.equal(motivo(`https://www.esempio.it${p}`), 'azione', p);
  }
  assert.equal(motivo('https://www.esempio.it/files/guida.pdf'), 'file');
  assert.equal(motivo('https://www.esempio.it/foto/gatto.JPG'), 'file');
  assert.equal(motivo('https://utente:segreto@www.esempio.it/x'), 'credenziali');
});

// #1985 giro 1, r1: un precarico del link d'uscita fa uscire dal sito, quindi nel dubbio il link resta fuori.
test('un link d\'uscita si riconosce anche composto, in altre lingue o dal solo testo', () => {
  for (const p of ['/user/doLogout', '/logoutUser', '/logoutuser.php', '/api/deleteAccount', '/user/removeItem/5', '/konto/abmelden',
    '/compte/d%C3%A9connexion', '/cuenta/cerrar-sesion', '/password/reset', '/conferma/confirm/abc', '/account/verify-email',
    '/removed-items', '/deleted-scenes']) {
    assert.equal(motivo(`https://www.esempio.it${p}`), 'azione', p);
  }
  for (const testo of ['Esci', 'Log out', 'Abmelden', 'Se déconnecter', 'Cerrar sesión', 'Disconnettiti', 'btn-logout']) {
    assert.equal(motivo('https://www.esempio.it/account/x7', { testo }), 'azione', testo);
  }
  // #1985 giro 2, r3: altre lingue e altri alfabeti, che prima sparivano prima del confronto.
  for (const p of ['/user/loginOut', '/session/exit', '/account/quit', '/konto/выйти']) {
    assert.equal(motivo(`https://www.esempio.it${p}`), 'azione', p);
  }
  for (const testo of ['Выйти', 'Выход', 'ログアウト', '退出登录', '注销', '로그아웃', 'Logga ut', 'Logg ut', 'Log ud', 'Kirjaudu ulos',
    'Odhlásit', 'Çıkış yap', 'Termina sessione', 'Terminar sessão', 'Αποσύνδεση', 'Kijelentkezés', 'Deconectare', 'Exit', 'Quit']) {
    assert.equal(motivo('https://www.esempio.it/a/x9', { testo }), 'azione', testo);
  }
  // Le pagine di tutti i giorni restano: due parole vicine non si fondono in un'azione che non c'è.
  for (const [href, testo] of [['/catalogo/utile', 'Il catalogo utile'], ['/blog/output', 'Output del blog'], ['/notizie/ieri', 'Le notizie di ieri']]) {
    assert.equal(motivo(`https://www.esempio.it${href}`, { testo }), '', href);
  }
});

test('le parole d\'azione sono un elenco solo, quello dell\'avviso sui link sospetti', () => {
  require('../../src/shared/linkSospetto.js');
  const LS = globalThis.SN_LINK_SOSPETTO;
  for (const w of LS.PAROLE_AZIONE) {
    assert.equal(motivo(`https://www.esempio.it/a/${w}`), 'azione', w);
    assert.ok(LS.analizza(`https://www.esempio.it/a/${w}`).includes('side_effect'), w);
  }
  const testo = readFileSync(new URL('../../src/shared/precarico.js', import.meta.url), 'utf8');
  assert.ok(!/logout|unsubscribe/i.test(testo.replace(/\/\/.*$/gm, '')), 'una parola d\'azione scritta nel precarico: va nell\'elenco condiviso');
});

test('il tetto dei link a schermo scritto a parole nelle Preferenze e nel manifesto è quello vero', () => {
  // Se il tetto cambia, cambiano insieme il numero qui, il suggerimento della voce e il manifesto.
  const aParole = { 20: 'venti' }[P.LIMITI.TETTO_VISIBILI];
  assert.ok(aParole, `il tetto ${P.LIMITI.TETTO_VISIBILI} non ha la sua parola: aggiornala qui e nei due testi`);
  const html = readFileSync(new URL('../../src/pages/preferences/preferences.html', import.meta.url), 'utf8');
  const voce = /<label title="([^"]*)">\s*<input type="checkbox" id="precaricoVisibili"/.exec(html);
  assert.ok(voce && voce[1].includes(`fino a ${aParole} link`), 'suggerimento della voce in Preferenze');
  require('../../src/shared/capabilities.js');
  const cap = (globalThis.SN_CAPABILITIES.list || globalThis.SN_CAPABILITIES.CAPABILITIES || []).find((c) => c.id === 'precarico-link');
  assert.ok(cap && cap.desc.includes(`fino a ${aParole} per pagina`), 'manifesto delle capacità');
});

test('a Chromium va l\'indirizzo senza frammento', () => {
  assert.equal(P.indirizzoDaPrecaricare('https://www.esempio.it/a#b'), 'https://www.esempio.it/a');
  assert.equal(P.indirizzoDaPrecaricare('non è un indirizzo'), '');
});

test('la rete a consumo o lenta ferma i link a schermo', () => {
  assert.equal(P.reteARisparmio(null), false);
  assert.equal(P.reteARisparmio({ effectiveType: '4g' }), false);
  assert.equal(P.reteARisparmio({ effectiveType: '4g', saveData: true }), true);
  for (const t of ['slow-2g', '2g', '3g']) assert.equal(P.reteARisparmio({ effectiveType: t }), true, t);
});

test('il main ferma i link a schermo per interruttore, incognito, scaricamento e batteria', () => {
  assert.equal(P.motivoFermoVisibili({ impostazioni: {} }), '');
  assert.equal(P.motivoFermoVisibili({ impostazioni: { precarico: { visibili: true } } }), '');
  assert.equal(P.motivoFermoVisibili({ impostazioni: { precarico: { visibili: false } } }), 'spento');
  assert.equal(P.motivoFermoVisibili({ impostazioni: {}, incognito: true }), 'incognito');
  assert.equal(P.motivoFermoVisibili({ impostazioni: {}, scaricando: true }), 'scaricamento');
  assert.equal(P.motivoFermoVisibili({ impostazioni: {}, aBatteria: true }), 'batteria');
  // #1985 giro 2, r2: una scheda dietro non ha link sullo schermo, anche se per la pagina è «visibile».
  assert.equal(P.motivoFermoVisibili({ impostazioni: {}, dietro: true }), 'dietro');
  assert.equal(P.visibiliAcceso(null), true);
});

// #1985 giro 2, r5: i precarichi di Chromium la pagina non li vede; il passo li tiene a uno o due in corso.
test('su un sito lento i link a schermo partono più distanti, e restano in corso al più due alla volta', () => {
  assert.equal(P.passoVisibili(0), P.LIMITI.PASSO_MS);
  assert.equal(P.passoVisibili(undefined), P.LIMITI.PASSO_MS);
  assert.equal(P.passoVisibili(300), P.LIMITI.PASSO_MS);
  for (const durata of [1500, 3000, 6000]) {
    const passo = P.passoVisibili(durata);
    // Un precarico dura quanto la pagina: in `durata` ms ne partono durata/passo, più quello in corso.
    assert.ok(Math.ceil(durata / passo) <= P.LIMITI.IN_CORSO_MAX, `${durata} ms: passo ${passo}`);
  }
  assert.equal(P.passoVisibili(10 * 60_000), P.LIMITI.PASSO_MAX_MS);
  assert.ok(P.LIMITI.IN_CORSO_MAX >= 1 && P.LIMITI.IN_CORSO_MAX <= 2);
});

test('il prossimo link a schermo è il più in alto non ancora fatto', () => {
  const c = [{ url: 'b', top: 40, left: 0 }, { url: 'a', top: 10, left: 50 }, { url: 'a2', top: 10, left: 5 }];
  assert.equal(P.prossimo(c, new Set()).url, 'a2');
  assert.equal(P.prossimo(c, new Set(['a2'])).url, 'a');
  assert.equal(P.prossimo(c, new Set(['a', 'a2', 'b'])), null);
});

test('la chat spegne e riaccende i link a schermo con la stessa voce delle Preferenze', () => {
  require('../../src/shared/preferences.js');
  const Pref = globalThis.SN_PREF;
  assert.deepEqual(Pref.buildPreferencePartial('precarico_link_visibili', 'no').partial, { precarico: { visibili: false } });
  assert.deepEqual(Pref.buildPreferencePartial('precarica i link', 'sì').partial, { precarico: { visibili: true } });
});

test('i tetti restano larghi abbastanza e dentro quelli di Chromium', () => {
  assert.equal(P.LIMITI.TETTO_VISIBILI, 20);
  assert.ok(P.LIMITI.TETTO_VISIBILI + P.LIMITI.PASSAGGI_TENUTI <= 50);
  assert.ok(P.LIMITI.ATTESA_PASSAGGIO_MS <= 100);
});
