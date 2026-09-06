# Sintesi vocale/operazioni a modello lente: spezza in chunk + cache, non un colpo solo

Il modello di sintesi vocale sintetizza TUTTO l'audio prima di rispondere: su testo
lungo l'attesa iniziale è di parecchi secondi. Il pattern per le operazioni a
modello con latenza che cresce con l'output è **spezzare in pezzi piccoli e fare
pipeline**: sintetizza/elabora il PRIMO pezzo corto e usalo subito, mentre i
successivi si preparano in parallelo (concorrenza limitata: corrente + successivo
in volo). Il tempo prima del primo risultato crolla; il modello non diventa più
veloce, ma l'utente smette di aspettarlo tutto.

- **Affianca SEMPRE una cache** keyed sul contenuto (qui `sha1(model|voce|testo)`):
  rifare lo stesso pezzo dev'essere istantaneo. Per artefatti GROSSI (audio) la
  cache è **in-memoria, limitata per byte** (`src/shared/ttsCache.js`), NON
  `chrome.storage`/`storage.json` (lo gonfierebbe e rallenterebbe ogni I/O di
  storage — diversamente da `aiCache.js` che cachea solo testo).
- **Logica pura testabile a parte:** il chunking e la mappa avanzamento→posizione
  vivono in `src/shared/ttsChunk.js` (unit test `tests/unit/ttsChunk.test.mjs`),
  così non serve aprire Electron per verificarli.
- **Dove:** pipeline in `src/content/tts.js` (`readAloud`), cache+hash
  nell'handler `MSG.TTS_SYNTH` in `src/main/services/handlers/ai.js`.
