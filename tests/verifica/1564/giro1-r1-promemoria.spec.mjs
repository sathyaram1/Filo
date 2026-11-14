// Verifica #1564 giro 1, rilievo 1: nello strumento dei promemoria lo stesso dato ha due nomi (orario/time,
// secondi), e il controllo dei campi obbligatori respinge il nome che il gestore accetta. Modello finto.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from '../../helpers/chatFinta.mjs';

test('r1 «allunga il timer a 10 minuti»: promemoria(modifica) coi secondi, come dice la sua riga, cambia la durata', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.addTimer({ label: 'pasta', seconds: 60 }));
  await modelloFinto(app, [
    { toolCalls: [{ id: 'm1', name: 'promemoria', arguments: JSON.stringify({ azione: 'modifica', etichetta: 'pasta', secondi: 600 }) }] },
    { text: 'Fatto.' },
  ]);
  await chiedi(page, 'allunga il timer della pasta a 10 minuti');
  await expect.poll(async () => {
    const t = (await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers())).find((x) => x.label === 'pasta');
    return t ? Math.round((Date.parse(t.endsAt) - Date.now()) / 1000) : 0;
  }, { timeout: 10_000, message: 'il timer della pasta dura ancora un minuto' }).toBeGreaterThan(300);
  const c = await chiamateAlModello(app);
  expect(JSON.stringify(c[c.length - 1])).not.toMatch(/manca orario/);
  await ripristina(app);
});

test('r1 «sveglia alle 7:30 per la palestra»: promemoria(sveglia) con orario ed etichetta, i nomi della stessa riga, la mette', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 's1', name: 'promemoria', arguments: JSON.stringify({ azione: 'sveglia', orario: '07:30', etichetta: 'palestra' }) }] },
    { text: 'Fatto.' },
  ]);
  await chiedi(page, 'sveglia alle 7:30 per la palestra');
  await expect.poll(async () => (await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers())).some((x) => x.label === 'palestra'),
    { timeout: 10_000, message: 'nessuna sveglia «palestra»' }).toBe(true);
  await ripristina(app);
});
