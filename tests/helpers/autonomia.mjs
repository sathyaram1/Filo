// I livelli di autonomia (#530) nelle prove. A Normale un compito pulito fa da solo il costo 2: chi prova il popup
// di un costo 2 lo prova a Conservativo, o dopo una lettura (`DOPO_UNA_RICERCA`), dove ogni costo ha la sua risposta
// (1 subito, 2 un OK, 3 «conferma»).
export const DOPO_UNA_RICERCA = Object.freeze({
  contesto: [{ type: 'CERCA_WEB', query: 'x', _output: { results: [{ url: 'https://esempio.test/' }] } }],
});

export async function livelloAutonomia(app, livello) {
  await app.evaluate((_e, l) => globalThis.SN_STORAGE.updateSettings({ autonomia: { livello: l } }), livello);
}
