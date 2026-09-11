// agentic-primitive: {"id":"commit-format-validator","kind":"validator","enforcement":"deterministic","adrs":["ADR-0005"],"domains":["agentic-delivery-governance"]}
import conventionalConfig from '@commitlint/config-conventional';

// The conventional preset's parser package is ESM-only. Keep its rules while
// omitting the optional parser preset so commitlint can resolve the config from
// pnpm's isolated dependency graph on every supported Node.js platform.
const { parserPreset: _parserPreset, ...portableConfig } = conventionalConfig;

export default portableConfig;
