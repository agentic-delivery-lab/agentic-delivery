// agentic-primitive: {"id":"issue-field-binding-log-masking","kind":"script","enforcement":"deterministic","adrs":["ADR-0012","ADR-0018"],"domains":["agentic-delivery-control-plane"]}
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function parseBindings(value) {
  if (typeof value === 'string') {
    if (!value) return {};
    try {
      value = JSON.parse(value);
    } catch {
      throw new Error('ISSUE_FIELD_BINDINGS_JSON is not valid JSON.');
    }
  }
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Issue-field bindings must be an object.');
  }
  if (value.fields !== undefined && (!value.fields || typeof value.fields !== 'object' || Array.isArray(value.fields))) {
    throw new Error('Issue-field bindings must contain an object of fields.');
  }
  return value;
}

function addBindingId(ids, id) {
  if (id === undefined) return;
  if (typeof id !== 'string' || !id.trim() || /\s/.test(id)) {
    throw new Error('Issue-field binding IDs must be nonempty single-line values.');
  }
  ids.add(id);
}

function escapeWorkflowCommandData(value) {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

export function issueFieldBindingMaskCommands(bindings) {
  // Structured-secret redaction does not guarantee masking of transformed or partial values.
  const value = parseBindings(bindings);
  const ids = new Set();
  for (const binding of Object.values(value.fields ?? {})) {
    if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
      throw new Error('Issue-field bindings must contain field objects.');
    }
    addBindingId(ids, binding.id);
    if (binding.options !== undefined && (!binding.options || typeof binding.options !== 'object' || Array.isArray(binding.options))) {
      throw new Error('Issue-field bindings must contain option objects.');
    }
    for (const runtimeId of Object.values(binding.options ?? {})) addBindingId(ids, runtimeId);
  }
  return [...ids].map((id) => `::add-mask::${escapeWorkflowCommandData(id)}\n`).join('');
}

const isMainModule = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  if (process.env.GITHUB_ACTIONS !== 'true') {
    process.stderr.write('Issue-field binding masks can only be registered in a GitHub Actions job.\n');
    process.exitCode = 2;
  } else {
    try {
      process.stdout.write(issueFieldBindingMaskCommands(process.env.ISSUE_FIELD_BINDINGS_JSON ?? ''));
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  }
}
