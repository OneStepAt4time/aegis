# Auto-Labeler GitHub Action — SPEC

## Decisioni (team 5 Aprile 2026)
- P2-P4: AUTO label (keyword + template + area)
- P0-P1: MANUAL labels only
- Template-based: già configurato (bug/enhancement/security dai form)

## Obiettivo
GitHub Action che applica labels automaticamente a issue nuovi/reopened.

## Label targets

### Area Labels (keyword → label mapping)
| Keyword | Label |
|---------|-------|
| dashboard, ui, frontend, pane, terminal | dashboard |
| backend, api, endpoint, fastify, server | backend |
| mcp, stdio, tool | mcp |
| ci, github actions, workflow, release | ci |
| security, vulnerability, auth, token | security |
| performance, slow, latency, memory, cpu | performance |
| docs, documentation, readme | documentation |
| test, vitest, coverage, testing | tests |
| tmux, session, pane | tmux |
| windows, linux, macos, cross-platform | platform |
| config, settings, env | configuration |
| error, crash, fail, broken, bug | bug (se non già presente) |

### Priority Labels (P2-P4 auto, P0-P1 NOT auto)
| Keyword | Label |
|---------|-------|
| urgent, critical, important | P1 → NO (manual only) |
| P2 keywords: feature, enhancement, improve | P2 |
| P3 keywords: nice-to-have, someday | P3 |
| P4 keywords: low priority, minor | P4 |

## Logica
1. Se l'issue ha già label P0 o P1 → NON modificare priority
2. Se l'issue ha label area (dashboard, backend, etc.) → NON modificare area
3. Applica solo labels mancanti
4. Template-based labels (bug, enhancement, security) sono già gestiti dai form

## File da creare
- `.github/workflows/auto-label.yml` — workflow file
- `.github/labeler.yml` — labeler config (opzionale, per github/labeler action)

## Alternative implementative
1. **github/labeler** — semplice, no codice, mapping YAML
2. **Custom JavaScript action** — più flessibile, parsing custom

**Scelta:** Custom JavaScript action per controllo su logica P0/P1.

## Risorse
- Labels esistenti: vedere `gh label list --repo OneStepAt4time/aegis`
- Template: `.github/ISSUE_TEMPLATE/*.yml`
