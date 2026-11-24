// Sentinella (#504.8): «Alt+T senza selezione in un riquadro passa alla pagina» si decide in un posto solo, prima di
// guardare se Filo lì è spento. Una seconda copia per i riquadri spenti resterebbe indietro al primo cambio, e il
// video di un sito spento tornerebbe a fare diverso dagli altri riquadri. Il comportamento lo provano gli spec di
// tests/traduci-pagina-chat.spec.mjs (#504.2, #504.7).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SORGENTE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'content', 'content.js'), 'utf8');

test('Alt+T da un riquadro chiede la traduzione alla pagina da un punto solo', () => {
  const passaggi = SORGENTE.match(/openSurface\(\s*['"]traduci['"]/g) || [];
  assert.equal(passaggi.length, 1, `content.js chiede la traduzione alla pagina da ${passaggi.length} punti: la regola sta in uno`);
});

test('la decisione viene prima del silenzio dei siti dove Filo è spento', () => {
  const inizio = SORGENTE.indexOf('msg?.type === MSG.SHORTCUT_TRIGGERED');
  assert.ok(inizio >= 0, 'manca il ramo delle scorciatoie in content.js');
  const ramo = SORGENTE.slice(inizio);
  const passa = ramo.search(/openSurface\(\s*['"]traduci['"]/);
  const tace = ramo.indexOf('isBlocked()');
  assert.ok(passa >= 0 && tace >= 0, 'il ramo delle scorciatoie non ha più il passaggio alla pagina o il controllo di Filo spento');
  assert.ok(passa < tace, 'il passaggio alla pagina sta dopo il controllo di Filo spento: un riquadro spento tacerebbe');
});
