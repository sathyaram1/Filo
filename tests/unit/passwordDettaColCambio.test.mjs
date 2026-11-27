// #1403.67 — la password nuova detta con un verbo di cambio («ho cambiato la password in …», «diventa …») o data dopo la
// domanda («ti ricordi la password? Era …») non arriva ai modelli, né dal pavimento né dal correttore.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
globalThis.self = globalThis;
for (const m of ['guardianoStatico', 'urlExfil', 'riservatiNelTesto', 'pavimento']) require(join(ROOT, 'src', 'shared', `${m}.js`));
const G = globalThis.SN_GUARDIANO_STATICO;
const P = globalThis.SN_PAVIMENTO;
const C = require(join(ROOT, 'src', 'main', 'services', 'correttoreRiservati.js'));
const S = P.SEGNAPOSTO;

test('le due frasi della segnalazione arrivano al modello col segnaposto, fra virgolette e senza', () => {
  for (const [t, atteso] of [
    ['ho cambiato la password in «Mela! Verde77»', `ho cambiato la password in «${S}»`],
    ['Ti ricordi la password? Era «Mela! Verde77»', `Ti ricordi la password? Era «${S}»`],
    ['ho cambiato la password in Mela!Verde77', `ho cambiato la password in ${S}`],
    ['Ti ricordi la password? Era Mela!Verde77', `Ti ricordi la password? Era ${S}`],
  ]) {
    assert.equal(P.oscura(t), atteso, `pavimento: ${t}`);
    assert.equal(C.oscura(t), atteso, `correttore: ${t}`);
  }
  const messaggi = [{ role: 'user', content: [{ type: 'text', text: 'Ciao! ho cambiato la password in «Mela! Verde77», segnatela' }] }];
  assert.doesNotMatch(JSON.stringify(P.oscuraTutto(messaggi)), /Mela|Verde77/);
});

test('gli altri modi comuni di dire la password nuova', () => {
  for (const t of [
    'la password è stata cambiata in «Mela! Verde77»',
    "la password del wifi l'ho cambiata in «Mela! Verde77»",
    'ho modificato la password del router in «Mela! Verde77»',
    'ho impostato la password a «Mela! Verde77»',
    'la password è diventata «Mela! Verde77»',
    'la password diventa «Mela! Verde77»',
    'la password resta «Mela! Verde77»',
    'la password rimane Mela!Verde77',
    'qual è la password? È «Mela! Verde77»',
    'I changed the password to "Mela! Verde77"',
    'the password has been reset to «Mela! Verde77»',
  ]) {
    for (const [chi, o] of [['pavimento', P.oscura(t)], ['correttore', C.oscura(t)]]) {
      assert.ok(o.includes(S) && !/Mela|Verde77/.test(o), `${chi}: ${t} → ${o}`);
    }
  }
  assert.equal(P.oscura('ho modificato la password del router in «casa mia al mare»'), `ho modificato la password del router in «${S}»`);
});

test('ogni verbo di cambio dell\'elenco presenta la password al pavimento, anche con «con» e «da … a …»', () => {
  const cambi = new RegExp(`^(?:${G.CAMBI})$`, 'iu');
  for (const p of ['cambiato', 'modificata', 'aggiornato', 'impostata', 'sostituito', 'rimpiazzata', 'changed', 'updated', 'reset', 'replaced']) {
    assert.ok(cambi.test(p), `${p} manca dall'elenco del guardiano`);
    for (const v of ['in', 'a', 'to', 'con', 'with']) {
      const t = `ho ${p} la password ${v} Mela!Verde77`;
      assert.equal(P.oscura(t), `ho ${p} la password ${v} ${S}`, t);
    }
  }
});

test('la password nuova con altri ponti, nella stessa frase o dopo la domanda, non arriva al modello', () => {
  for (const t of [
    'ho cambiato la password da «Gatto1» a «Mela! Verde77»',
    'ho cambiato la password del conto da Gatto1 a Mela!Verde77',
    "la password vecchia era «Gatto1», l'ho cambiata in «Mela! Verde77»",
    'la vecchia password era «Gatto1» e la nuova è «Mela! Verde77»',
    'ho cambiato la password in «Mela! Verde77», la vecchia era «Gatto1»',
    'ho sostituito la password con «Mela! Verde77»',
    'ho cambiato la password, ora è «Mela! Verde77»',
    'ho cambiato la password. Adesso è «Mela! Verde77»',
    "la password l'ho cambiata: ora è «Mela! Verde77»",
    'come password ho messo «Mela! Verde77»',
    "la password l'ho messa «Mela! Verde77»",
    'Ti ricordi la password? «Mela! Verde77»',
    'Nuova password? «Mela! Verde77»',
    'Ricordi la password? Mi pare fosse «Mela! Verde77»',
    'Ti ricordi la password??? Era «Mela! Verde77»',
    'Ti ricordi la password? Era: «Mela! Verde77»',
    'Do you remember the password? It was "Mela! Verde77"',
    'Do you remember the password? It\'s "Mela! Verde77"',
    "j'ai changé le mot de passe en «Mela! Verde77»",
    'he cambiado la contraseña a «Mela! Verde77»',
    'ich habe das Passwort in «Mela! Verde77» geändert',
  ]) {
    for (const [chi, o] of [['pavimento', P.oscura(t)], ['correttore', C.oscura(t)]]) {
      assert.ok(o.includes(S) && !/Mela|Verde77|Gatto1/.test(o), `${chi}: ${t} → ${o}`);
    }
  }
});

test('un altro campo o un modo di dire dopo la password restano', () => {
  for (const t of [
    'Hai cambiato la password? Era ora! Ora te la dico, ora!',
    'la password è «Mela! Verde77» e il nome utente è «mario»',
    'Password dimenticata? «Clicca qui»',
    'Per cambiare la password vai su «Impostazioni» e premi «Salva»',
    'ho cambiato la password con calma',
    'manda la password a «Marco» con «WhatsApp»',
  ]) {
    const o = P.oscura(t);
    for (const w of ['ora!', 'mario', 'Clicca qui', 'Impostazioni', 'Salva', 'calma', 'Marco', 'WhatsApp']) {
      if (t.includes(w)) assert.ok(o.includes(w), `${t} → ${o}`);
    }
  }
});

test('nel correttore il verbo di cambio dopo «pw» o «password» resta, il valore no', () => {
  for (const [t, verbo] of [
    ['la pw rimasta gattonero', 'rimasta'],
    ['my pw became gattonero', 'became'],
    ['la password è stata aggiornata a «gattonero»', 'aggiornata'],
    ['la password became Gattonero7', 'became'],
  ]) {
    const o = C.oscura(t);
    assert.ok(o.includes(verbo) && !/gattonero/i.test(o), `${t} → ${o}`);
  }
});

test('senza un cambio né un annuncio dopo la domanda, le parole dopo la password restano', () => {
  for (const t of [
    'ho cambiato la password in banca',
    'ho cambiato la password a Marco ieri',
    'send the password to Marco',
    'manda la password a «Marco»',
    'Hai cambiato la password? In banca dicono di sì',
    'Hai dimenticato la password? È facile: clicca su Recupera',
    'Ti ricordi la password? È «quella solita»',
  ]) assert.equal(P.oscura(t), t, t);
});

test('le parole di cambio stanno solo nel guardiano', () => {
  for (const f of [join('src', 'shared', 'pavimento.js'), join('src', 'shared', 'riservatiNelTesto.js'), join('src', 'main', 'services', 'correttoreRiservati.js')]) {
    const src = readFileSync(join(ROOT, f), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/diventat|rimast|became|sostituit|aggiornat|updated/.test(src), `${f}: le parole stanno in guardianoStatico.js (CAMBI)`);
  }
});
