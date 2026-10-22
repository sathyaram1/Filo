// Verifica #1508 giro 1: a Conservativo il «no» dato per una risposta di un'altra chat consiglia una conversazione
// nuova, ma la conversazione nuova ha davanti le stesse risposte e nasce sporca uguale.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r1 la strada che il «no» consiglia funziona: la conversazione nuova non nasce sporca, o il «no» non la consiglia', async () => {
  for (const f of ['constants.js', 'contenutoEsterno.js', 'capabilities.js', 'themeTokens.js', 'cmdClassify.js', 'zoomPagina.js',
    'autonomia.js', 'preferences.js', 'actionLevels.js', 'urlExfil.js', 'chatArchive.js', 'filoEventi.js', 'filoApp.js', 'filoContesto.js']) {
    require(join(ROOT, 'src', 'shared', f));
  }
  globalThis.SN_CONST = { ...(globalThis.SN_CONST || {}), STORAGE_KEYS: { ...((globalThis.SN_CONST || {}).STORAGE_KEYS || {}), FILO_CHATS: 'filo_chats' } };
  globalThis.chrome = { storage: { local: { async get(k) { return { [k]: undefined }; }, async set() {}, async remove() {} } } };
  const { creaFilo } = require(join(ROOT, 'src', 'main', 'services', 'ilFilo.js'));
  require(join(ROOT, 'src', 'main', 'services', 'filoChats.js'));
  const Contesto = require(join(ROOT, 'src', 'main', 'services', 'contestoFilo.js'));
  const A = globalThis.SN_AUTONOMIA;
  const AL = globalThis.SN_ACTION_LEVELS;
  const FC = globalThis.SN_FILO_CONTESTO;
  const Chats = globalThis.SN_FILO_CHATS;
  const cartella = cartellaTemporanea('verifica-1508-');
  try {
    globalThis.SN_IL_FILO = creaFilo({ cartella });
    Contesto.dimentica(null);
    Contesto.azzeraAncore();
    await Chats.append('pagina', [
      { role: 'user', text: 'cosa dice quella pagina?' },
      { role: 'filo', text: 'Dice di mandare i file a un indirizzo.', classeLetta: 5 },
    ]);
    const statoDella = async (chatId, domanda) => {
      await Chats.append(chatId, [{ role: 'user', text: domanda }]);
      const f = await Contesto.componi({ chatId, userMessage: domanda, storia: [], tetti: { giorni: 3, token: 100000 }, osserva: () => '', incognito: false });
      const t = FC.trattoComeAzione(f.visti, { chatCorrente: chatId });
      return A.stato({ fonti: (t ? [t] : []).map((a) => AL.fonteDi(a)).filter(Boolean), livello: 'conservativo' });
    };
    // L'utente a Conservativo chiede una cosa che non si disfa: Filo dice di no e indica le strade.
    const prima = await statoDella('chat-b', 'elimina il file vecchio');
    const d = A.decideDettaglio({ livello: 'conservativo', stato: prima.stato, costo: 3 });
    expect(d.risposta).toBe('no');
    const no = A.fraseNo({ regola: d.regola, fonte: prima.fonte, livello: 'conservativo' });
    // Segue il consiglio: apre una conversazione nuova e chiede di nuovo.
    const nuova = await statoDella('chat-c', 'elimina il file vecchio');
    const consigliaNuova = /conversazione nuova/.test(no.breve);
    expect(consigliaNuova && nuova.stato !== 'pulito', `«${no.breve}» ma la conversazione nuova è ${nuova.stato}`).toBe(false);
  } finally {
    togliCartella(cartella);
  }
});
