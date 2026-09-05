# Takenlijst: vastlegging van architectuurbesluiten

Bron: [GitHub issue #1](https://github.com/sjefsharp/agentic-delivery/issues/1). Het inhoudelijke plan staat in [`tasks/plan.md`](plan.md).

Status: taken 1–5 zijn lokaal geïmplementeerd en geverifieerd op `feature/adr-workflow`; Codex-autodiscovery is gecontroleerd; PR-CI en taak 6 wachten op menselijke ADR-goedkeuring en merge.

## Taak 1: Stel ADR-0001 op als besluitvoorstel ✅

**Beschrijving:** Maak het eerste MADR-record waarin de repository besluit over locatie, formaat, lifecycle, GitHub-audit trail en agentische ondersteuning. Start met status `proposed`; issue #1 is de opdrachtbrief en primaire bronverwijzing.

**Acceptatiecriteria:**

- [ ] `0001-use-madr-for-architecture-decisions.md` bevat context, drivers, reële alternatieven, uitkomst, consequenties en confirmation.
- [ ] Het record vergelijkt minimaal opslaglocatie, workflowgrens en harness-opties en motiveert de aanbevolen keuzes.
- [ ] Status is `proposed` totdat een menselijke reviewer het besluit expliciet goedkeurt.

**Verificatie:**

- [ ] Handmatige inhoudsreview tegen issue #1 en MADR 4.0.
- [ ] Alle bron- en kruisverwijzingen openen correct.
- [ ] `git diff --check` slaagt.

**Afhankelijkheden:** Geen.

**Waarschijnlijk geraakte bestanden:**

- `docs/decisions/0001-use-madr-for-architecture-decisions.md`

**Geschatte omvang:** Klein (1 bestand).

## Taak 2: Leg de ADR-conventie en template vast ✅

**Beschrijving:** Maak de canonieke beslissingenindex en een afgeslankte MADR 4.0-template. Leg nummering, verplichte velden, statusovergangen, superseding-regels, issue/PR-koppeling, criteria en verantwoordelijkheden op één plek vast.

**Acceptatiecriteria:**

- [ ] De template vereist status, datum, bronissue, context, drivers, opties, uitkomst, consequenties en confirmation.
- [ ] De index beschrijft wanneer wel/niet een ADR nodig is en de volledige issue-naar-ADR-workflow.
- [ ] Nummering en lifecycle zijn ondubbelzinnig en bestaande records worden nooit verwijderd bij vervanging.

**Verificatie:**

- [ ] Maak handmatig een tijdelijk voorbeeld vanuit de template en controleer dat geen essentiële context ontbreekt.
- [ ] Controleer dat index, template en ADR-0001 dezelfde terminologie gebruiken.
- [ ] `git diff --check` slaagt.

**Afhankelijkheden:** Taak 1.

**Waarschijnlijk geraakte bestanden:**

- `docs/decisions/README.md`
- `docs/decisions/adr-template.md`
- `docs/decisions/0001-use-madr-for-architecture-decisions.md`

**Geschatte omvang:** Middel (3 bestanden).

## Checkpoint: besluitbasis na taken 1-2

- [ ] ADR-0001 is inhoudelijk door een mens beoordeeld.
- [ ] De voorkeursrichting is expliciet goedgekeurd voordat afgeleide harnessbestanden worden vastgezet.
- [ ] Alle Markdown is intern consistent en links naar issue #1 en MADR werken.

## Taak 3: Voeg een architectuurbesluit-issueformulier toe ✅

**Beschrijving:** Maak een GitHub Issue Form dat als opdrachtbrief dient en de informatie verzamelt die nodig is om een ADR-voorstel te onderzoeken, zonder de uitkomst vooraf vast te leggen.

**Acceptatiecriteria:**

- [ ] Het formulier vraagt naar probleem/context, scope, drivers/constraints, bekende opties, impact/reversibility, eigenaar en gewenste beslisdatum.
- [ ] Het formulier bevat de ADR-triggers en een korte uitsluitingsregel voor lokale of eenvoudig omkeerbare keuzes.
- [ ] Het aangemaakte issue is direct als `source issue` vanuit een ADR te koppelen.

**Verificatie:**

- [ ] YAML-syntax en GitHub Issue Form-schema zijn geldig.
- [ ] Een preview/proefissue bevat alle verplichte invoer zonder een voorkeursoptie af te dwingen.
- [ ] `git diff --check` slaagt.

**Afhankelijkheden:** Taak 2.

**Waarschijnlijk geraakte bestanden:**

- `.github/ISSUE_TEMPLATE/architecture-decision.yml`
- `docs/decisions/README.md`

**Geschatte omvang:** Klein (2 bestanden).

## Taak 4: Integreer de ADR-workflow in het agent-harness ✅

**Beschrijving:** Voeg minimale rootinstructies en één gerichte repository-skill toe. `AGENTS.md` routeert architectuursignificante keuzes naar de skill; de skill haalt het bronissue op, toetst criteria, onderzoekt opties, maakt alleen een `proposed` ADR en bewaakt de menselijke acceptatiegrens.

**Acceptatiecriteria:**

- [ ] `AGENTS.md` bevat een korte triggerregel en verwijst naar de canonieke ADR-documentatie, zonder die te dupliceren.
- [ ] De skill heeft expliciete positieve/negatieve triggers, invoer, stappen, output, stopcondities en vereist een GitHub-bronissue.
- [ ] Codex ontdekt de skill vanaf de repositoryroot en de skill is als gedeeld skillformaat bruikbaar in ChatGPT.

**Verificatie:**

- [ ] Positieve proefprompt: een kostbare cross-cutting keuze activeert de workflow en levert `proposed` op.
- [ ] Negatieve proefprompt: een lokale, omkeerbare keuze maakt geen ADR.
- [ ] Grensproef: de agent accepteert of sluit niets zonder menselijke instructie.

**Afhankelijkheden:** Taken 2 en 3.

**Waarschijnlijk geraakte bestanden:**

- `AGENTS.md`
- `.agents/skills/architecture-decision/SKILL.md`
- `.agents/skills/architecture-decision/agents/openai.yaml`

**Geschatte omvang:** Middel (3 bestanden).

## Checkpoint: end-to-end workflow na taken 3-4

- [ ] Een proefissue kan zonder aanvullende mondelinge context tot een volledig ADR-voorstel leiden.
- [ ] Human-in-the-loop-acceptatie is aantoonbaar afgedwongen.
- [ ] Terminologie en criteria zijn gelijk in index, issueformulier, `AGENTS.md` en skill.

## Taak 5: Automatiseer ADR-kwaliteitscontroles ✅

**Beschrijving:** Voeg kleine, lokaal uitvoerbare controles en een pull-requestworkflow toe voor Markdownstijl, bestandsnaam/nummering, toegestane status, verplichte secties en bronissue. Pin externe actions of dependencies en volg bewust de runnerconventie van de repository.

**Acceptatiecriteria:**

- [ ] CI weigert een foutieve ADR-naam, dubbele nummering, ontbrekende verplichte sectie of ongeldige status.
- [ ] Dezelfde controles zijn lokaal met één gedocumenteerd commando uit te voeren.
- [ ] De workflow gebruikt alleen minimaal benodigde GitHub-permissies en gepinde externe dependencies.

**Verificatie:**

- [ ] Geldige ADR-fixture slaagt en gerichte ongeldige fixtures falen met bruikbare meldingen.
- [ ] De Markdown- en YAML-controles slagen op alle nieuwe bestanden.
- [ ] De GitHub Actions-workflow slaagt op een pull request.

**Afhankelijkheden:** Taken 2 en 4.

**Waarschijnlijk geraakte bestanden:**

- `scripts/validate-adrs.sh`
- `.github/workflows/adr-quality.yml`
- `docs/decisions/README.md`
- optioneel testfixtures onder `tests/adr/`

**Geschatte omvang:** Middel (3-5 bestanden).

## Taak 6: Accepteer ADR-0001 en sluit de audit trail

**Beschrijving:** Verwerk reviewfeedback, wijzig ADR-0001 pas na expliciete goedkeuring naar `accepted`, merge de pull request en sluit issue #1 via de PR. Leg de daadwerkelijke confirmationchecks vast.

**Acceptatiecriteria:**

- [ ] ADR-0001 heeft status `accepted`, een besluitdatum en een verwijzing naar issue #1 en de review-PR.
- [ ] Issue #1 verwijst naar het geaccepteerde ADR en is door de merge traceerbaar gesloten.
- [ ] Alle in ADR-0001 beloofde templates, instructies, skill en controles zijn aanwezig en groen.

**Verificatie:**

- [ ] Doorloop issue → ADR → PR → merge → gesloten issue via de GitHub-links.
- [ ] Voer de lokale ADR-validatie en alle repositoryworkflows uit.
- [ ] Laat een nieuwe proefopdracht de geaccepteerde conventie volgen.

**Afhankelijkheden:** Taken 1-5 en expliciete menselijke goedkeuring.

**Waarschijnlijk geraakte bestanden:**

- `docs/decisions/0001-use-madr-for-architecture-decisions.md`
- GitHub issue #1 en de implementatie-PR

**Geschatte omvang:** Klein (1 bestand plus trackerstatus).

## Checkpoint: compleet

- [ ] Alle acceptatiecriteria van issue #1 zijn aantoonbaar afgedekt.
- [ ] Lokale validatie en GitHub Actions slagen.
- [ ] ADR-0001 en issue #1 vormen samen een volledige, navigeerbare audit trail.
- [ ] De workflow is klaar voor een tweede architectuurbesluit zonder nieuwe proceskeuzes.
