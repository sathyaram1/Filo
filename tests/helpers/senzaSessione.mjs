// Toglie a questo processo di prova la sessione che lo lancia, come fa già il lanciatore degli unit: vale per chi corre
// il file da solo con `node --test` (#1109.1). Va importato per primo; l'elenco sta nel lanciatore.
// Sentinella: tests/unit/proveSenzaSessione.test.mjs.
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IDENTITA_SESSIONE } from '../../scripts/run-unit-tests.mjs';

for (const k of IDENTITA_SESSIONE) delete process.env[k];
// Col biglietto in cartella il ripiego prende il transcript più recente nella cartella di Claude: come nel lanciatore,
// i test ne hanno una loro, vuota (#592.18).
const claude = join(tmpdir(), `filo-claude-dei-test-${process.pid}`);
process.env.CLAUDE_CONFIG_DIR = claude;
process.on('exit', () => { try { rmSync(claude, { recursive: true, force: true }); } catch (_) { /* già via */ } });
