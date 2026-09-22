// Sentinella: ogni impostazione modificabile a parole è anche DICHIARATA al modello.
// L'elenco dentro lo strumento IMPOSTA_PREFERENZA è l'unico da cui gli è permesso pescare,
// e chi aggiunge un setter senza aggiungerla lì crea una manopola che solo le mani girano.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

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

// L'altro verso: ogni manopola della pagina Preferenze deve avere anche le sue
// parole, o resta una manopola che solo le mani girano (#667). La tabella qui
// sotto lega l'id del controllo alla chiave con cui la si chiede: un controllo
// nuovo non elencato fa cadere la sentinella.
const MANOPOLE = {
  theme: 'tema',
  textScale: 'dimensione_testo',
  showHomeMessage: 'commento_home',
  agentStyleText: 'stile_agente',
  autoArchiveEnabled: 'archiviazione_automatica',
  autoArchiveOnClose: 'archivia_alla_riapertura',
  autoArchiveIdleHours: 'ore_inattivita',
  terminalEnabled: 'modalita_terminale',
  terminalShell: 'shell_terminale',
  ttsVoice: 'voce',
  ttsRate: 'velocita_voce',
  ttsPitch: 'tono_voce',
  ttsModelVoice: 'voce_modello',
  notifDuration: 'durata_notifiche',
  notifSoundEnabled: 'suono_notifiche',
  notifSound: 'tono_notifiche',
  notifSoundVolume: 'volume_notifiche',
  timerRingtone: 'suoneria_timer',
  timerRingtoneVolume: 'volume_suoneria',
};

const VALORI_DI_PROVA = {
  tema: 'scuro', dimensione_testo: 'grande', commento_home: 'si', stile_agente: 'pacato',
  archiviazione_automatica: 'si', archivia_alla_riapertura: 'si', ore_inattivita: 6,
  modalita_terminale: 'si', shell_terminale: 'bash', voce: 'Alice', velocita_voce: 1.2,
  tono_voce: 1, voce_modello: 'Sara', durata_notifiche: 10, suono_notifiche: 'si',
  tono_notifiche: 'delicata', volume_notifiche: 60, suoneria_timer: 'carillon',
  volume_suoneria: 40,
};

test('ogni manopola della pagina Preferenze si può anche chiedere a parole', () => {
  const sorgente = readFileSync(join(ROOT, 'src/pages/preferences/preferences.js'), 'utf8');
  const salvataggio = sorgente.slice(sorgente.indexOf('async function persist('));
  const corpo = salvataggio.slice(0, salvataggio.indexOf('\n  }\n'));
  const letti = new Set();
  for (const m of corpo.matchAll(/(?:\$|volumeDa)\('([A-Za-z0-9_]+)'\)/g)) letti.add(m[1]);
  // I due campi raggiunti da un aiutante, non con $('id') diretto.
  letti.add('agentStyleText');
  letti.add('ttsModelVoice');

  const senzaParole = [...letti].filter((id) => !MANOPOLE[id]);
  assert.deepEqual(senzaParole, [], `manopole senza parole: aggiungile a MANOPOLE e a PREF_SETTERS (${senzaParole.join(', ')})`);

  for (const id of letti) {
    const chiave = MANOPOLE[id];
    assert.ok(buildPreferencePartial(chiave, VALORI_DI_PROVA[chiave]), `«${chiave}» dev'essere riconosciuta a parole`);
    assert.ok(dichiarata(chiave), `«${chiave}» dev'essere dichiarata al modello`);
  }
});

test('chiedere un suono per le notifiche lo rende anche udibile', () => {
  // Il suono delle notifiche nasce spento: confermare un motivo che non si
  // sentirà è la stessa delusione del timer muto.
  const tono = buildPreferencePartial('tono_notifiche', 'carillon').partial.notifications;
  assert.equal(tono.sound, 'chime');
  assert.equal(tono.soundEnabled, true);

  const su = buildPreferencePartial('volume_notifiche', 60).partial.notifications;
  assert.equal(su.soundVolume, 60);
  assert.equal(su.soundEnabled, true);

  // Il silenzio chiesto resta silenzio: non si accende niente.
  const muto = buildPreferencePartial('volume_notifiche', 0).partial.notifications;
  assert.equal(muto.soundVolume, 0);
  assert.ok(!('soundEnabled' in muto));
});

test('la durata delle notifiche si chiede a parole, zero compreso', () => {
  assert.equal(buildPreferencePartial('durata_notifiche', 10).partial.notifications.durationSec, 10);
  assert.equal(buildPreferencePartial('durata delle notifiche', '3 secondi').partial.notifications.durationSec, 3);
  // 0 = resta finché non la chiudi: un valore vero, non un errore.
  assert.equal(buildPreferencePartial('durata_notifiche', 0).partial.notifications.durationSec, 0);
  assert.equal(buildPreferencePartial('durata_notifiche', 500).partial.notifications.durationSec, 120);
  assert.equal(buildPreferencePartial('durata_notifiche', 'boh'), null);
  assert.equal(buildPreferencePartial('durata_notifiche', -5), null);
});
