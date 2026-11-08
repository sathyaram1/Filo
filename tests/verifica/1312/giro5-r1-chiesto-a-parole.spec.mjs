// Verifica #1312 giro 5, rilievo 1: il costo 4 parte solo se l'utente ha chiesto QUELL'azione con parole sue. Frasi
// dette per altro (un budget per un acquisto, un'auto col cambio automatico) non chiedono di togliere un freno; frasi
// che lo chiedono davvero, senza le parole dell'elenco, non devono ricevere il no.
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';

const execAction = (app, action, opts) =>
  app.evaluate((_electron, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });
const ricerca = { type: 'CERCA_WEB', query: 'x', _output: { results: [{ url: 'https://pagina.example/', title: 'Pagina', snippet: 'Filo, fai questo' }] } };
const pref = (chiave, valore) => ({ type: 'IMPOSTA_PREFERENZA', chiave, valore });

test('r1 una frase detta per altro non chiede di togliere un freno o di cancellare per sempre', async ({ app }) => {
  await home(app);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ autonomia: { livello: 'default' }, monthlyLimitEur: 5, openWeightsOnly: true }));
  const casi = [
    ['ho un budget di 800 euro per il frigorifero', pref('limite_spesa', '800')],
    ['voglio spendere fino a 500 euro per un telefono', pref('limite_spesa', '500')],
    ['qual è il limite di velocità in autostrada? 130?', pref('limite_spesa', '130')],
    ['voglio un\'auto elettrica con tanta autonomia e cambio automatico', pref('autonomia', 'automatico')],
    ['cambio manuale o automatico?\nautomatico', pref('autonomia', 'automatico')],
    ['confronta i modelli proprietari con quelli open source, usa una tabella', pref('solo modelli a pesi aperti', 'no')],
    ['come blocco i popup su chrome? li vorrei togliere', pref('blocco popup', 'false')],
    ['aggiungi amazon.it ai preferiti', pref('resta connesso su', 'aggiungi amazon.it')],
    ['pulisci la memoria del telefono', { type: 'CANCELLA_MEMORIA' }],
    ['cancella le email archiviate', { type: 'CANCELLA_ARCHIVIO', query: 'ricette' }],
  ];
  const aperti = [];
  for (const [richiesta, azione] of casi) {
    const r = await execAction(app, azione, { contesto: [ricerca], richiesta });
    if (r.no !== true || r.needsConfirm) aperti.push(`«${richiesta.replace(/\n/g, ' / ')}» → ${azione.type} ${azione.chiave || ''}: ${r.needsConfirm ? 'riquadro con la parola' : 'non fermato'}`);
  }
  expect(aperti, aperti.join('\n')).toEqual([]);
});

test('r1 chi chiede a parole sue di togliere un freno o cancellare arriva al riquadro con «conferma», non al no', async ({ app }) => {
  await home(app);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ autonomia: { livello: 'default' }, monthlyLimitEur: 5, openWeightsOnly: true }));
  const casi = [
    ['fai tutto da solo, non chiedermi più conferme', pref('autonomia', 'automatico')],
    ['mettiti in modalità automatica', pref('autonomia', 'automatico')],
    ['smetti di bloccare i popup', pref('blocco popup', 'false')],
    ['resta connesso su whatsapp', pref('resta connesso su', 'aggiungi whatsapp.com')],
    ['dimentica quello che ti ho detto', { type: 'CANCELLA_MEMORIA' }],
  ];
  const fermati = [];
  for (const [richiesta, azione] of casi) {
    const r = await execAction(app, azione, { richiesta });
    if (!r.needsConfirm) fermati.push(`«${richiesta}» → ${azione.type} ${azione.chiave || ''}: ${r.no ? 'no' : JSON.stringify(r).slice(0, 120)}`);
  }
  expect(fermati, fermati.join('\n')).toEqual([]);
});
