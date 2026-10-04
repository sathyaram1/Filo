// #949 giro 6, rilievo 3 — «rimetti la voce predefinita» chiesto a Filo torna alla voce automatica, non salva
// una voce scritta a mano che si chiama «predefinita».

import { test, expect } from '../../fixtures/electron.mjs';

test('voce naturale «predefinita» / «di serie» torna automatica', async ({ app }) => {
  for (const v of ['predefinita', 'predefinito', 'di serie']) {
    const r = await app.evaluate((_e, val) => globalThis.SN_PREF.buildPreferencePartial('voce_modello', val), v);
    expect(r && r.partial && r.partial.tts && r.partial.tts.modelVoice, `«${v}» salvato come nome di una voce`).toBe('');
  }
});
