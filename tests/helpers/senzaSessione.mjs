// Toglie a questo processo di prova la sessione che lo lancia, come fa già il lanciatore degli unit: vale per chi corre
// il file da solo con `node --test` (#1109.1), anche col biglietto in cartella che accende il ripiego del transcript più
// recente (#592.18). Va importato per primo; l'elenco sta nel lanciatore. Sentinella: tests/unit/proveSenzaSessione.test.mjs.
import { senzaSessione } from './sessione.mjs';

const pulito = senzaSessione();
for (const k of Object.keys(process.env)) if (!(k in pulito)) delete process.env[k];
Object.assign(process.env, pulito);
