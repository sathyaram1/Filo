// #1403.89: chiede al controllo delle azioni se un testo mandato a un sito porta fuori un segreto.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
for (const f of ['constants.js', 'contenutoEsterno.js', 'capabilities.js', 'themeTokens.js', 'cmdClassify.js',
  'zoomPagina.js', 'urlNav.js', 'autonomia.js', 'preferences.js', 'actionLevels.js']) {
  require(join(ROOT, 'src', 'shared', f));
}
const AL = globalThis.SN_ACTION_LEVELS;

// Il segreto che una ricerca sul web con questo testo porterebbe fuori, '' se per il controllo non ce n'è.
export function segretoCercando(testo) {
  const ing = AL.ingressi({ type: 'CERCA_WEB', query: testo }, { richiesta: '' });
  return ing ? ing.segreto : 'nessun ingresso';
}
