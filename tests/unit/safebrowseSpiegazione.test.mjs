// #815 — «mi protegge dai siti truffa?», «come tolgo l'avviso?»: la voce del manifesto che la chat legge e le
// descrizioni della pagina Sicurezza raccontano il rilevatore com'è, legate al codice che lo fa.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of ['capabilities.js', 'actionLevels.js', 'constants.js', 'i18n.js', 'serviziEsterni.js', 'preferences.js']) {
  require(join(ROOT, 'src', 'shared', f));
}
const CAP = globalThis.SN_CAPABILITIES;
const C = globalThis.SN_CONST;
const T = globalThis.SN_I18N.t;
const leggi = (p) => readFileSync(join(ROOT, p), 'utf8');
const voce = () => CAP.get('dangerous-sites');

test('la chat che riceve «Filo mi protegge dal phishing?» ha la voce nell\'indice e il dettaglio vero', () => {
  const v = voce();
  assert.ok(v && v.desc && v.invoke && v.doesNot, 'la voce dangerous-sites ha desc, invoke e doesNot');
  const prompt = C.PROMPTS.filoChat({ profilo: 'a', preferenze: 'b', stato: 'c', capacita: CAP.renderIndexForPrompt() });
  const riga = prompt.split('\n').find((r) => r.includes('[dangerous-sites]'));
  assert.ok(riga, 'la voce sta nell\'indice del prompt');
  assert.match(riga, /phishing/i, 'il titolo nell\'indice dice phishing: è la parola della domanda');
  assert.match(riga, /truff/i);

  const d = CAP.renderDetailForPrompt(['dangerous-sites']);
  for (const [cosa, re] of [
    ['i due livelli', /È «pericoloso»[\s\S]*È «sospetto»/],
    ['la lista nera di Google', /lista nera di Google/],
    ['l\'età del dominio', /da quanti giorni esiste/],
    ['i campi password o carta', /password o i dati della carta/],
    ['il «confermo» legato alla scheda', /«confermo» del pericoloso vale solo per quel sito in quella scheda finché resta aperta/],
    ['il «Continua» che vale per sempre (#967)', /«Continua» sul sospetto mette il sito[^.]*fra i «Siti di cui ti fidi»: da lì l'avviso sospetto non torna su quel sito, in nessuna scheda e dopo i riavvii/],
    ['cosa esce verso Google', /verso Google solo un pezzo dell'impronta dell'indirizzo, mai l'indirizzo/],
    ['cosa esce verso il modello', /verso il modello AI[^.]*mai la pagina/],
    ['dove si spegne', /filo:\/\/security\/security\.html/],
  ]) assert.match(d, re, `il dettaglio dice ${cosa}`);
  for (const [cosa, re] of [
    ['che la pagina carica', /Non impedisce il caricamento/],
    ['che il «confermo» vale per la scheda e nessun elenco tace il pericoloso', /«confermo» del pericoloso vale solo per quella scheda: nessun elenco fa tacere l'avviso pericoloso/],
    ['che il testo della pagina non si legge', /non legge il testo della pagina: guarda solo se ci sono campi password o carta/],
  ]) assert.match(v.doesNot, re, `i limiti dicono ${cosa}`);
});

test('le parole e i pulsanti promessi sono quelli dell\'avviso e della pagina Sicurezza', () => {
  const v = voce();
  const testo = `${v.desc} ${v.invoke} ${v.doesNot}`;
  const avviso = leggi('src/renderer/avviso-sito.js');
  const parola = /const PAROLA = '([^']+)'/.exec(avviso)[1];
  assert.ok(testo.includes(`«${parola}»`), `la parola da scrivere è «${parola}»`);
  const [, avanti, continua] = /avanti\.textContent = pericoloso \? '([^']+)' : '([^']+)'/.exec(avviso);
  assert.ok(testo.includes(`«${avanti}»`) && testo.includes(`«${continua}»`), `i pulsanti sono «${avanti}» e «${continua}»`);
  assert.match(leggi('src/renderer/avviso-sito.html'), /Torna indietro/);
  for (const k of ['options_security_safebrowse', 'options_security_safebrowse_network', 'options_security_safebrowse_llm',
    'options_action_safebrowse_judge']) {
    assert.ok(testo.includes(`«${T(k)}»`), `la voce nomina l'interruttore com'è scritto: «${T(k)}»`);
  }
  const eta = globalThis.SN_SERVIZI_ESTERNI.SERVIZI.find((s) => s.id === 'eta-dominio');
  for (const base of eta.base) assert.ok(v.desc.includes(new URL(base).host), `la voce nomina ${new URL(base).host}`);
});

test('spento, il rilevatore tiene l\'analisi locale: manifesto, pagina e chat lo dicono', () => {
  const handlers = leggi('src/main/services/handlers.js');
  assert.match(handlers, /if \(sb\.enabled === false\) \{\s*SB\.configure\(\{ gsbKey: '', runLlm: null, enableSandbox: false, enableNetwork: false \}\);\s*return;/,
    'l\'interruttore spento ferma solo le richieste esterne: se adesso spegne anche gli avvisi, riscrivi i testi qui sotto');
  assert.match(voce().doesNot, /non gli avvisi che Filo decide da solo/);
  assert.match(T('options_security_safebrowse_desc'), /Spento, Filo non chiede più niente fuori dal computer, ma ti avvisa ancora/);
  const setter = globalThis.SN_PREF.PREF_SETTERS.find((s) => (s.scrive || []).includes('security.safeBrowse.enabled'));
  assert.match(setter.risk, /restano solo gli avvisi/);
  assert.doesNotMatch(setter.risk, /toglie l.avviso prima che tu apra/);
});

test('le descrizioni della pagina Sicurezza non promettono quello che il codice non fa', () => {
  const desc = T('options_security_safebrowse_desc');
  assert.match(desc, /«Continua»/);
  assert.match(desc, /«confermo»/);
  assert.match(desc, /in quella scheda/);
  assert.doesNotMatch(desc, /non bloccano mai|puoi ignorare/, 'l\'avviso copre la pagina finché non scegli');

  const chiave = T('options_security_safebrowse_key_managed');
  assert.match(chiave, /arriva col programma/);
  assert.match(chiave, /anche senza aver fatto l'accesso/);
  assert.doesNotMatch(chiave, /amministratore|account/);
  assert.match(leggi('src/main/config/default-keys.js'), /SAFEBROWSING/i, 'la chiave arriva davvero col programma');

  const prova = T('options_security_safebrowse_sandbox_desc');
  assert.doesNotMatch(prova, /li apre prima|segue prima|segue dove portano/);
  assert.match(prova, /Oggi nessuna funzione la usa/);
  assert.match(leggi('src/main/services/safebrowse/index.js'), /ctx\.daAprire === true/,
    'la finestra nascosta parte solo per un link da aprire: se cambia, cambia anche la frase');

  const giudizio = T('options_security_safebrowse_llm_desc');
  assert.doesNotMatch(giudizio, /chiavi che hai già configurato/);
  assert.ok(giudizio.includes(`«${T('options_action_safebrowse_judge')}»`), 'nomina la voce di Modelli dove si sceglie');
  assert.match(giudizio, /mai il contenuto della pagina/);

  assert.match(T('options_security_safebrowse_network_desc'), /Manda solo il nome del sito/);
});
