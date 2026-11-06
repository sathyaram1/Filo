// Verifica #1563 giro 4: il diario della compattazione segue lo stato della chat da cui nasce. Una chat nascosta esce
// dal CONTESTO e ci torna quando si mostra di nuovo; una chat cancellata se ne va dal diario anche sul disco, subito.
import { test, expect } from '../../fixtures/electron.mjs';

const ORA_MS = 60 * 60 * 1000;

// Una conversazione di cinque ore fa nella chat `chat`, compattata tutta da un modello finto che scrive `riga`.
const compattaUna = (app, chat, domanda, riga) => app.evaluate(async (_e, { chat, domanda, riga, ORA_MS }) => {
  const Chats = globalThis.SN_FILO_CHATS;
  const C = globalThis.SN_COMPATTAZIONE;
  const t0 = Date.now() - 5 * ORA_MS;
  await Chats.append(chat, { role: 'user', text: domanda, ts: new Date(t0).toISOString() });
  await Chats.append(chat, { role: 'filo', text: 'Va bene, ne parliamo.', ts: new Date(t0 + 5000).toISOString() });
  const vero = C._dip.chiama;
  C._dip.chiama = async () => JSON.stringify({ ore: [{ testo: riga, righe: [1, 2] }], memorie: [] });
  try {
    const r = await C.compatta({ incognito: false, motivo: 'soglia', forza: true, grezzo: { ore: 0, turni: 0 } });
    return { fatto: r.fatto, sezione: await C.sezione(false) };
  } finally { C._dip.chiama = vero; }
}, { chat, domanda, riga, ORA_MS });

test('r1 una chat nascosta esce dal diario e ci torna quando si mostra di nuovo', async ({ app }) => {
  const RIGA = '10:00 chiesto quale medico chiamare per la febbre';
  const prima = await compattaUna(app, 'privata', 'ho la febbre da tre giorni, che medico chiamo?', RIGA);
  expect(prima.fatto).toBe(true);
  expect(prima.sezione).toContain(RIGA);

  const nascosta = await app.evaluate(async () => {
    await globalThis.SN_FILO_CHATS.nascondi('privata', true);
    return globalThis.SN_COMPATTAZIONE.sezione(false);
  });
  expect(nascosta, 'nascosta, non sta davanti a Filo').not.toContain(RIGA);

  const mostrata = await app.evaluate(async () => {
    await globalThis.SN_FILO_CHATS.nascondi('privata', false);
    return globalThis.SN_COMPATTAZIONE.sezione(false);
  });
  expect(mostrata, 'mostrata di nuovo, la sua riga del diario torna').toContain(RIGA);
});

test('r1 una chat cancellata se ne va dal diario sul disco subito, come dalle altre copie', async ({ app }) => {
  const RIGA = '10:00 parlato del prestito chiesto alla banca per la casa';
  const prima = await compattaUna(app, 'banca', 'mi hanno rifiutato il mutuo, cosa faccio?', RIGA);
  expect(prima.fatto).toBe(true);

  const suDisco = await app.evaluate(async () => {
    await globalThis.SN_FILO_CHATS.remove('banca');
    const fs = process.getBuiltinModule('node:fs');
    const path = process.getBuiltinModule('node:path');
    try { return fs.readFileSync(path.join(process.env.FILO_USER_DATA, 'filo', 'livelli.json'), 'utf8'); } catch (_) { return ''; }
  });
  expect(suDisco, 'la riga nata dalla chat cancellata non resta nel file del diario').not.toContain('prestito');
});
