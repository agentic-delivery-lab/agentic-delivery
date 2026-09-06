# Implementatieplan: vastlegging van architectuurbesluiten

## Overzicht

Issue [#1](https://github.com/sjefsharp/agentic-delivery/issues/1) wordt gebruikt als opdrachtbrief voor het eerste architectuurbesluit: hoe deze repository architectuurbesluiten initieert, onderzoekt, beoordeelt, vastlegt en later vervangt. De voorgestelde richting is een lichte MADR 4.0-conventie in `docs/decisions/`, met GitHub Issues voor aanleiding en discussie, pull requests voor review en acceptatie, en een repository-skill plus `AGENTS.md` voor herhaalbare uitvoering door ChatGPT en Codex CLI.

Dit plan implementeert nog geen geaccepteerd besluit. ADR-0001 begint als voorstel en wordt pas `accepted` nadat een menselijke reviewer de gekozen werkwijze en consequenties heeft goedgekeurd; de statuswijziging zelf wordt daarna mechanisch door een vertrouwde GitHub Actions-workflow uitgevoerd. Als een agent zonder bronissue wordt aangeroepen, gebruikt hij eerst de guarded intake: read-only zoeken, zoekfouten rapporteren, een kandidaat laten bevestigen of een issue-preview laten bevestigen voordat er iets wordt gepubliceerd.

## Onderzoeksbasis

- [MADR](https://adr.github.io/madr/) definieert een ADR als één gemotiveerde, architectuursignificante keuze en adviseert Markdown, `docs/decisions/` en bestandsnamen volgens `NNNN-title-with-dashes.md`.
- MADR 4.0 biedt een compacte structuur met context, decision drivers, opties, uitkomst, consequenties en confirmation. Die structuur past bij zowel menselijke review als agentische verwerking.
- [OpenAI Docs over AGENTS.md](https://developers.openai.com/codex/guides/agents-md) beschrijven `AGENTS.md` als hiërarchische, altijd geladen repository-instructies. Daarom hoort daar alleen de korte ADR-routeringsregel en niet het volledige proces thuis.
- [OpenAI Docs over skills](https://developers.openai.com/codex/skills) positioneren skills als herbruikbare workflows met progressieve contextlading. Codex ontdekt repository-skills onder `.agents/skills`; hetzelfde skillformaat is bruikbaar door ChatGPT en Codex.
- [OpenAI Docs over de Codex CLI](https://developers.openai.com/codex/cli/reference) beschrijven `codex exec` als stabiele niet-interactieve primitive, met JSONL en output-schema's voor eventuele latere automatisering.
- [GitHub Actions events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) documenteren `pull_request_review` voor approvals en `workflow_run` als privileged vervolg dat vanaf de default branch kan draaien.
- De [GitHub secure-use reference](https://docs.github.com/en/actions/reference/security/secure-use) waarschuwt ervoor om in privileged `workflow_run`-workflows geen onbetrouwbare PR-code uit te checken.
- De [GitHub protected-branchesdocumentatie](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) beschrijft het effect van stale approvals na nieuwe commits.
- Bij aanvang bevatte de repository alleen `.github/workflows/self-hosted-runner-smoke.yml`; er was dus geen bestaande documentatie-, ADR-, nummerings- of agentconventie om over te nemen.

## Voorgestelde architectuurkeuzes voor ADR-0001

- **Canonieke opslag:** `docs/decisions/` met globale, oplopende viercijferige nummers. De map is menselijk vindbaar, dicht bij toekomstige documentatie en ondersteund door de MADR-conventie.
- **Formaat:** een project-specifieke MADR 4.0-template. Verplicht zijn status, datum, bronissue, context/probleem, decision drivers, overwogen opties, decision outcome, consequenties en confirmation. Rollen zoals decision-makers, consulted en informed blijven beschikbaar wanneer relevant.
- **Scheiding van verantwoordelijkheden:** het issue is de opdrachtbrief en audit trail van aanleiding/discussie; het ADR is het blijvende, version-controlled besluit; de pull request is de formele review- en acceptatiegrens. Ontbreekt het issue, dan wordt het alleen via de guarded intake vastgesteld of aangemaakt.
- **Lifecycle:** `proposed` → `accepted` → optioneel `deprecated` of `superseded by ADR-NNNN`. Records worden nooit verwijderd of inhoudelijk herschreven om een nieuw besluit te simuleren; vervanging gebeurt met een nieuw ADR en wederzijdse verwijzingen.
- **Agent-harness:** een korte regel in root-`AGENTS.md` laat agents eerst de ADR-criteria toetsen. `.agents/skills/architecture-decision/SKILL.md` bevat de volledige workflow, grenzen en gewenste output. Eventuele scripts komen pas in beeld als deterministische nummering of validatie niet betrouwbaar met eenvoudige repositorychecks kan worden afgedwongen.
- **Automatisering:** een `pull_request_review`-signaal zonder rechten start na een succesvolle review een `workflow_run` vanaf de default branch. Die vertrouwde workflow controleert de actuele review, commit en gewijzigde ADR via de GitHub API en zet alleen een voorgestelde ADR op `accepted`. `codex exec`, MCP en de kwaliteitworkflow blijven voorbereidend/controlerend; geen agent accepteert rechtstreeks.
- **Runner:** de ADR-kwaliteitsworkflow en de vertrouwde statusworkflow draaien op de bestaande labels `[self-hosted, linux, x64, omarchy]`. Omdat deze checks repositorycode uitvoeren, worden fork-pull-requests niet automatisch op deze trust boundary uitgevoerd. De bestaande `workflow_dispatch`-smoketest blijft behouden als onafhankelijke runner-canary en gebruikt dezelfde gepinde checkout-action.

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
GitHub issue (opdrachtbrief; bestaand of na bevestigde intake aangemaakt)
    → criteria toetsen en onderzoek uitvoeren
    → ADR met status proposed in pull request
    → menselijke review en expliciete keuze
    → onprivileged approval signal
    → trusted workflow_run zet status accepted
    → merge (met closing keyword) en issue sluiten
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

- [x] Taak 1: Stel ADR-0001 op als `proposed` besluit op basis van issue #1.
- [x] Taak 2: Leg template, index, naamgeving en lifecycle vast.

### Checkpoint: besluitbasis

- [ ] ADR-0001 is inhoudelijk gereviewd en de gekozen richting is expliciet goedgekeurd voordat de status `accepted` wordt.
- [ ] De documenten verwijzen wederzijds naar issue #1, de review-PR en de MADR-bron.

### Fase 2: Intake en agent-harness

- [x] Taak 3: Maak een GitHub-issueformulier voor nieuwe architectuurvraagstukken.
- [x] Taak 4: Voeg de ADR-routeringsregel en repository-skill voor ChatGPT/Codex toe, inclusief guarded source-issue intake.

### Checkpoint: end-to-end workflow

- [ ] Een proefprompt en proefissue leiden tot een `proposed` ADR met de juiste secties en links.
- [ ] De agent stopt vóór acceptatie en vraagt om menselijke review.

### Fase 3: Kwaliteitsborging en afronding

- [x] Taak 5: Automatiseer structurele en Markdown-validatie van ADR-wijzigingen op de bestaande self-hosted runner.
- [ ] Taak 6: Rond ADR-0001 en issue #1 af met automatische acceptatie na approval en volledige traceerbaarheid.

### Checkpoint: gereed

- [ ] Alle checks slagen op de bestaande en nieuwe Markdown/YAML-bestanden.
- [ ] Een nieuwe contributor kan vanuit het issueformulier de workflow zonder mondelinge uitleg volgen.
- [ ] ADR-0001 is geaccepteerd, gemerged en issue #1 is via de merge traceerbaar gesloten.

## Verificatiestrategie

- **Structuur:** controleer unieke, oplopende `NNNN-*.md`-namen, toegestane statussen, verplichte metadata/secties en geldige relatieve links.
- **Documentkwaliteit:** lint alle nieuwe Markdown en valideer het YAML-issueformulier in CI.
- **Acceptatieautomatisering:** test de pure statusmutatie en API-orkestratie met positieve, idempotente en afwijzende fixtures; controleer dat de privileged workflow geen PR-code checkout.
- **Agentgedrag:** start Codex vanuit de repositoryroot, laat het de geladen instructiebronnen benoemen en voer zowel een positieve als negatieve triggerprompt uit.
- **Proces:** doorloop issue #1 → voorstel-PR → expliciete acceptatie → merge/sluiting en controleer alle kruisverwijzingen.
- **Regressie:** behoud de bestaande self-hosted-runner-smoketest als handmatig te starten canary, controleer de gepinde checkout-action en bevestig dat de nieuwe workflows dezelfde runnerconventie bewust volgen.

## Risico's en mitigaties

| Risico | Impact | Mitigatie |
| --- | --- | --- |
| Te veel kleine keuzes worden ADR's | Middel | Neem positieve én negatieve criteria op in index, issueformulier en skill; vereis relevante alternatieven. |
| Procesinformatie raakt gedupliceerd en loopt uiteen | Hoog | Maak `docs/decisions/README.md` canoniek; laat `AGENTS.md`, issueformulier en skill ernaar verwijzen. |
| Een agent presenteert een voorstel als geaccepteerd besluit | Hoog | Vereis startstatus `proposed`, menselijke reviewer en laat alleen de trusted post-approval workflow de mechanische statuswijziging doen. |
| Issue en ADR raken losgekoppeld | Middel | Maak bronissue verplicht in template en ADR-link verplicht in issue/PR. |
| Automatische issue-intake maakt duplicaten, maskeert zoekfouten of publiceert promptinhoud | Hoog | Zoek read-only, stop bij tooling/auth/connectivity-fouten, controleer verplichte context, toon preview, vraag expliciete bevestiging, herhaal de duplicate-check en vervang ontoegankelijke issues nooit. |
| ChatGPT en Codex laden repositorycontext verschillend | Middel | Gebruik het gedeelde skillformaat, verifieer Codex-autodiscovery apart en documenteer hoe de skill in ChatGPT wordt toegevoegd/aangeroepen. |
| Validatie wordt afhankelijk van ongepinde of onbetrouwbare tooling | Laag | Pin externe CI-actions/dependencies en houd project-specifieke checks klein en lokaal uitvoerbaar. |
| Statuscommit maakt een review stale | Middel | Documenteer dit bij de lifecycle en stem branch-protectioninstellingen af; een nieuwe review is dan de expliciete bevestiging van de statuscommit. |
| PR-code krijgt toegang tot de status-token | Hoog | Scheid het review-signaal van `workflow_run`, checkout alleen de default branch en accepteer alleen same-repository PR's. |
| Runner-canary wijkt af of gebruikt een mutable action-tag | Middel | Behoud de handmatige smoke-workflow, gebruik dezelfde runnerlabels en pin de checkout-action op een commit. |

## Beantwoorde reviewpunten

- ✅ `docs/decisions/` met globale `NNNN-title-with-dashes.md`-nummering is de canonieke locatie en naamgeving.
- ✅ De lifecycle blijft `proposed` in de PR, menselijke approval, automatische statuswijziging naar `accepted`, daarna merge en issue-sluiting via een closing keyword.
- ✅ De ADR-quality-check draait op de bestaande self-hosted runner; fork-pull-requests worden vanwege de trust boundary niet automatisch op die runner uitgevoerd.
- ✅ De repository-skill volstaat voor ChatGPT/Codex; bredere distributie als plugin volgt pas bij hergebruik buiten deze repository.
- ✅ Zonder bronissue gebruikt de skill guarded intake: read-only zoeken, zoekfouten rapporteren, kandidaat/preview bevestigen, geen vervanging bij ontoegankelijkheid en stoppen bij ontbrekende context.
- ✅ `adr-template.md` blijft bewust naast `README.md` en de genummerde records; de bestaande self-hosted-runner-smoketest blijft behouden als onafhankelijke, handmatige canary.

Open aandachtspunt voor de repository-instellingen: een status-only commit kan bestaande approvals stale maken wanneer branch protection dat voor iedere commit doet. In dat geval is een tweede approval de bedoelde bevestiging van de laatste statuscommit.
