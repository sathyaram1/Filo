// La config git della copia di lavoro in cui si lancia (l'hook di avvio della sessione): scripts/lib/prepara-copia.mjs.

import { preparaCopia } from './lib/prepara-copia.mjs';

const r = preparaCopia(process.cwd());
if (!r.ok) process.stderr.write(`config della copia non completa: ${[r.commento.why, r.novita.why].filter(Boolean).join('; ')}\n`);
process.exit(r.ok ? 0 : 1);
