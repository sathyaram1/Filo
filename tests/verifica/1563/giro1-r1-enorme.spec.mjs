// Verifica #1563 giro 1: un solo messaggio enorme nel pezzo da compattare non porta la chiamata di chi compatta oltre
// i 100.000 token, dove Haiku costa cinque volte tanto.
import { test, expect } from '../../fixtures/electron.mjs';

test('r1 un testo incollato da 120.000 token: la chiamata di chi compatta resta sotto i 100.000 token', async ({ app }) => {
  const misura = await app.evaluate(async () => {
    const C = globalThis.SN_COMPATTAZIONE;
    const FC = globalThis.SN_FILO_CONTESTO;
    const t0 = Date.now() - 5 * 60 * 60 * 1000;
    const Chats = globalThis.SN_FILO_CHATS;
    const tesi = `Ecco la mia tesi intera, rileggila: ${'Le api bottinatrici tornano all\'alveare e danzano per indicare i fiori. '.repeat(6000)}`;
    await Chats.append('enorme1', { role: 'user', text: tesi, ts: new Date(t0).toISOString() });
    await Chats.append('enorme1', { role: 'filo', text: 'Letta la tesi.', ts: new Date(t0 + 5000).toISOString() });
    const vero = C._dip.chiama;
    let token = 0;
    C._dip.chiama = async ({ messages }) => {
      token = Math.ceil(FC.caratteriDi(messages) / FC.CARATTERI_PER_TOKEN);
      return JSON.stringify({ ore: [{ testo: '09:00 incollata la tesi sulle api' }], memorie: [] });
    };
    try {
      const r = await C.compatta({ incognito: false, motivo: 'prova', forza: true });
      return { fatto: r.fatto, token, tesi: Math.ceil(tesi.length / FC.CARATTERI_PER_TOKEN) };
    } finally { C._dip.chiama = vero; }
  });
  expect(misura.tesi, 'il testo incollato passa da solo il listino').toBeGreaterThan(100000);
  expect(misura.fatto).toBe(true);
  expect(misura.token, 'la chiamata di chi compatta sta sotto il listino').toBeLessThan(100000);
});
