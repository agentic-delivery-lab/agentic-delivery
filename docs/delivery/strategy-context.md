# Strategy context

Existing [Issue #106](https://github.com/agentic-delivery-lab/agentic-delivery/issues/106)
owns strategy context for the delivery controller. Architecture ADR-0023 keeps
Issues as execution authority; ADR-0024 owns approved Requirements selection.
This implementation consumes those authorities without changing them.

## Selected immutable sources

The private loader in `scripts/lib/strategy-context.mjs` selects the
owner-approved Architecture 0.1.0 release from PR #29:

- Completed manifest commit: `ba804c044bd7dc0a7c5568062d43a1f0d9f3141b`.
- Prepared source: `0423533176ad6239fe5d828736605b5a6360293c`.
- Canonical content SHA-256:
  `b754a82b5fca30a933057602bba6ab4f204c2a937be3a3076d7610aacac826d2`.
- Native Architecture repository ID: `1380894616`.

The prepared source is distinct from the completed manifest commit. The loader
accepts no per-run pin, approval flag or moving branch fallback. It checks the
released manifest, compatible closed contract set, admitted digest-tool bytes,
canonical digest and prepared-source ancestry. A trusted native repository
reader must confirm identity and current default ancestry. Git replacement
objects and lazy fetch are disabled.

Architecture's Requirements lock selects approved baseline 1.0.0 at
`9ce017453a23240042f72214b09e3c6c5059854d`, not the newer baseline on main.
The unchanged Requirements applicability selector comes from tooling commit
`2d20d40dcd1fb50d04310da2d222fb1a6fc1fa31`. Its bytes and schemas are read
from immutable Git objects. The controller materializes that admitted module
under its dependency directory, uses its locked dependencies, and removes the
scratch directory in `finally`. It never imports authority worktree code.
Selector tooling and approved baseline provenance are recorded separately.

## Identity and selection

The caller supplies trusted read-only source roots and native read results.
Issue or Project text cannot supply roots, repositories, pins or instructions.
The source repository ID/name, Issue number, node ID, URLs and open non-PR
state must agree. Equal Issue numbers in different repositories and transferred
Issues cannot reuse a context.

Bounded contexts come from canonical steward mappings. Architecture consumes
its declared cross-context scope; Requirements consumes ADR-0024's declared
scope. Registered adapters use Governance and their modeled upstream context.
An unknown repository or missing mapping holds instead of selecting everything.
Requirements applicability uses the authority's approved IDs and scope rules.

The result contains relevant principles, decision references, strategic goals,
approved requirement statements and verification criteria, and evaluation
references. Proposed goals remain explicitly non-normative; offline owner
mappings and unmeasured targets retain their status. A top-level adopted
strategy does not approve each proposed goal or prove any measured outcome.

Selection policy 1.0.0 produces stable JSON bounded to 48 KiB, with a SHA-256
over the selected data. This byte bound makes no hard token or spend claim.
Resume requires identical verified data; missing or changed data holds without
mutating the operation UUID, counters, reservations, checkpoint or outbox.
Provider errors are reduced to a fixed inspection message.

## Integration boundary

This first increment is a private loader and its rejection tests. Controller
phase prompts, saved-state migration and delivery-evidence versioning remain
the next increment under the same source Issue. The module is not yet called
by delivery. It performs no Project lookup, model startup or GitHub mutation.

The controller's existing unconditional Actions admission hold remains.
Runtime ledger/profile/credential admission, participant activation and
production delivery need their own evidence. Current runtime, bootstrap and
reusable-workflow pins remain separate from this selected context source.
Stock Codex remains unmodified. Before review publication, complete the
controller integration and run the full acceptance matrix in Issue #106.
