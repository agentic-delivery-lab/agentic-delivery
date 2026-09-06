# Implementatieplan: branch-gebaseerde ADR-lifecycle

## Overzicht

Issue #1 beschrijft de conventie voor architectuurbesluiten. Een issue is de opdrachtbrief, maar wordt niet automatisch een ADR. Een ADR kan tijdens triage, refining of implementatie ontstaan als nieuw issue-subissue of als onderdeel van het bestaande issue. Toevoegen en verwijderen gebeurt in een feature branch; alleen de inhoud van `main` is officiële repositorycontext.

ADR’s bevatten geen lifecycle-status in YAML-frontmatter. Een goedgekeurde PR naar `main` maakt een toegevoegd ADR officieel; een goedgekeurde verwijderings-PR maakt het niet langer officieel. GitHub branch protection is de mergegrens. GitHub Actions voeren geen acceptatie of statusmutatie uit; de bestaande kwaliteitsworkflow blijft alleen validatie uitvoeren.

## Beslissingen

- Gebruik `docs/decisions/NNNN-title-with-dashes.md` voor officiële ADR-records.
- Houd de frontmatter beperkt tot metadata zoals datum, bronissue en betrokkenen; geen `status`.
- Gebruik `main` als enige bron voor officiële ADR-context.
- Laat branch-lokale ADR-toevoegingen en -verwijderingen gelden als voorlopige context voor die branch.
- Gebruik een normaal issue of sub-issue als opdrachtbrief en audit trail.
- Gebruik labels alleen voor triage: `adr:needed`, `adr:proposed`, `adr:removal` en `adr:rejected`.
- Gebruik geen `adr:accepted`-label; een bestand op `main` is de geaccepteerde toestand.

## Uitvoeringsvolgorde

1. Werk de procesdocumentatie, het ADR-template en ADR-0001 bij.
2. Werk `AGENTS.md`, de architecture-decision skill en het issueformulier bij.
3. Maak de validator en contracttests statusloos.
4. Verwijder acceptance-workflows, statusmutatiescripts en obsolete tests.
5. Werk issue #1 bij met het definitieve runbook en richt labels in.
6. Verifieer Markdown, YAML, shelltests en resterende workflowverwijzingen.
7. Configureer buiten de repository branch protection voor `main`.

## Acceptatiecriteria

- Een generiek issue kan tijdens triage/refining een ADR-subissue krijgen.
- Het ADR-issueformulier ondersteunt zowel toevoeging als verwijdering.
- Een ADR zonder `status` is geldig; een `status`-veld wordt afgewezen.
- Agentinstructies onderscheiden officiële `main`-context van branch-lokale context.
- Oude acceptance-workflows en statusmutatiescripts bestaan niet meer.
- Een toevoeging of verwijdering wordt pas repository-breed effectief na merge naar `main`.
- Issue #1 wordt na de actie bijgewerkt en na succesvolle merge gesloten wanneer het een zelfstandig ADR-tracking issue is.
- Alle lokale kwaliteitstests slagen.

## Externe randvoorwaarden

- `main` moet pull requests, vereiste checks en een approval vereisen.
- Directe pushes en bypasses voor `main` moeten uitgeschakeld zijn.
- Een afzonderlijke reviewer-identiteit is nodig; de enige PR-auteur kan niet zelf goedkeuren.
- Het huidige private-repositoryplan moet branch protection ondersteunen; anders is een planupgrade of publieke repository nodig.

## Verificatie

- `./tests/adr/test_validate_adrs.sh`
- `./tests/adr/test_architecture_decision_skill.sh`
- `./tests/adr/test_repository_contract.sh`
- `git diff --check`
- YAML parsing van het issueformulier, de kwaliteitsworkflow en agentconfiguratie.
- `rg`-controle op oude acceptance-workflows, statusmutaties en stale procesbeschrijvingen.
