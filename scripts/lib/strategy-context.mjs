// Controller-owned selection for existing source Issue #106. This is source
// qualification, not operation/runtime admission or a participant release.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { parseRepositoryYaml } from './yaml.mjs';
import { validateArchitecturePin } from '../validate-architecture-pin.mjs';
import { APPROVED_ARCHITECTURE_SOURCE as architecture } from './approved-architecture-source.mjs';

const execute = promisify(execFile);
const controllerRoot = path.resolve(import.meta.dirname, '../..');
const requirementsTooling = Object.freeze({ commit: '2d20d40dcd1fb50d04310da2d222fb1a6fc1fa31',
  path: 'tools/validate-requirements.mjs', sha256: '284f4aa16981bf4bf324b4a0763bdba3ce67e920838325c29d061140f6d46ead' });
const referenceSchema = JSON.parse(readFileSync(new URL('../../docs/architecture/delivery-evidence.schema.json', import.meta.url))).$defs.strategyContextReference;
const validateReference = new Ajv2020({ strict: true }).compile(referenceSchema);
const hash = data => createHash('sha256').update(data).digest('hex');
const sorted = records => [...records].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
class StrategyContextHold extends Error {
  constructor(message) { super(message); this.code = 'STRATEGY_CONTEXT_HOLD'; }
}
const hold = message => new StrategyContextHold(message);
function requireValue(condition, message) { if (!condition) throw hold(message); }

async function git(root, args, encoding = 'utf8') {
  requireValue(typeof root === 'string' && root.length > 0, 'Trusted authority input is missing.');
  return (await execute('git', ['--no-replace-objects', '--no-lazy-fetch', '-C', root, ...args], {
    encoding, timeout: 30_000, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' },
  })).stdout;
}
async function read(root, commit, file) {
  requireValue(/^[0-9a-f]{40}$/.test(commit), 'Authority input must use an immutable commit.');
  requireValue(typeof file === 'string' && !file.startsWith('/') && file.split('/').every(p => p && p !== '.' && p !== '..'), 'Authority path is invalid.');
  const source = await git(root, ['show', `${commit}:${file}`]);
  requireValue(Buffer.byteLength(source) <= 1024 * 1024, 'Authority input exceeds its declared bound.');
  return source;
}
async function verifyRepository(readRepository, pin, root) {
  requireValue(typeof readRepository === 'function', 'Trusted native repository reader is missing.');
  const native = await readRepository(pin.repository);
  requireValue(native?.id === pin.repositoryId && native.full_name === pin.repository
    && /^[0-9a-f]{40}$/.test(native.defaultCommit ?? ''), 'Authority native identity/default commit does not match.');
  await git(root, ['merge-base', '--is-ancestor', pin.commit, native.defaultCommit]);
}

function requireSourceOrigin(origin) {
  requireValue(origin && Number.isSafeInteger(origin.repositoryId) && origin.repositoryId > 0
    && /^[^/\s]+\/[^/\s]+$/.test(origin.repository ?? '')
    && Number.isSafeInteger(origin.issueNumber) && origin.issueNumber > 0
    && typeof origin.issueNodeId === 'string' && /^[A-Za-z0-9_=-]{1,200}$/.test(origin.issueNodeId), 'Source Issue identity is incomplete.');
}
export function assertSourceIssueIdentity(origin, repository, issue) {
  requireSourceOrigin(origin);
  requireValue(repository?.id === origin.repositoryId && repository.full_name === origin.repository
    && issue?.node_id === origin.issueNodeId && issue.number === origin.issueNumber && issue.state === 'open' && !issue.pull_request
    && issue.repository_url === `https://api.github.com/repos/${origin.repository}`
    && issue.html_url === `https://github.com/${origin.repository}/issues/${origin.issueNumber}`, 'Source Issue moved, changed identity, or is no longer eligible.');
}

export function strategyContextData(context) {
  const { sha256, ...data } = context ?? {};
  const text = JSON.stringify(data);
  requireValue(Buffer.byteLength(text) <= 48 * 1024 && hash(text) === sha256, 'Strategy context data is missing, changed or too large.');
  return text;
}
export function requireSameStrategyContext(saved, current) {
  requireValue(saved && strategyContextData(saved) === strategyContextData(current), 'Saved strategy context is missing or changed; preserve the operation and request readmission.');
}

export function strategyContextReference(context) {
  strategyContextData(context);
  const ids = records => records.map(r => r.id).sort();
  const result = { schemaVersion: 1, selectionPolicy: context.selectionPolicy, sha256: context.sha256,
    origin: structuredClone(context.origin), architecture: structuredClone(context.architecture),
    requirements: { authority: structuredClone(context.requirements.authority), tooling: structuredClone(context.requirements.tooling) },
    selected: { contexts: ids(context.contexts), goals: ids(context.goals), principles: ids(context.principles),
      decisions: ids(context.decisions), requirements: ids(context.requirements.records), measures: ids(context.evaluation.measures) } };
  requireValue(validateStrategyContextReference(result), 'Strategy context provenance is invalid.');
  return result;
}

export function validateStrategyContextReference(value) {
  return Boolean(validateReference(value)
    && Object.entries(architecture).every(([key, expected]) => value.architecture[key] === expected)
    && Object.entries(requirementsTooling).every(([key, expected]) => value.requirements.tooling[key] === expected)
    && value.requirements.authority.repositoryId === 1416207421
    && value.requirements.authority.repository === 'agentic-delivery-lab/agentic-delivery-requirements'
    && value.requirements.authority.commit === '9ce017453a23240042f72214b09e3c6c5059854d'
    && value.requirements.authority.sourceCommit === '059aad42e0e3e4b8e305f46a1d474a12ffdb8f33'
    && value.requirements.authority.version === '1.0.0'
    && value.requirements.authority.contentSha256 === 'eec84e8ff2b276ef322b9262ede31edad9f4c0f9f30a7527a9607dd9f411a1c4');
}

// Materialize the unchanged admitted selector and schemas, resolving packages
// from the controller's locked dependencies. Never import authority worktree
// code. This scratch module is removed even when validation/import fails.
async function applicableRequirements(root, pin, repositoryId) {
  const source = await read(root, requirementsTooling.commit, requirementsTooling.path);
  requireValue(hash(source) === requirementsTooling.sha256, 'Requirements selector tool digest does not match.');
  const scratch = await mkdtemp(path.join(controllerRoot, 'node_modules/.strategy-context-'));
  try {
    await mkdir(path.join(scratch, 'tools'));
    await mkdir(path.join(scratch, 'contracts'));
    await writeFile(path.join(scratch, requirementsTooling.path), source);
    for (const name of ['requirements.schema.json', 'requirements-release.schema.json']) {
      await writeFile(path.join(scratch, 'contracts', name), await read(root, requirementsTooling.commit, `contracts/${name}`));
    }
    const tool = await import(pathToFileURL(path.join(scratch, requirementsTooling.path)).href);
    return await tool.selectApplicableRequirements(root, pin, repositoryId);
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

export async function loadStrategyContext({ architectureRoot, requirementsRoot, readRepository, origin, sourceIssue } = {}) {
  try {
    requireValue(origin && typeof readRepository === 'function', 'Native source context is required.');
    requireSourceOrigin(origin);
    const nativeOrigin = await readRepository(origin.repository);
    assertSourceIssueIdentity(origin, nativeOrigin, sourceIssue);
    await verifyRepository(readRepository, architecture, architectureRoot);
    const manifest = JSON.parse(await read(architectureRoot, architecture.commit, 'architecture/generated/architecture-release.json'));
    requireValue(manifest.status === 'released' && manifest.sourceCommit === architecture.sourceCommit, 'Only the selected released Architecture context is admissible.');
    requireValue(hash(await read(architectureRoot, architecture.commit, 'tools/architecture-content-digest.mjs'))
      === 'c813eaad7460282f8e8ee466df7514e0daaecb1ca941a5177d9cf1f5b24f4c91', 'Architecture digest tool is not the admitted implementation.');
    await git(architectureRoot, ['merge-base', '--is-ancestor', architecture.sourceCommit, architecture.commit]);
    await validateArchitecturePin({ architectureRoot, architectureCommit: architecture.commit,
      architectureVersion: architecture.version, architectureDigest: architecture.contentSha256, requireHead: false });
    const yaml = async file => parseRepositoryYaml(await read(architectureRoot, architecture.commit, file), file);
    const pin = JSON.parse(await read(architectureRoot, architecture.commit, 'architecture/references/requirements.lock.json'));
    await verifyRepository(readRepository, pin, requirementsRoot);
    await git(requirementsRoot, ['merge-base', '--is-ancestor', requirementsTooling.commit,
      (await readRepository(pin.repository)).defaultCommit]);
    const applicability = await applicableRequirements(requirementsRoot, pin, origin.repositoryId);
    const model = await yaml('architecture/domain/bounded-contexts.yml');
    const map = await yaml('architecture/domain/context-map.yml');
    const inventory = await yaml('architecture/references/decision-inventory.yml');
    let contexts = model.contexts.filter(c => c.contextStewardRepository?.repository === origin.repository
      && c.contextStewardRepository.repositoryId === origin.repositoryId);
    // Authority/adapter mappings come from the canonical Architecture model;
    // Requirements is the explicitly pinned cross-context ADR-0024 authority.
    if (origin.repository === model.crossContextAuthority.repository) contexts = model.contexts;
    if (origin.repository === pin.repository && origin.repositoryId === pin.repositoryId) {
      const domains = inventory.records.find(r => r.id === 'ADR-0024')?.domains ?? [];
      contexts = model.contexts.filter(c => domains.includes(c.id));
    }
    const adapter = model.repositoryAdapters.find(a => a.repository === origin.repository);
    if (adapter) {
      const upstreams = map.relationships.filter(r => r.downstream === adapter.id).map(r => r.upstream);
      contexts = model.contexts.filter(c => c.id === 'agentic-delivery-governance' || upstreams.includes(c.id));
    }
    requireValue(contexts.length > 0, 'No canonical bounded-context mapping exists for this source.');
    const ids = contexts.map(c => c.id);
    const strategy = await yaml('architecture/strategy/organizational-strategy.yml');
    requireValue(strategy.status === 'adopted', 'Strategy is not adopted in the selected source.');
    const goals = sorted(strategy.strategicGoals.filter(g => g.contextIds.some(id => ids.includes(id))));
    const decisions = sorted(inventory.records.filter(d => d.domains.some(id => ids.includes(id))));
    const principleIndex = await yaml('architecture/principles/index.yml');
    const principles = sorted(principleIndex.principles.filter(p => p.decisions.some(d => decisions.some(r => r.id === d.id))));
    const records = [];
    for (const file of [...new Set(applicability.requirements.map(r => r.catalogPath))].sort()) {
      const catalog = parseRepositoryYaml(await read(requirementsRoot, pin.commit, file), file);
      for (const record of catalog.requirements) {
        if (!applicability.requirements.some(r => r.id === record.id && r.catalogPath === file)) continue;
        requireValue(record.status === 'approved', 'Selected requirement is not approved.');
        records.push({ id: record.id, status: record.status, path: file, statement: record.statement,
          scopeIds: applicability.requirements.find(r => r.id === record.id).scopeIds,
          criterion: record.verification.criterion, evidenceStatus: record.verification.evidenceStatus });
      }
    }
    const evaluation = JSON.parse(await read(architectureRoot, architecture.commit, 'architecture/evaluation/owners.json'));
    const data = {
      schemaVersion: 1, selectionPolicy: '1.0.0', origin: { repository: origin.repository, repositoryId: origin.repositoryId,
        issueNumber: origin.issueNumber, issueNodeId: origin.issueNodeId },
      architecture: { ...architecture, contractVersions: manifest.contractVersions },
      requirements: { authority: applicability.authority, tooling: requirementsTooling, records: sorted(records) },
      contexts: sorted(contexts).map(c => ({ id: c.id, definition: c.definition })),
      strategy: { status: strategy.status, purpose: strategy.purpose, mission: strategy.mission, vision: strategy.vision },
      goals: goals.map(g => ({ id: g.id, title: g.title, outcome: g.outcome, status: g.status,
        normative: g.status === 'adopted', measureIds: [...g.measureIds].sort() })),
      principles: principles.map(p => ({ id: p.id, statement: p.statement, path: `architecture/${p.source}` })),
      decisions: decisions.map(d => ({ id: d.id, path: d.path, domains: [...d.domains].sort() })),
      evaluation: { scope: evaluation.scope, mappings: evaluation.mappings.filter(m => m.owner.repositoryId === origin.repositoryId)
        .map(m => ({ layer: m.layer, subjectId: m.subjectId, sourceIssue: m.sourceIssue })),
        measures: sorted(strategy.successMeasures.filter(m => goals.some(g => g.measureIds.includes(m.id))))
          .map(m => ({ id: m.id, definition: m.definition, baselineStatus: m.baselineStatus, targetStatus: m.targetStatus })) },
    };
    const result = { ...data, sha256: hash(JSON.stringify(data)) };
    strategyContextData(result);
    return result;
  } catch (error) {
    if (error instanceof StrategyContextHold) throw error;
    // Do not publish raw provider errors, process arguments or input paths.
    throw hold('The selected immutable strategy context could not be verified; preserve the operation for owner inspection.');
  }
}
