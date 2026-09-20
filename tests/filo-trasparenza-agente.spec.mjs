// #515 — Quando l'utente chiede «che fine fanno i miei dati? li vendete?»,
// l'agente deve leggere il documento di trasparenza invece di rispondere a
// memoria. Il prompt però gli dichiarava quattro documenti (models, privacy,
// security, business) quando nel repo ne esisteva uno: chiedeva «privacy» e
// tornava a mani vuote, e l'unica difesa era l'onestà del modello di turno.
//
// Qui si prova la catena vera, dentro l'app avviata: le definizioni che partono
// verso il fornitore e l'esito dell'azione, non la copia in un unit test.

import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

const execAction = (app, action) =>
  app.evaluate((_electron, { action }) => globalThis.SN_EXECUTE_FILO_ACTION(action), { action });

const toolTrasparenza = (app) => app.evaluate(() => {
  const T = globalThis.SN_ACTION_TOOLS;
  const def = T.definitions({ sistema: process.platform })
    .find((d) => d.function.name === 'LEGGI_TRASPARENZA');
  return {
    def: def ? def.function : null,
    esistenti: globalThis.SN_TRANSPARENCY.ids(),
    previsti: globalThis.SN_TRANSPARENCY.NAV.map((n) => n.id),
  };
});

test('il prompt dichiara al modello solo i documenti che esistono davvero', async ({ app, openTab }) => {
  await openTab(NEWTAB);
  const { def, esistenti, previsti } = await toolTrasparenza(app);
  expect(def, 'LEGGI_TRASPARENZA non arriva più al modello').toBeTruthy();
  expect(esistenti.length).toBeGreaterThan(0);
  expect(def.parameters.properties.doc.enum).toEqual(esistenti);

  const promesso = `${def.description} ${def.parameters.properties.doc.description}`;
  for (const id of previsti.filter((i) => !esistenti.includes(i))) {
    expect(promesso, `il prompt promette "${id}", che non è stato scritto`)
      .not.toMatch(new RegExp(`(^|[^a-z0-9_-])${id}([^a-z0-9_-]|$)`, 'i'));
  }
});

test('il documento che esiste arriva all\'agente per intero, con le fonti', async ({ app, openTab }) => {
  await openTab(NEWTAB);
  const r = await execAction(app, { type: 'LEGGI_TRASPARENZA', doc: 'models' });
  expect(r.executed).toBe(true);
  expect(r.output.missing).toBe(false);
  expect(r.output.text).toContain('Politica sui modelli');
  expect(r.output.text).toContain('Anthropic');
  expect(r.output.text).toContain('Fonti:');
});

test('un documento non scritto: l\'agente riceve un no esplicito, non un vicolo cieco', async ({ app, openTab }) => {
  await openTab(NEWTAB);
  const previsti = await app.evaluate(() => ({
    mancanti: globalThis.SN_TRANSPARENCY.NAV
      .map((n) => n.id)
      .filter((id) => !globalThis.SN_TRANSPARENCY.ids().includes(id)),
  }));
  test.skip(previsti.mancanti.length === 0, 'tutte le aree hanno il loro documento: niente da provare');

  for (const id of previsti.mancanti) {
    const r = await execAction(app, { type: 'LEGGI_TRASPARENZA', doc: id });
    // Non è una lettura riuscita: il diario non deve scrivere «riletto la
    // trasparenza» per un documento che nessuno ha letto.
    expect(r.executed, `"${id}" risulta letto`).toBe(false);
    expect(r.kept).toBe(true);
    expect(r.output.missing).toBe(true);
    // Il testo torna lo stesso: è quello che impedisce all'agente di inventare.
    expect(r.output.text).toContain(id);
    expect(r.output.text).toContain('NON esiste');
    expect(r.output.text).toContain('memoria');
  }
});

test('senza chiedere un documento preciso torna l\'indice, e resta un esito riuscito', async ({ app, openTab }) => {
  await openTab(NEWTAB);
  const r = await execAction(app, { type: 'LEGGI_TRASPARENZA' });
  expect(r.executed).toBe(true);
  expect(r.output.missing).toBe(false);
  expect(r.output.text).toMatch(/Documenti di trasparenza disponibili: .*models/);
  expect(r.output.text).not.toContain('NON esiste');
});
