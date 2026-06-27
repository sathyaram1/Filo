# Sessione locale (owner + Claude)

Questo file descrive la **sessione locale**: l'owner che lavora con Claude in
chat, sulla sua macchina Windows. Vale insieme a `CLAUDE.md` (convenzioni del
repo). Le routine cloud invece seguono `ROUTINES.md` + `routines/`.

C'è una distinzione importante tra **come si lavora oggi** e **come si lavorerà
quando le routine cloud saranno riaccese**. Le due modalità divergono su una cosa
sola: *chi scrive il codice di Filo*.

---

## Stato attuale — routine cloud SPENTE (modalità di OGGI)

Le routine cloud su claude.ai sono **spente** (dal ~2026-06-25). Quindi **in
locale si fa tutto**:

- **Si scrive codice in Filo** (fix, feature, refactor): nessuno lo fa al posto
  nostro, quindi è il lavoro principale della sessione locale.
- **Si fanno i `firebase deploy`** (rules e functions): da quando le routine sono
  spente, Claude esegue i deploy in autonomia (`firebase deploy --only
  firestore:rules`, `--only functions:security`, ecc.), non sono più solo azione
  owner.
- **Si lavora su `filo-security`** (backend privato): il repo è
  `C:/Users/agenti AI/Desktop/filo-security`, con la sua coda in
  `filo-security/TASKS.md`. Le routine non lo vedono, quindi è lavoro locale.
- **Si scrivono e si lavorano i feedback**: si discute con l'owner, si triagiano
  e si risolvono i feedback degli alpha tester.

In questa modalità il loop avversariale (verifier → fixer → secaudit) e la coda
git→Action non girano da soli: se serve, si esercitano a mano in locale.

---

## Stato bersaglio — quando le routine cloud saranno RIACCESE

Quando le routine torneranno attive, la divisione del lavoro cambia: il **codice
di Filo lo scrivono le routine**, e la sessione locale si concentra su ciò che le
routine NON possono o NON devono fare.

- **NON si scrive codice di prodotto in Filo**: il lavoro su feedback pubblici
  (fix/feature visibili all'utente) passa alle routine cloud, che selezionano il
  lavoro via `scripts/dispatch.mjs` e lo eseguono con il cancello di merge
  L4/L5. Toccare lo stesso codice in locale rischierebbe conflitti con le feature
  in volo.
- **In locale owner + Claude**: **discutono** (prodotto, design, priorità),
  **scrivono feedback** (incluso spezzare le spec grosse in sub-feedback che poi
  le routine lavorano), e **lavorano su `filo-security`** (il backend privato che
  le routine non vedono e non possono toccare).
- I `firebase deploy` tornano coordinati con l'owner dove serve (vedi le azioni
  owner in `TASKS.md`).

---

## In sintesi

| | Routine SPENTE (oggi) | Routine RIACCESE (bersaglio) |
|---|---|---|
| Codice Filo | **in locale** | routine cloud |
| Feedback | scritti + risolti in locale | scritti in locale, risolti dalle routine |
| `filo-security` | in locale | in locale |
| `firebase deploy` | Claude in locale | coordinato con owner |

**Modalità attiva ADESSO: routine SPENTE → si fa tutto in locale.**
