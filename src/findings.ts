import type { Finding } from './rules/types.js';

/** Keep user-controlled rule messages safe for every line-oriented reporter. */
export function normalizeFinding(finding: Finding): Finding {
  return {
    ...finding,
    message: finding.message.replace(/(?:\r\n|[\r\n])+/g, ' ').trim(),
  };
}
