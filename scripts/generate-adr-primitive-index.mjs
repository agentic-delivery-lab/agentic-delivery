// agentic-primitive: {"id":"adr-traceability-generator","kind":"script","enforcement":"deterministic","adrs":["ADR-0013"],"domains":["agentic-delivery-governance"]}
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildTraceability, collectAdrs, collectPrimitives, validateTraceability } from './lib/adr-traceability.mjs';
import { parseRepositoryYaml } from './lib/yaml.mjs';

const check = process.argv.includes('--check');
const rootArgument = process.argv.slice(2).find((argument) => argument !== '--check');
const root = path.resolve(rootArgument ?? path.resolve(import.meta.dirname, '..'));
const outputPath = path.join(root, 'docs', 'architecture', 'adr-primitive-index.json');

async function loadDomains() {
  const registry = parseRepositoryYaml(await readFile(path.join(root, 'docs/domain/ubiquitous-language.yml'), 'utf8'), 'domain register');
  return (registry.bounded_contexts ?? []).map((context) => context.id);
}

const [adrResult, primitiveResult, domains] = await Promise.all([
  collectAdrs(root), collectPrimitives(root), loadDomains(),
]);
const index = buildTraceability({ adrs: adrResult.adrs, primitives: primitiveResult.primitives, domains });
const validation = validateTraceability({ index, adrs: adrResult.adrs, primitives: primitiveResult.primitives, domainIds: domains });
const errors = [...adrResult.errors, ...primitiveResult.errors, ...validation.errors.filter((error) => !error.startsWith('generated traceability index'))];
if (errors.length) {
  process.stderr.write(`${errors.join('\n')}\n`);
  process.exitCode = 1;
} else if (check) {
  let current;
  try { current = JSON.parse(await readFile(outputPath, 'utf8')); } catch { current = null; }
  if (JSON.stringify(current) !== JSON.stringify(index)) {
    process.stderr.write('Traceability check: generated index is stale.\n');
    process.exitCode = 1;
  } else process.stdout.write(`Traceability check passed: ${index.adrs.length} ADR(s), ${index.primitives.length} primitive(s).\n`);
} else {
  await writeFile(outputPath, `${JSON.stringify(index, null, 2)}\n`);
  process.stdout.write(`Traceability index generated: ${index.adrs.length} ADR(s), ${index.primitives.length} primitive(s).\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.exitCode) process.exitCode = 1;
