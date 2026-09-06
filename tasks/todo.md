# Takenlijst: branch-gebaseerde ADR-lifecycle

Bron: [GitHub issue #1](https://github.com/sjefsharp/agentic-delivery/issues/1). Het officiële besluit ontstaat pas wanneer de wijzigings-PR naar `main` wordt gemerged.

## Fase 1: Proces en agent-harness

- [x] Leg vast dat een issue niet automatisch een ADR is.
- [x] Beschrijf ADR-subissues voor triage/refining en implementatie.
- [x] Beschrijf branch-lokale ADR-context en `main` als officiële waarheid.
- [x] Verwijder lifecycle-status uit ADR-frontmatter en het template.
- [x] Werk `AGENTS.md`, de architecture-decision skill en agentconfiguratie bij.
- [x] Breid het issueformulier uit voor ADR-toevoeging en ADR-verwijdering.

## Fase 2: Validatie en opruimen

- [x] Laat de ADR-validator statusloze frontmatter controleren.
- [x] Verwijder acceptance-workflows en statusmutatiescripts.
- [x] Verwijder tests en fakes die uitsluitend de acceptance-keten testen.
- [x] Laat `adr-quality.yml` alleen nog kwaliteitsvalidatie uitvoeren.
- [x] Voeg alle nieuwe label- en runbookcontracten toe aan de tests.

## Fase 3: GitHub-administratie

- [x] Richt `adr:needed` in voor triage zonder ADR-PR.
- [x] Richt `adr:proposed` in voor een actieve ADR-PR.
- [x] Richt `adr:removal` in als verwijderingsmodifier.
- [x] Richt `adr:rejected` in voor een afgewezen, niet-gemergede proposal.
- [x] Werk issue #1 bij met het definitieve runbook, de labels en de implementatielinks.
- [ ] Configureer branch protection voor `main` buiten de repository.

## Checkpoint: lokale implementatie

- [x] Geen `status:`-velden in ADR-frontmatter.
- [x] Geen verwijzingen naar verwijderde acceptance-workflows of scripts buiten negatieve contracttests.
- [x] Alle shelltests slagen.
- [x] Markdown- en YAML-validatie slagen.

## Checkpoint: repositoryproces

- [ ] Nieuwe ADR: issue/subissue → feature branch → PR → approval → merge → issue-update/sluiting.
- [ ] ADR-verwijdering: issue/subissue → feature branch → bestand verwijderen → PR → approval → merge → issue-update/sluiting.
- [x] Rejected proposal: reden in issue → label `adr:rejected` → PR sluiten; niets op `main`.
- [x] Agents gebruiken alleen ADR’s op `main` als officiële context.
