# Implementatieplan: vastlegging van architectuurbesluiten

## Overzicht

Issue [#1](https://github.com/sjefsharp/agentic-delivery/issues/1) wordt gebruikt als opdrachtbrief voor het eerste architectuurbesluit: hoe deze repository architectuurbesluiten initieert, onderzoekt, beoordeelt, vastlegt en later vervangt. De voorgestelde richting is een lichte MADR 4.0-conventie in `docs/decisions/`, met GitHub Issues voor aanleiding en discussie, pull requests voor review en acceptatie, en een repository-skill plus `AGENTS.md` voor herhaalbare uitvoering door ChatGPT en Codex CLI.

Dit plan implementeert nog geen besluit. ADR-0001 begint als voorstel en wordt pas `accepted` nadat een menselijke reviewer de gekozen werkwijze en consequenties heeft goedgekeurd.

## Onderzoeksbasis

- [MADR](https://adr.github.io/madr/) definieert een ADR als één gemotiveerde, architectuursignificante keuze en adviseert Markdown, `docs/decisions/` en bestandsnamen volgens `NNNN-title-with-dashes.md`.
- MADR 4.0 biedt een compacte structuur met context, decision drivers, opties, uitkomst, consequenties en confirmation. Die structuur past bij zowel menselijke review als agentische verwerking.
- [OpenAI Docs over AGENTS.md](https://developers.openai.com/codex/guides/agents-md) beschrijven `AGENTS.md` als hiërarchische, altijd geladen repository-instructies. Daarom hoort daar alleen de korte ADR-routeringsregel en niet het volledige proces thuis.
- [OpenAI Docs over skills](https://developers.openai.com/codex/skills) positioneren skills als herbruikbare workflows met progressieve contextlading. Codex ontdekt repository-skills onder `.agents/skills`; hetzelfde skillformaat is bruikbaar door ChatGPT en Codex.
- [OpenAI Docs over de Codex CLI](https://developers.openai.com/codex/cli/reference) beschrijven `codex exec` als stabiele niet-interactieve primitive, met JSONL en output-schema's voor eventuele latere automatisering.
- De repository bevat momenteel alleen `.github/workflows/self-hosted-runner-smoke.yml`; er is dus geen bestaande documentatie-, ADR-, nummerings- of agentconventie om over te nemen.

## Voorgestelde architectuurkeuzes voor ADR-0001

- **Canonieke opslag:** `docs/decisions/` met globale, oplopende viercijferige nummers. De map is menselijk vindbaar, dicht bij toekomstige documentatie en ondersteund door de MADR-conventie.
- **Formaat:** een project-specifieke MADR 4.0-template. Verplicht zijn status, datum, bronissue, context/probleem, decision drivers, overwogen opties, decision outcome, consequenties en confirmation. Rollen zoals decision-makers, consulted en informed blijven beschikbaar wanneer relevant.
- **Scheiding van verantwoordelijkheden:** het issue is de opdrachtbrief en audit trail van aanleiding/discussie; het ADR is het blijvende, version-controlled besluit; de pull request is de formele review- en acceptatiegrens.
- **Lifecycle:** `proposed` → `accepted` → optioneel `deprecated` of `superseded by ADR-NNNN`. Records worden nooit verwijderd of inhoudelijk herschreven om een nieuw besluit te simuleren; vervanging gebeurt met een nieuw ADR en wederzijdse verwijzingen.
- **Agent-harness:** een korte regel in root-`AGENTS.md` laat agents eerst de ADR-criteria toetsen. `.agents/skills/architecture-decision/SKILL.md` bevat de volledige workflow, grenzen en gewenste output. Eventuele scripts komen pas in beeld als deterministische nummering of validatie niet betrouwbaar met eenvoudige repositorychecks kan worden afgedwongen.
- **Automatisering:** eerst een expliciet, reviewbaar mens-in-de-lus-proces. `codex exec`, GitHub Actions of MCP mogen later voorstellen voorbereiden en controleren, maar mogen een ADR niet zelfstandig accepteren of een issue sluiten.

## Criteria voor het voorstellen van een ADR

Een agent of bijdrager stelt een ADR voor wanneer minstens één van de volgende signalen aanwezig is en er een echte keuze met relevante alternatieven bestaat:

- de keuze is kostbaar of riskant om terug te draaien;
- de keuze raakt meerdere componenten, teams of toekomstige wijzigingen;
- de keuze bepaalt een publieke interface, data-eigenaarschap, beveiliging, privacy, beschikbaarheid, performance, deployment of een belangrijke dependency;
- de keuze introduceert of wijzigt een repositorybrede standaard of wijkt bewust van zo'n standaard af;
- de rationale zal naar verwachting later opnieuw ter discussie komen en moet daarom duurzaam traceerbaar zijn.

Geen ADR is nodig voor lokale, eenvoudig omkeerbare implementatiedetails, reguliere bugfixes, puur redactionele wijzigingen, of een keuze zonder betekenisvolle alternatieven of langetermijngevolgen. Bij twijfel stelt de agent eerst in het issue voor om een ADR te maken; hij maakt of accepteert niet stilzwijgend een record.

## Beoogde workflow

```text
GitHub issue (opdrachtbrief)
    → criteria toetsen en onderzoek uitvoeren
    → ADR met status proposed in pull request
    → menselijke review en expliciete keuze
    → status accepted + merge
    → issue sluiten en implementatie/confirmation volgen
    → later eventueel nieuw ADR dat het oude vervangt
```

## Afhankelijkheden

```text
Issue #1
    └── ADR-0001 (procesbesluit)
          ├── MADR-template en index
          ├── GitHub-issueformulier
          └── AGENTS.md + repository-skill
                    └── geautomatiseerde controles en praktijktest
```

## Task List

### Fase 1: Besluitvoorstel en contract

- [ ] Taak 1: Stel ADR-0001 op als `proposed` besluit op basis van issue #1.
- [ ] Taak 2: Leg template, index, naamgeving en lifecycle vast.

### Checkpoint: besluitbasis

- [ ] ADR-0001 is inhoudelijk gereviewd en de gekozen richting is expliciet goedgekeurd voordat de status `accepted` wordt.
- [ ] De documenten verwijzen wederzijds naar issue #1, de review-PR en de MADR-bron.

### Fase 2: Intake en agent-harness

- [ ] Taak 3: Maak een GitHub-issueformulier voor nieuwe architectuurvraagstukken.
- [ ] Taak 4: Voeg de ADR-routeringsregel en repository-skill voor ChatGPT/Codex toe.

### Checkpoint: end-to-end workflow

- [ ] Een proefprompt en proefissue leiden tot een `proposed` ADR met de juiste secties en links.
- [ ] De agent stopt vóór acceptatie en vraagt om menselijke review.

### Fase 3: Kwaliteitsborging en afronding

- [ ] Taak 5: Automatiseer structurele en Markdown-validatie van ADR-wijzigingen.
- [ ] Taak 6: Rond ADR-0001 en issue #1 af met volledige traceerbaarheid.

### Checkpoint: gereed

- [ ] Alle checks slagen op de bestaande en nieuwe Markdown/YAML-bestanden.
- [ ] Een nieuwe contributor kan vanuit het issueformulier de workflow zonder mondelinge uitleg volgen.
- [ ] ADR-0001 is geaccepteerd, gemerged en issue #1 is via de merge traceerbaar gesloten.

## Verificatiestrategie

- **Structuur:** controleer unieke, oplopende `NNNN-*.md`-namen, toegestane statussen, verplichte metadata/secties en geldige relatieve links.
- **Documentkwaliteit:** lint alle nieuwe Markdown en valideer het YAML-issueformulier in CI.
- **Agentgedrag:** start Codex vanuit de repositoryroot, laat het de geladen instructiebronnen benoemen en voer zowel een positieve als negatieve triggerprompt uit.
- **Proces:** doorloop issue #1 → voorstel-PR → expliciete acceptatie → merge/sluiting en controleer alle kruisverwijzingen.
- **Regressie:** laat de bestaande self-hosted-runner-smoketest ongemoeid en bevestig dat de nieuwe workflow dezelfde runnerconventie bewust volgt of expliciet motiveert waarom niet.

## Risico's en mitigaties

| Risico | Impact | Mitigatie |
| --- | --- | --- |
| Te veel kleine keuzes worden ADR's | Middel | Neem positieve én negatieve criteria op in index, issueformulier en skill; vereis relevante alternatieven. |
| Procesinformatie raakt gedupliceerd en loopt uiteen | Hoog | Maak `docs/decisions/README.md` canoniek; laat `AGENTS.md`, issueformulier en skill ernaar verwijzen. |
| Een agent presenteert een voorstel als geaccepteerd besluit | Hoog | Vereis startstatus `proposed`, menselijke reviewer en expliciete statuswijziging vóór merge. |
| Issue en ADR raken losgekoppeld | Middel | Maak bronissue verplicht in template en ADR-link verplicht in issue/PR. |
| ChatGPT en Codex laden repositorycontext verschillend | Middel | Gebruik het gedeelde skillformaat, verifieer Codex-autodiscovery apart en documenteer hoe de skill in ChatGPT wordt toegevoegd/aangeroepen. |
| Validatie wordt afhankelijk van ongepinde of onbetrouwbare tooling | Laag | Pin externe CI-actions/dependencies en houd project-specifieke checks klein en lokaal uitvoerbaar. |

## Open vragen voor de review van ADR-0001

- Is één expliciete menselijke approver voldoende, of moet een CODEOWNERS-/meervoudige reviewregel worden ingesteld zodra er meer maintainers zijn?
- Moeten voorgestelde ADR's al op `main` mogen bestaan, of blijft `proposed` uitsluitend in een open pull request? Aanbevolen voor deze repository: uitsluitend in de PR en bij acceptatie vóór merge naar `accepted` wijzigen.
- Moet de ADR-quality-workflow op de bestaande self-hosted runner draaien of op een GitHub-hosted runner? De bestaande conventie wijst naar self-hosted; beschikbaarheid en trust boundaries moeten vóór implementatie worden bevestigd.
- Is ChatGPT-gebruik beperkt tot de desktop-app/projectworkspace, of moet de skill later als plugin worden verpakt voor bredere distributie? Aanbevolen eerste stap: repository-skill, plugin pas bij hergebruik buiten deze repository.

