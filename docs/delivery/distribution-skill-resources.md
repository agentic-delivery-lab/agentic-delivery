# Distribution skill resource checks

The Control Plane reads Distribution projection metadata under ADR-0018,
ADP-0001 and ADD-0001 from the selected Architecture release. Primitives owns
canonical capability source; Distribution generates consumer files; this reader
verifies the selected source graph. This implementation note changes no formal
decision, dependency pin, permission or execution policy.

## Supported versions

Historical flat metadata and standard packages with factory namespace version 1
remain readable through their existing path. Version 2 uses the same standard
`https://agent-plugins.org/schemas/1.0.0/plugin.schema.json` package and the
`io.github.agentic-delivery-lab` extension. It requires the native-identity-bound
controller schema 3 graph. An inventory never selects a producer dependency.

The version 2 extension contains exactly `schemaVersion`, `id`, `status`,
`generatedFrom`, `projections` and `resourceInventory`. `projections` contains
exactly `automations: automations/` and `skills: skills/`.
`resourceInventory` is exactly `resources.lock.json`, relative to the package
root. Unknown components, fields and alternate inventory paths hold.

`generatedFrom` retains its existing eight source fields and adds
`primitiveImplementationCommit`. The existing `primitiveSourceCommit` still
identifies the selected release-manifest commit, matching the controller's
Primitive dependency. The new field identifies that manifest's prepared
implementation source. Do not interchange these commits, even where a file's
bytes are identical at both objects.

## Inventory and source roles

`packages/agent-plugin/resources.lock.json` is a distinct resource schema 1
record. Its exact header is:

| Field | Required binding |
| --- | --- |
| `schemaVersion` | `1` |
| `primitiveRepository` | `agentic-delivery-lab/agentic-delivery-agent-customizations` |
| `primitiveRepositoryId` | Native ID `1380894656` |
| `primitiveRelease` | Selected manifest's `releaseId` |
| `releaseManifestCommit` | Selected controller Primitive dependency commit |
| `implementationCommit` | Selected manifest's `sourceCommit` |
| `contentSha256` | Selected manifest's canonical content digest |
| `files` | Exactly the 17 supported resources below |

Each file record has exactly `sourcePath`, `targetPath`, `sourceCommit`,
`contentSha256` and `mode`. The target is `packages/agent-plugin/` followed by
the exact source path. The mode is `100644`; executable files and links are
unsupported. Only `manifests/primitive-release.json` comes from the released
manifest commit. All other resources come from the prepared implementation
commit. Claims in the inventory cannot redefine this set or these roles.

The 17 resources are:

- `SKILL.md` and `agents/openai.yaml` for each of `architecture-decision`,
  `delivery-workflow`, `plain-language-communication` and `ubiquitous-language`;
- `references/architecture-authority.md` and `references/consumer-tools.md`;
- `validators/workspace-lifecycle/README.md` and `workspace_guard.py`;
- `scripts/start-issue-branch.mjs` and its two imported validators under
  `validators/repository-delivery/`;
- `schemas/primitive-release.schema.json`; and
- `manifests/primitive-release.json`.

The canonical validator derives these paths independently, reads raw Git
objects with replacement and lazy fetch disabled, and compares exact bytes,
SHA-256 values and Git modes. It ignores later source workfiles. Ambient Git
selectors cannot redirect these object reads. Each file is bounded to 2 MiB and
the package is limited to 2,000 files and 32 MiB of resource and automation
content. The Git observation has a 30-second monotonic deadline. Diagnostics, missing
objects, changed observations and unsupported file state hold.

The complete package file set is those resources plus `plugin.json`,
`resources.lock.json` and the existing automation inventory's target files.
Unknown files, directories, path aliases, duplicate targets, symlinked parents
and extra components hold before projected content is read. Metadata must
still match the package selected by the graph. Resource files must be regular,
single-link and non-executable; consumer permission bits need not reproduce
Git's ordinary read/write bits.

All graph metadata and resource checks finish before producer digest tools
execute. Native producer provenance, Architecture's Primitive catalog lock,
controller selection, compatibility, workflow/bootstrap pins and existing
bootstrap release-status admission remain required. The standalone resource
function is a read-only part of that graph, not an admission interface.

## Qualification limits

This reader executes no projected skill or helper. It does not install aliases,
change tool permissions, establish consumer-root/workfile resolution, provide
managed lease inheritance or activate runtime. Version 2 support does not make
the current older producer/dependency pins a compatible 0.2.0 cohort. Such a
cohort needs explicit source-owner reconciliation and existing admission
checks; no lock equality or producer adoption gate is relaxed here.

The tests use real synthetic Git objects to exercise immutable source roles,
forged hashes, metadata drift, modes, missing/extra files and path protections.
The native graph fixture verifies rejection at the metadata barrier. These are
source checks. Stock-client qualification and positive released-source T10
installation, update, conflict, interruption/recovery and exact rollback remain
required under Distribution Issue #2. Preserve consumer edits and the previous
accepted source during recovery.
