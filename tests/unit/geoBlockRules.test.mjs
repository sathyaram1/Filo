// Unit test per src/main/services/geoBlockRules.js — livello decisionale del
// geo-block (proxy-per-tab-spec.md §5, feedback #151): la matrice "cosa fare
// quando un geo-block è rilevato". Logica pura: gira via `npm run test:unit`
// senza Electron né rete.
//
// La matrice è il primo "criterio di fatto" del feedback #151: ogni riga (login
// sì/no, sito flaggato sì/no, esito del retry) deve mappare sull'azione giusta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const R = require(join(__dirname, '..', '..', 'src', 'main', 'services', 'geoBlockRules.js'));

const cfg = { proxyConfigured: true }; // default: un endpoint esiste

test('(c) sito flaggato pericoloso/sospetto → nessuna azione, precedenza assoluta', () => {
  // Anche con login assente e proxy configurato: il proxy non aggira la sicurezza.
  let d = R.decideGeoAction({ ...cfg, flaggedDangerous: true, hasLoginCookies: false });
  assert.equal(d.action, R.ACTIONS.NONE);
  assert.equal(d.reason, 'flagged_dangerous');
  // E anche se ci sono cookie di login: resta NONE (non si propone nemmeno).
  d = R.decideGeoAction({ ...cfg, flaggedDangerous: true, hasLoginCookies: true });
  assert.equal(d.action, R.ACTIONS.NONE);
  // La precedenza vale a qualsiasi stadio del retry.
  d = R.decideGeoAction({ ...cfg, flaggedDangerous: true, stage: R.STAGES.DATACENTER_FAILED_IPBLOCK });
  assert.equal(d.action, R.ACTIONS.NONE);
});

test('(a) nessun login + sito non flaggato → retry silenzioso via datacenter', () => {
  const d = R.decideGeoAction({ ...cfg, flaggedDangerous: false, hasLoginCookies: false });
  assert.equal(d.action, R.ACTIONS.SILENT_RETRY);
  assert.equal(d.tier, R.TIERS.DATACENTER);
  assert.equal(d.reason, 'safe_no_login');
});

test('(b) cookie di login presenti → proposta inline, MAI retry silenzioso', () => {
  const d = R.decideGeoAction({ ...cfg, flaggedDangerous: false, hasLoginCookies: true });
  assert.equal(d.action, R.ACTIONS.PROPOSE);
  assert.equal(d.reason, 'login_session');
  // L'invariante forte: con login attivo non si deve MAI ottenere un retry silenzioso.
  assert.notEqual(d.action, R.ACTIONS.SILENT_RETRY);
});

test('(d) datacenter fallito con IP-block → un solo retry residenziale', () => {
  const d = R.decideGeoAction({ ...cfg, hasLoginCookies: false, stage: R.STAGES.DATACENTER_FAILED_IPBLOCK });
  assert.equal(d.action, R.ACTIONS.SILENT_RETRY);
  assert.equal(d.tier, R.TIERS.RESIDENTIAL);
  assert.equal(d.reason, 'datacenter_ipblock');
});

test('(d-coda) residenziale fallito → si propone, mai loop di retry', () => {
  const d = R.decideGeoAction({ ...cfg, hasLoginCookies: false, stage: R.STAGES.RESIDENTIAL_FAILED });
  assert.equal(d.action, R.ACTIONS.PROPOSE);
  assert.equal(d.reason, 'retry_failed');
});

test('datacenter fallito per altro motivo (non IP-block) → proposta, NON residenziale', () => {
  // Es. proxy non raggiungibile / errore generico: non si escala al residenziale,
  // si propone e basta (niente loop).
  const d = R.decideGeoAction({ ...cfg, hasLoginCookies: false, stage: R.STAGES.DATACENTER_FAILED });
  assert.equal(d.action, R.ACTIONS.PROPOSE);
  assert.notEqual(d.tier, R.TIERS.RESIDENTIAL);
});

test('proxy non configurato → nessuna azione (non si propone il vuoto)', () => {
  const d = R.decideGeoAction({ proxyConfigured: false, hasLoginCookies: false });
  assert.equal(d.action, R.ACTIONS.NONE);
  assert.equal(d.reason, 'not_configured');
});

test('input vuoto → nessuna azione (default difensivo)', () => {
  const d = R.decideGeoAction();
  assert.equal(d.action, R.ACTIONS.NONE);
});

test('hasLoginCookie: riconosce sessione/auth per nome', () => {
  assert.equal(R.looksLikeLoginCookie({ name: 'sessionid' }), true);
  assert.equal(R.looksLikeLoginCookie({ name: 'connect.sid' }), true);
  assert.equal(R.looksLikeLoginCookie({ name: 'auth_token' }), true);
  assert.equal(R.looksLikeLoginCookie({ name: 'access_token' }), true);
  assert.equal(R.looksLikeLoginCookie({ name: 'JWT' }), true);
  assert.equal(R.looksLikeLoginCookie({ name: 'remember_me' }), true);
  assert.equal(R.looksLikeLoginCookie({ name: 'user_uid' }), true);
  assert.equal(R.hasLoginCookie([{ name: '_ga' }, { name: 'sessionid' }]), true);
});

test('hasLoginCookie: httpOnly conta come sessione (direzione conservativa)', () => {
  // Nome neutro ma httpOnly → trattato come sessione (meglio proporre che
  // riprovare in silenzio).
  assert.equal(R.looksLikeLoginCookie({ name: 'x', httpOnly: true }), true);
  assert.equal(R.looksLikeLoginCookie({ name: 'x', httpOnly: false }), false);
});

test('hasLoginCookie: cookie tecnici (consenso/analytics/bot) NON sono login', () => {
  assert.equal(R.looksLikeLoginCookie({ name: 'cookieconsent_status', httpOnly: true }), false);
  assert.equal(R.looksLikeLoginCookie({ name: '_ga', httpOnly: true }), false);
  assert.equal(R.looksLikeLoginCookie({ name: '__cf_bm', httpOnly: true }), false);
  assert.equal(R.looksLikeLoginCookie({ name: 'cf_clearance', httpOnly: true }), false);
  assert.equal(R.hasLoginCookie([{ name: '_ga', httpOnly: true }, { name: 'cookieconsent', httpOnly: true }]), false);
  assert.equal(R.hasLoginCookie([]), false);
  assert.equal(R.hasLoginCookie(null), false);
});

test('shouldNoteVideoData: soglia 15 min, solo su tab proxata, una volta sola', () => {
  const T = R.VIDEO_DATA_NOTE_MS;
  assert.equal(T, 15 * 60 * 1000);
  // Tab proxata, video oltre soglia, mai notato → sì.
  assert.equal(R.shouldNoteVideoData({ proxied: true, playingMs: T, alreadyNoted: false }), true);
  assert.equal(R.shouldNoteVideoData({ proxied: true, playingMs: T + 1000, alreadyNoted: false }), true);
  // Sotto soglia → no.
  assert.equal(R.shouldNoteVideoData({ proxied: true, playingMs: T - 1, alreadyNoted: false }), false);
  // Tab NON proxata → no (consuma dati normali).
  assert.equal(R.shouldNoteVideoData({ proxied: false, playingMs: T * 2, alreadyNoted: false }), false);
  // Già notato in questa sessione → no (non bloccante, una volta sola).
  assert.equal(R.shouldNoteVideoData({ proxied: true, playingMs: T * 2, alreadyNoted: true }), false);
});
