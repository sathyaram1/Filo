// Verifica #1563 giro 3, rilievo 1: la prima compattazione di sempre, quando il modello non cita le prime righe del pezzo
// (un saluto), perde la riga del diario nata con una pagina visitata in mezzo, alla prima lettura del diario.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi, chiamateAlModello } from '../../helpers/chatFinta.mjs';

const RIGA = '14:01 cercata la ricetta della carbonara per stasera';

test('r1 la riga del diario nata con una pagina visitata resta nel CONTESTO anche se il modello non cita il saluto', async ({ app }) => {
  const page = await home(app);
  const fatto = await app.evaluate(async (_e, riga) => {
    const C = globalThis.SN_COMPATTAZIONE;
    const Chats = globalThis.SN_FILO_CHATS;
    const t0 = Date.now() - 5 * 60 * 60 * 1000;
    await Chats.append('saluto1', { role: 'user', text: 'ciao', ts: new Date(t0).toISOString() });
    await Chats.append('saluto1', { role: 'filo', text: 'Ciao!', ts: new Date(t0 + 1000).toISOString() });
    await globalThis.SN_IL_FILO.registraVisita({ url: 'https://ricette.example/carbonara', titolo: 'Carbonara', ts: new Date(t0 + 30000).toISOString() }, { incognito: false });
    await Chats.append('saluto1', { role: 'user', text: 'che si mangia stasera?', ts: new Date(t0 + 60000).toISOString() });
    await Chats.append('saluto1', { role: 'filo', text: 'Una carbonara.', ts: new Date(t0 + 61000).toISOString() });
    const vero = C._dip.chiama;
    // Il modello lascia fuori il saluto: cita solo le righe della domanda vera.
    C._dip.chiama = async ({ messages }) => {
      const n = [...messages[1].content.matchAll(/^\[(\d+)\]/gm)].map((m) => Number(m[1]));
      return JSON.stringify({ ore: [{ testo: riga, righe: n.slice(2) }], memorie: [] });
    };
    try { return (await C.compatta({ incognito: false, motivo: 'prova', forza: true })).fatto; } finally { C._dip.chiama = vero; }
  }, RIGA);
  expect(fatto).toBe(true);
  await modelloFinto(app, [{ text: 'Carbonara, come ieri.' }]);
  try {
    await chiedi(page, 'cosa avevo deciso di cucinare?');
    await expect(page.locator('.dash-bubble').filter({ hasText: 'Carbonara, come ieri.' })).toBeVisible({ timeout: 20000 });
    const [richiesta] = await chiamateAlModello(app);
    expect(richiesta[0].content, 'la riga delle ore entra nel CONTESTO').toContain(RIGA);
    const suDisco = await app.evaluate(async () => (await globalThis.SN_COMPATTAZIONE.righe(false)).ore.map((o) => o.testo));
    expect(suDisco, 'e resta nel diario').toContain(RIGA);
  } finally {
    await ripristina(app);
  }
});
