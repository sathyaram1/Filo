// Verifica #1783 giro 1: un'azione che chiedeva l'OK, data e poi non riuscita (o fermata per un segreto), al turno dopo
// arriva al modello ancora «in attesa della conferma»: il giro com'era vince sull'esito che la scheda ha visto dopo.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
for (const m of ['capabilities', 'constants', 'contenutoEsterno', 'chatArchive', 'filoEventi', 'filoApp', 'filoContesto',
  'filoTrattoVivo', 'cambi', 'actionLevels', 'actionTools', 'sistema', 'filoState']) require(`../../../src/shared/${m}.js`);
require('../../../src/main/services/providers/openrouter.js');
globalThis.SN_CONST = { ...globalThis.SN_CONST, STORAGE_KEYS: { ...globalThis.SN_CONST.STORAGE_KEYS, FILO_CHATS: 'filo_chats' } };
globalThis.chrome = { storage: { local: { async get(k) { return { [k]: undefined }; }, async set() {}, async remove() {} } } };
const { creaFilo } = require('../../../src/main/services/ilFilo.js');
require('../../../src/main/services/filoChats.js');
require('../../../src/main/services/conversazioniApp.js');
const Contesto = require('../../../src/main/services/contestoFilo.js');
const Chats = globalThis.SN_FILO_CHATS;
const Tools = globalThis.SN_ACTION_TOOLS;

const ORA = Date.now();
const fa = (min) => new Date(ORA - min * 60000).toISOString();
const testoDi = (m) => (typeof m.content === 'string' ? m.content : (m.content || []).map((p) => p.text || '').join(''));
const IN_ATTESA = 'In attesa della conferma dell\'utente: il sistema gli sta mostrando cosa stai per fare («Chiudi la scheda»).';

const cartelle = [];
test.afterAll(() => { for (const c of cartelle) togliCartella(c); });

for (const [nome, output] of [
  ['l\'OK dato e l\'azione non riuscita', { error: 'la finestra si è chiusa prima' }],
  ['l\'OK dato e l\'azione fermata perché portava fuori un segreto', { blocked: 'segreto' }],
]) {
  test(`r1 ${nome}: al turno dopo il modello non la crede ancora in attesa dell'OK`, async () => {
    const cartella = cartellaTemporanea('verifica-1783-');
    cartelle.push(cartella);
    globalThis.SN_IL_FILO = creaFilo({ cartella });
    Contesto.dimentica(null);
    Contesto.azzeraAncore();

    await Chats.append('ab12', { role: 'user', text: 'chiudi la scheda', ts: fa(30) });
    const dopo = await Chats.append('ab12', { role: 'filo', text: 'Ti chiedo conferma.', ts: fa(29) });
    const risposta = dopo.messages[dopo.messages.length - 1];
    const giro = [
      Tools.assistantMessage({ text: '', toolCalls: [{ id: 'c1', name: 'CHIUDI_TAB', arguments: { indice: 1 } }] }),
      Tools.toolMessage('c1', IN_ATTESA),
    ];
    Contesto.ricordaGiro('ab12', risposta.ts, { messaggi: giro, testo: risposta.text, reasoningDetails: [], azioni: [], seguiti: [] });
    await Chats.append('ab12', { role: 'user', text: 'fatto?', ts: fa(20) });

    // La scheda: l'utente ha dato l'OK nel popup, e l'azione non è andata.
    const azione = { type: 'CHIUDI_TAB', _callId: 'c1', _executed: false, _output: output };
    const storia = [{ role: 'user', text: 'chiudi la scheda' }, { role: 'filo', text: 'Ti chiedo conferma.', actions: [azione] }];
    const osserva = (azioni) => (azioni.some((a) => a && a._output && (a._output.error || a._output.blocked)) ? 'OK DATO, NON ESEGUITA' : '');
    const c = await Contesto.componi({ chatId: 'ab12', userMessage: 'fatto?', storia, tetti: { giorni: 3, token: 100000 }, osserva, incognito: false });
    const tratto = c.messaggi.map(testoDi).join('\n');
    expect(tratto, 'il modello ha davanti l\'azione come ancora in attesa dell\'OK').not.toContain('In attesa della conferma');
    expect(tratto).toContain('OK DATO, NON ESEGUITA');
  });
}
