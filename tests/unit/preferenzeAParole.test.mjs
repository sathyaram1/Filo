// Sentinella: ogni impostazione modificabile a parole è anche DICHIARATA al modello.
// L'elenco dentro lo strumento IMPOSTA_PREFERENZA è l'unico da cui gli è permesso pescare,
// e chi aggiunge un setter senza aggiungerla lì crea una manopola che solo le mani girano.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(join(ROOT, 'package.json'));

globalThis.window = globalThis;
require(join(ROOT, 'src/shared/preferences.js'));
require(join(ROOT, 'src/shared/actionTools.js'));

const { PREF_SETTERS, buildPreferencePartial } = globalThis.SN_PREF;
const strumento = globalThis.SN_ACTION_TOOLS.TOOLS.IMPOSTA_PREFERENZA;
const ELENCO = typeof strumento.description === 'function'
  ? strumento.description({ sistema: {} })
  : strumento.description;

// La chiave va cercata come parola intera: "voce" dentro "velocita_voce" non è
// una dichiarazione di "voce".
const dichiarata = (chiave) => new RegExp(`(^|[^a-z0-9_])${chiave}([^a-z0-9_]|$)`).test(ELENCO);

test('ogni preferenza modificabile a parole è nell\'elenco che riceve il modello', () => {
  const mancanti = PREF_SETTERS.map((s) => s.keys[0]).filter((k) => !dichiarata(k));
  assert.deepEqual(mancanti, [], `chiavi assenti dall'elenco di IMPOSTA_PREFERENZA: ${mancanti.join(', ')}`);
});

test('le chiavi dichiarate al modello sono chiavi che esistono davvero', () => {
  const dichiarate = [...ELENCO.matchAll(/(?:^|[•;])\s*([a-z][a-z0-9_]*(?:\s*\/\s*[a-z][a-z0-9_]*)*)\s*:/gm)]
    .flatMap((m) => m[1].split('/').map((x) => x.trim()));
  assert.ok(dichiarate.length > 20, 'l\'elenco deve contenere le chiavi, una per voce');
  const inventate = dichiarate.filter((k) => !PREF_SETTERS.some((s) => s.keys.includes(k)));
  assert.deepEqual(inventate, [], `chiavi dichiarate ma non esistenti: ${inventate.join(', ')}`);
});

test('i due volumi non si scambiano: parole diverse, manopole diverse', () => {
  const suoneria = buildPreferencePartial('volume_suoneria', 30);
  assert.equal(suoneria.partial.timerRingtoneVolume, 30);

  for (const chiave of ['volume_notifiche', 'volume notifiche', 'volume delle notifiche', 'volume notifica']) {
    const r = buildPreferencePartial(chiave, 0);
    assert.ok(r, `«${chiave}» deve essere riconosciuta`);
    assert.equal(r.partial.notifications.soundVolume, 0, `«${chiave}» regola le notifiche`);
    assert.ok(!('timerRingtoneVolume' in r.partial), `«${chiave}» non deve toccare la suoneria del timer`);
  }

  // Un «volume» secco resta la suoneria: è quello che si chiede davvero.
  assert.equal(buildPreferencePartial('volume', 'muto').partial.timerRingtoneVolume, 0);
});

test('motivo e interruttore del suono delle notifiche si chiedono a parole', () => {
  assert.equal(buildPreferencePartial('tono_notifiche', 'delicata').partial.notifications.sound, 'gentle');
  assert.equal(buildPreferencePartial('suono_notifiche', 'si').partial.notifications.soundEnabled, true);
  assert.equal(buildPreferencePartial('suoneria_timer', 'carillon').partial.timerRingtone, 'chime');
  assert.equal(buildPreferencePartial('volume_suoneria', 'basso').partial.timerRingtoneVolume, 30);
  // Un valore che non vuol dire niente non spegne niente.
  assert.equal(buildPreferencePartial('volume_notifiche', 'boh'), null);
  assert.equal(buildPreferencePartial('tono_notifiche', 'boh'), null);
});
