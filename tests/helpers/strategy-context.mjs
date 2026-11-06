import { createHash } from 'node:crypto';

// Synthetic controller fixture; production admission uses the immutable loader.
export function contextFixture(origin = { repository: 'fixture/repo', repositoryId: 101, issueNumber: 7, issueNodeId: 'I_7' }, overrides = {}) {
  const data = { schemaVersion: 1, selectionPolicy: '1.0.0', origin,
    architecture: { repository: 'agentic-delivery-lab/agentic-delivery-architecture', repositoryId: 1380894616,
      commit: 'ba804c044bd7dc0a7c5568062d43a1f0d9f3141b', version: '0.1.0',
      sourceCommit: '0423533176ad6239fe5d828736605b5a6360293c',
      contentSha256: 'b754a82b5fca30a933057602bba6ab4f204c2a937be3a3076d7610aacac826d2',
      contractVersions: { architectureRelease: '5.1.0', conformance: '1.0.0', adrPrimitiveIndex: '4.0.0', decisionInventory: '1.1.0', architectureArtifacts: '1.0.0', evaluationReport: '2.0.0', requirementsReference: '1.0.0', evaluationOwnership: '1.0.0' } },
    requirements: { authority: { repository: 'agentic-delivery-lab/agentic-delivery-requirements', repositoryId: 1416207421,
      commit: '9ce017453a23240042f72214b09e3c6c5059854d', sourceCommit: '059aad42e0e3e4b8e305f46a1d474a12ffdb8f33',
      version: '1.0.0', contentSha256: 'eec84e8ff2b276ef322b9262ede31edad9f4c0f9f30a7527a9607dd9f411a1c4' },
      tooling: { commit: '2d20d40dcd1fb50d04310da2d222fb1a6fc1fa31', path: 'tools/validate-requirements.mjs',
        sha256: '284f4aa16981bf4bf324b4a0763bdba3ce67e920838325c29d061140f6d46ead' }, records: [] },
    contexts: [], goals: [], principles: [], decisions: [], evaluation: { scope: 'offline-proposal-only', measures: [], mappings: [] }, ...overrides };
  return { ...data, sha256: createHash('sha256').update(JSON.stringify(data)).digest('hex') };
}
