<!-- Copia nel repo della spec dell'owner (Desktop/Filo/SPECIFICHE), portata qui il 2026-09-04 perché le routine possano leggerla. Feedback di implementazione: #546. Questa è la fonte di verità: aggiornare qui. -->

# Filo — Secret Profile & Privacy Features Spec

## Overview

Filo's privacy model is built on three distinct tools, each covering a different use case:

- **Incognito mode** (already implemented): ephemeral session, nothing persists. For one-off private browsing.
- **Secret profiles** (this spec): persistent but hidden profiles with full deniable encryption. For recurring private activity with memory, history, and file storage.
- **Category blocking** (this spec): self-imposed content blocking by category. For filtering unwanted content (e.g., pornographic pop-ups from piracy sites).

These are independent features. A user may use any combination.

---

## Secret Profiles

### Commands

| Action | Italian | English |
|--------|---------|---------|
| Enter / Create | `/segreto NOME` | `/secret NAME` |
| Exit | `/segreto esci` | `/secret exit` |

**Create and enter are unified.** When the user types `/segreto NOME`:
- If a secret with that name exists → enter it.
- If no secret matches → ask "Vuoi creare un nuovo segreto con questo nome?" and proceed on confirmation.
- This confirmation prompt must leave no trace (no log, no history entry, no analytics event).

**If the name is wrong** (typo or non-existent), the behavior is identical to "no secret matches" — the user is prompted to create. This is intentional: an observer cannot distinguish "wrong name" from "no secrets exist." The user can simply decline and retry.

### What a Secret Profile Contains

Each secret profile is a fully isolated environment with its own:

- **Browsing history** (URLs, titles, tab summaries generated on close)
- **Agent memory** (text — Filo's learned preferences for this profile)
- **Chat history** (full conversations with Filo within this profile)
- **Clipboard history** (text and images copied while in this profile)
- **Stored files** (user can save small files: photos, documents, text)

### Data Isolation — Architectural Principle

**Privacy guarantees must be enforced by code, never by LLM prompting.**

The LLM cannot be trusted to reliably "forget" or "ignore" information in its context. Therefore:

- When in the **main profile**, the LLM receives zero data from any secret profile. Not suppressed — absent. The secret profile's memory, history, and files are never loaded into context.
- When in a **secret profile**, the LLM receives only that profile's data. No cross-profile data leakage.
- The **memory pipeline** (automatic memory generation from browsing/chat) runs within the active profile's silo only. A browsing session in a secret profile generates memories only in that profile's storage.
- Recommendations, suggestions, and personalization in the main profile are never influenced by secret profile activity, because the main profile's LLM context never contains that data.

This is not a "don't use this data" instruction to the model. It is a structural guarantee: the data is not in the context window.

### Encrypted Container Architecture

Rivista il 2026-09-04 (owner + Claude). Feedback di implementazione: #546.

#### Container Basics

- A single encrypted container file is created at **Filo installation for all users**, whether or not they ever create a secret. If the file only appeared after creating a secret, its existence would be a signal.
- **Fixed size: 1 GB**, identical for every install, never grows. Usable capacity is about **500 MB across all secrets** because of the 2× redundancy below. A cloud backup (later) will move the real deposit off-device; then the container is only a repairable cache.
- All unused space is filled with **cryptographically random data**, indistinguishable from encrypted content.
- Located in Filo's standard data directory alongside other Filo data files.

#### Encryption Scheme

- **Key derivation:** `key = Argon2id(NOME, device_salt)` with high memory/time parameters.
- `device_salt` is random, generated at installation, stored in Filo's standard config. Not secret: it only defeats precomputed tables.
- **Every block is encrypted and authenticated on its own** (AES-GCM, nonce derived from the block position). On open, Filo knows with certainty which blocks are its own and intact and which have been overwritten.

#### Placement: no index, positions derived from the key

- Blocks of **4 KB**. **No master index**, no pointer table: nothing records how many secrets exist or where they live.
- Logical block `j`, copy `c` lives at `hash(key, j, c) mod N`. Nothing to store.
- If that position is occupied by a *declared* secret (see below), a retry counter is used: `hash(key, j, c, r)` with increasing `r`. On read, positions are tried in order until authentication succeeds. The counter is never stored.

#### Redundancy and self-repair

- **Reed-Solomon 10+10**: every 10 data blocks produce 10 parity blocks; any 10 of the 20 rebuild the group. Costs 2× space. Plain 3× replication was rejected: costs more and survives less.
- **Repair on every open**: Filo verifies all blocks of the secret, rebuilds missing ones from parity and rewrites them. **Silently** — a "repaired N blocks" message would reveal that other secrets were written.
- Why: with no index, a second secret cannot know which blocks are taken and may overwrite the first. With RS 10+10 on 1 GB the risk depends almost only on how much *other* secrets saved between two openings of yours, little on your own size: up to ~50 MB saved by others, loss stays below 0.5% even for a 300 MB profile of images; around 100 MB it becomes likely. Anyone who declares the other names has zero damage.

#### Declaring other secrets (optional, at creation and on open)

- At creation, an optional field: "Se hai altri segreti, scrivi i loro nomi: così non li tocco e li riparo". With those names Filo derives their keys, verifies and **repairs** them, and places the new secret's blocks away from theirs. Names live in memory only for that operation; nothing is logged.
- On a normal open, an optional "vuoi controllare anche altri segreti?" does the same check-and-repair.

#### Deletion

Deleting a secret means overwriting all of its blocks with random data from inside the secret itself. There is no other deletion path.

#### Security Properties

| Property | Guarantee |
|----------|-----------|
| Content protection | Encrypted; unreadable without the name |
| Existence protection | No metadata reveals whether any secrets exist |
| Count protection | Cannot determine how many secrets are stored |
| Plausible deniability | Container exists for all users; an empty container is indistinguishable from one with 10 secrets |
| Brute force resistance | Argon2id with high parameters |
| Survival of undeclared secrets | Probabilistic (RS 10+10 + repair on open); certain if names are declared |

Known residual: the holder of a secret, seeing repairs happen, can infer that other secrets were written. Only the holder sees this, never an outside observer; accepted.

#### No Recovery by Design

If the user forgets the secret name, the data is permanently inaccessible. Any recovery mechanism would require a master index, which would reveal that secrets exist. Communicated clearly at creation time.

#### Backup (later)

Client-side encrypted blobs on Filo servers; only the backup key is kept inside the secret, with heavy redundancy. Backup traffic is itself a signal: cover it with a small dummy upload identical for every user, or state the limit.

### UX While in a Secret Profile

- A subtle visual indicator shows the user they are in a secret profile (so they don't forget). Exact design TBD, but it must be:
  - Visible enough that the user notices.
  - Subtle enough that a passerby doesn't immediately understand what it means.
- All Filo features work normally within the secret profile (browsing, chat, commands, right-click actions).
- The secret profile has its own set of tabs, independent of the main profile's tabs.

---

## Category Blocking

A separate, independent feature. Not related to secret profiles.

### Purpose

Allows the user to block content by category as a personal preference. Primary use case: filtering unwanted content such as pornographic pop-ups/redirects from piracy sites, or any category the user finds undesirable.

### How It Works

- The user opts in and specifies categories to block (e.g., "siti pornografici", "gambling").
- Filo can accept natural language descriptions of categories.
- When a page is loaded, it is evaluated against blocked categories.
- If it matches, the page is blocked with a clear message ("Blocked: this site matches a category you chose to block") and an option to proceed anyway (it's a personal preference, not a restriction).

### Implementation Constraints

- Category matching should use a combination of **domain-level lists** (known domains per category) and **page-level heuristic/LLM classification** for ambiguous cases.
- The LLM classification is used **only for real-time page evaluation**. It must not persist any information about what was classified or blocked — no memory entries, no history entries, no analytics.
- The list of blocked categories is stored locally in Filo's standard (non-secret) settings. This is acceptable because it's a personal preference, not hidden information — the user chose it openly.

---

## Summary of Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| Container always exists (even with 0 secrets) | Deniability: existence of file reveals nothing |
| 1 GB fixed size, RS 10+10, repair on open | ~500 MB usable; undeclared secrets survive each other statistically, declared ones with certainty |
| No master index | Cannot determine if/how many secrets exist |
| Argon2id key derivation | Brute force resistance |
| No recovery mechanism | Inherent to deniable encryption; any recovery breaks deniability |
| Privacy enforced by architecture, not prompts | LLM behavior is not formally verifiable; code is |
| Create and enter unified as one command | Fewer commands, less surface for error |
| Category blocking is code-level, not LLM-level for persistence | LLM evaluates in real-time but stores nothing |
