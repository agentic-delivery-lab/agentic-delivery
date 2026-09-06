import { parseDocument } from 'yaml';

export class YamlParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'YamlParseError';
  }
}

export function parseRepositoryYaml(source, description = 'YAML') {
  const document = parseDocument(source, {
    version: '1.2',
    schema: 'core',
    customTags: [],
    resolveKnownTags: false,
    merge: false,
    strict: true,
    uniqueKeys: true,
  });

  const diagnostics = [...document.errors, ...document.warnings];
  if (diagnostics.length > 0) {
    const first = diagnostics[0];
    throw new YamlParseError(`${description}: ${first.message}`);
  }

  try {
    return document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    throw new YamlParseError(`${description}: ${error.message}`);
  }
}
