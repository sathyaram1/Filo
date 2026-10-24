# Risposte per il badge OpenSSF Best Practices

Bozza delle risposte al questionario del livello «passing» di
[bestpractices.dev](https://www.bestpractices.dev/en/projects/new) (#1421). La
prepara un agente; la invia l'owner, che entra con il suo account GitHub,
sceglie il repository `sathyaram1/Filo` e incolla risposta e motivazione di ogni
criterio. Le motivazioni diventano pubbliche sulla pagina del badge.

Va inviata dopo i passi sulla sicurezza del repository (avvisi di Dependabot,
CodeQL, secret scanning, segnalazione privata delle vulnerabilità), perché
quattro risposte dipendono da loro: `vulnerability_report_private`,
`no_leaked_credentials`, `static_analysis`, `static_analysis_fixed`. Ottenuto
il numero del progetto, il badge si aggiunge al README.

Le righe con **Da decidere** spettano all'owner. Sono tutte MUST, e finché una
resta Unmet il badge non arriva a «passing»: `interact`, `contribution`,
`discussion`, `report_archive`, `vulnerability_report_response`, `warnings` (con
`warnings_fixed`), `know_secure_design`, `know_common_errors`,
`vulnerabilities_fixed_60_days`.

## Basics

| Criterio | Livello | Risposta | Motivazione |
|---|---|---|---|
| description_good | MUST | Met | Il README dice cos'è Filo nel primo paragrafo: https://github.com/sathyaram1/Filo#readme |
| interact | MUST | **Da decidere** | Come averlo (filo.red, GitHub Releases) il README lo dice. Come mandare un feedback (dall'app) e come contribuire no: manca un paragrafo nel README. |
| contribution | MUST | **Da decidere** | Oggi il codice lo scrivono agenti a partire dai feedback, e su main fonde solo il server. Va scritto se si accettano richieste di fusione da fuori e come. |
| contribution_requirements | SHOULD | Met | Le regole per una modifica (convenzioni, prove, verifica) stanno in CLAUDE.md: https://github.com/sathyaram1/Filo/blob/main/CLAUDE.md |
| floss_license | MUST | Met | Apache-2.0. |
| floss_license_osi | SUGGESTED | Met | Apache-2.0 è approvata da OSI. |
| license_location | MUST | Met | https://github.com/sathyaram1/Filo/blob/main/LICENSE |
| documentation_basics | MUST | Met | README (avvio, architettura, prove), SECURITY.md, documenti in `transparency/`. |
| documentation_interface | MUST | Met | Cosa sa fare Filo, voce per voce: https://github.com/sathyaram1/Filo/blob/main/src/shared/capabilities.js |
| sites_https | MUST | Met | Il repository (github.com) e il sito (filo.red) si aprono in HTTPS. |
| discussion | MUST | **Da decidere** | Le issue di GitHub sono aperte, ma i feedback arrivano dall'app e le routine le issue non le leggono. O le issue entrano fra i canali letti, o si dichiara Unmet. |
| english | SHOULD | Unmet | Documenti e app sono in italiano. |
| maintained | MUST | Met | Commit ogni giorno, una versione nuova ogni sei ore quando la suite è verde. |

## Change Control

| Criterio | Livello | Risposta | Motivazione |
|---|---|---|---|
| repo_public | MUST | Met | https://github.com/sathyaram1/Filo |
| repo_track | MUST | Met | git: ogni modifica ha autore, data e messaggio. |
| repo_interim | MUST | Met | Rami e commit sono pubblici prima di ogni versione. |
| repo_distributed | SUGGESTED | Met | git. |
| version_unique | MUST | Met | Ogni versione ha un numero suo (`package.json`) e il tag `v<numero>`. |
| version_semver | SUGGESTED | Met | Numeri nella forma MAJOR.MINOR.PATCH. |
| version_tags | SUGGESTED | Met | Tag `v<numero>` su ogni release: https://github.com/sathyaram1/Filo/releases |
| release_notes | MUST | Met | Le novità di ogni versione stanno in `src/shared/patchNotes.js`, e l'app le mostra dopo l'aggiornamento. |
| release_notes_vulns | MUST | N/A | Nessuna vulnerabilità di Filo ha avuto un CVE. Quando succederà, la nota della versione che la corregge dovrà nominarla. |

## Reporting

| Criterio | Livello | Risposta | Motivazione |
|---|---|---|---|
| report_process | MUST | Met | Dall'app, col canale dei feedback: https://github.com/sathyaram1/Filo/blob/main/SECURITY.md (§6) |
| report_tracker | SHOULD | Met | Ogni feedback ha un numero e uno stato: https://github.com/sathyaram1/Filo/blob/main/FEEDBACK-STATES.md |
| report_responses | MUST | Met | Chi manda un feedback ne vede lo stato nell'app, e a lavoro chiuso riceve una frase di risposta quando qualcosa è cambiato. |
| enhancement_responses | SHOULD | Met | Le richieste di funzioni passano dallo stesso canale e hanno la stessa risposta. |
| report_archive | MUST | **Da decidere** | La bacheca con i feedback chiusi è pubblica ma sta dentro l'app, non sul web. Met se la bacheca va anche sul sito. |
| vulnerability_report_process | MUST | Met | https://github.com/sathyaram1/Filo/blob/main/SECURITY.md#come-segnalare-un-problema-di-sicurezza |
| vulnerability_report_private | MUST | Met | Segnalazione privata di GitHub ed email hello@filo.red, nella stessa sezione. |
| vulnerability_report_response | MUST | **Da decidere** | Met se negli ultimi sei mesi ogni segnalazione di sicurezza ha avuto una prima risposta entro 14 giorni, o se non ne sono arrivate. |

## Quality

| Criterio | Livello | Risposta | Motivazione |
|---|---|---|---|
| build | MUST | Met | `npm install`, poi `npm run build` (Windows), `npm run build:mac`, `npm run build:linux` con electron-builder. |
| build_common_tools | SUGGESTED | Met | npm ed electron-builder. |
| build_floss_tools | SHOULD | Met | Node.js, npm, Electron ed electron-builder sono tutti open source. |
| test | MUST | Met | Unit in `tests/unit/` (node:test) e spec Playwright in `tests/`; come lanciarli: README, sezione «Test». |
| test_invocation | SHOULD | Met | `npm test` e `npm run test:unit`. |
| test_most | SUGGESTED | Unmet | La copertura non si misura. |
| test_continuous_integration | SUGGESTED | Met | La suite completa gira in GitHub Actions a ogni fusione su main, gli unit sul risultato della fusione prima. |
| test_policy | MUST | Met | CLAUDE.md, «Verifica: niente "fatto" senza aver eseguito»: un lavoro finisce con una prova che senza la correzione è rossa. |
| tests_are_added | MUST | Met | Le fusioni recenti portano le loro prove (ogni commit di fusione su main). |
| tests_documented_added | SUGGESTED | Met | CLAUDE.md, sezione «Verifica». |
| warnings | MUST | **Da decidere** | Gran parte dei moduli usa la modalità rigida di JavaScript (`'use strict'`), ma non c'è un linter. Met con un linter, o dichiarando la modalità rigida come «safe language mode». |
| warnings_fixed | MUST | **Da decidere** | Segue la risposta a `warnings`. |
| warnings_strict | SUGGESTED | Unmet | Nessun linter. |

## Security

| Criterio | Livello | Risposta | Motivazione |
|---|---|---|---|
| know_secure_design | MUST | **Da decidere** | Lo dichiara l'owner. Le scelte di design stanno in SECURITY.md, e ogni modifica passa da un controllo di sicurezza prima della fusione. |
| know_common_errors | MUST | **Da decidere** | Lo dichiara l'owner. Il controllo di sicurezza cerca gli errori comuni su ogni diff. |
| crypto_published | MUST | Met | Feedback: ECDH P-256, HKDF-SHA256, AES-256-GCM. Profilo segreto: Argon2id e AES-256-GCM. Credenziali: il portachiavi del sistema. Rete: TLS. |
| crypto_call | SHOULD | Met | WebCrypto, il modulo crypto di Node.js, hash-wasm per Argon2id. |
| crypto_floss | MUST | Met | Tutto con librerie open source. |
| crypto_keylength | MUST | Met | P-256 e AES-256. |
| crypto_working | MUST | Met | Nessun algoritmo rotto nelle protezioni. SHA-1 compare solo come nome di una cache, non per sicurezza. |
| crypto_weaknesses | SHOULD | Met | Come sopra. |
| crypto_pfs | SHOULD | Met | Le connessioni passano da TLS con scambio di chiavi effimero (Chromium e Node.js). |
| crypto_password_storage | MUST | N/A | Filo non conserva password: l'accesso è con Google o con un'identità anonima. |
| crypto_random | MUST | Met | Chiavi e nonce vengono da `crypto.getRandomValues` e `crypto.randomBytes`. |
| delivery_mitm | MUST | Met | Download e aggiornamenti passano solo da HTTPS (filo.red, GitHub Releases). |
| delivery_unsigned | MUST | Met | L'aggiornamento automatico controlla l'impronta SHA-512 del pacchetto, letta in HTTPS dalla release. |
| vulnerabilities_fixed_60_days | MUST | **Da decidere** | Il README dice che ci sono problemi di sicurezza noti aperti, e i punti deboli di `transparency/security.md` sono pubblici. Met solo se nessuno di gravità media o più alta è noto da oltre 60 giorni. |
| vulnerabilities_critical_fixed | SHOULD | Met | Una correzione fusa su main arriva a tutti con l'aggiornamento automatico, di regola in qualche ora. |
| no_leaked_credentials | MUST | Met | Il secret scanning di GitHub non ha avvisi aperti (da ricontrollare il giorno dell'invio). |

## Analysis

| Criterio | Livello | Risposta | Motivazione |
|---|---|---|---|
| static_analysis | MUST | Met | CodeQL in configurazione predefinita, a ogni spinta su main e ogni settimana. |
| static_analysis_common_vulnerabilities | SUGGESTED | Met | Le regole di sicurezza di CodeQL per JavaScript. |
| static_analysis_fixed | MUST | Met | Ogni avviso nuovo diventa un feedback e si corregge come gli altri. Vale quando il compito di audit settimanale legge gli avvisi. |
| static_analysis_often | SUGGESTED | Met | A ogni spinta su main. |
| dynamic_analysis | SUGGESTED | Unmet | Le prove Playwright aprono l'app vera, ma non c'è un fuzzer né uno scanner dinamico. |
| dynamic_analysis_unsafe | SUGGESTED | N/A | JavaScript non ha accessi alla memoria da proteggere. |
| dynamic_analysis_enable_assertions | SUGGESTED | Unmet | Nessuna analisi dinamica. |
| dynamic_analysis_fixed | MUST | N/A | Nessuna analisi dinamica. |
