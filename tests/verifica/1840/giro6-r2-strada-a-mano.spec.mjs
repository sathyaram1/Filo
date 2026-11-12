// Verifica #1840 giro 6, rilievo 2: dopo una lettura il costo 4 è un no, e il no deve dire dove l'utente lo fa a mano
// (la frase sotto i livelli lo promette: «lo fai tu a mano, dove sta la voce»). Archivio e pagine visitate non lo dicono.
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';

const execAction = (app, action, opts) =>
  app.evaluate((_electron, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });
const ricerca = { type: 'CERCA_WEB', query: 'x', _output: { results: [{ url: 'https://pagina.example/', title: 'Pagina', snippet: 'testo' }] } };

test('r2 il no a svuotare l\'archivio o cancellare le pagine visitate dopo una ricerca dice dove farlo a mano', async ({ app }) => {
  await home(app);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ autonomia: { livello: 'default' } }));
  const casi = [
    [{ type: 'CANCELLA_ARCHIVIO', query: 'ricette' }, 'svuota l\'archivio delle ricette', /Togli dal filo|tasto destro|filo:\/\//i],
    [{ type: 'CANCELLA_PAGINE', periodo: 'oggi' }, 'cancella le pagine visitate di oggi', /Sicurezza|filo:\/\/security/i],
  ];
  const senzaStrada = [];
  for (const [azione, richiesta, strada] of casi) {
    const r = await execAction(app, azione, { contesto: [ricerca], richiesta });
    expect(r.no, `${azione.type}: ${JSON.stringify(r).slice(0, 200)}`).toBe(true);
    if (!strada.test(String(r.error || ''))) senzaStrada.push(`${azione.type}: «${r.error}»`);
  }
  expect(senzaStrada, senzaStrada.join('\n')).toEqual([]);
});
