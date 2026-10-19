// I livelli di autonomia (#530, #1312) nelle prove. Finché manca il guardiano il costo 2 chiede un OK a ogni livello;
// dopo una lettura (`DOPO_UNA_RICERCA`) a Normale ogni costo ha la sua risposta (1 subito, 2 un OK, 3 «conferma»);
// il costo 4 vuole «conferma» sempre.
export const DOPO_UNA_RICERCA = Object.freeze({
  contesto: [{ type: 'CERCA_WEB', query: 'x', _output: { results: [{ url: 'https://esempio.test/' }] } }],
});

export async function livelloAutonomia(app, livello) {
  await app.evaluate((_e, l) => globalThis.SN_STORAGE.updateSettings({ autonomia: { livello: l } }), livello);
}
