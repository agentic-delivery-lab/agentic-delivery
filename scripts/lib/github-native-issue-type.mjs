// agentic-primitive: {"id":"github-native-issue-type","kind":"customization","enforcement":"deterministic","adrs":["ADR-0009","ADR-0011"],"domains":["agentic-delivery-governance"]}

const ISSUE_TYPE_QUERY = `
  query NativeIssueType($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $number) {
        issueType { name }
      }
    }
  }
`;

export async function getNativeIssueType({ repository, issueNumber, token, fetchImpl = globalThis.fetch } = {}) {
  const match = String(repository ?? '').match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!match || !Number.isSafeInteger(issueNumber) || issueNumber < 1 || !token) {
    throw new Error('A repository, positive issue number, and GH_TOKEN are required to verify the native issue type.');
  }

  const response = await fetchImpl('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2026-03-10',
    },
    body: JSON.stringify({
      query: ISSUE_TYPE_QUERY,
      variables: { owner: match[1], name: match[2], number: issueNumber },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GitHub native issue-type lookup returned HTTP ${response.status}.`);
  const payload = await response.json();
  if (payload?.errors?.length) throw new Error('GitHub native issue-type lookup returned GraphQL errors.');
  const issue = payload?.data?.repository?.issue;
  if (!issue || (issue.issueType !== null && typeof issue.issueType?.name !== 'string')) {
    throw new Error('GitHub native issue-type lookup returned invalid issue evidence.');
  }
  return issue.issueType?.name ?? null;
}
