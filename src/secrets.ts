interface SecretDetector {
  label: string;
  pattern: RegExp;
  secretGroup?: number;
}

export interface SecretDetection {
  label: string;
  secret: string;
  start: number;
  end: number;
}

const detectors: SecretDetector[] = [
  {
    label: 'AWS access key',
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    label: 'API token',
    pattern: /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/g,
  },
  {
    label: 'GitHub token',
    pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
  },
  {
    label: 'Slack token',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  },
  {
    label: 'private key',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    label: 'JWT',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  },
  {
    label: 'database credential',
    pattern: /(?:postgres|mysql|mongodb)(?:\+srv)?:\/\/[^:\s]+:([^@\s]{4,})@/gi,
    secretGroup: 1,
  },
  {
    label: 'assigned credential',
    pattern:
      /(?:api[_-]?key|secret|token|password)\s*[:=]\s*["']?([A-Za-z0-9_-]{16,})/gi,
    secretGroup: 1,
  },
];

export function findSecrets(raw: string): SecretDetection[] {
  const detections: SecretDetection[] = [];

  for (const detector of detectors) {
    for (const match of raw.matchAll(detector.pattern)) {
      if (match.index === undefined) {
        continue;
      }
      const secret = match[detector.secretGroup ?? 0];
      if (secret === undefined) {
        continue;
      }
      const relativeStart = match[0].indexOf(secret);
      if (relativeStart < 0) {
        continue;
      }
      const start = match.index + relativeStart;
      const end = start + secret.length;
      if (
        isPlaceholder(secret, raw, start, end) ||
        detections.some(
          (existing) => start < existing.end && end > existing.start,
        )
      ) {
        continue;
      }
      detections.push({ label: detector.label, secret, start, end });
    }
  }

  return detections.sort((left, right) => left.start - right.start);
}

export function maskSecret(secret: string): string {
  const visibleCharacters = Math.min(4, Math.max(0, secret.length - 1));
  return `${secret.slice(0, visibleCharacters)}****`;
}

export function redactSecrets(value: string): string {
  let redacted = value;
  for (const detection of findSecrets(value).reverse()) {
    redacted = `${redacted.slice(0, detection.start)}${maskSecret(detection.secret)}${redacted.slice(detection.end)}`;
  }
  return redacted;
}

function isPlaceholder(
  secret: string,
  raw: string,
  start: number,
  end: number,
): boolean {
  const normalized = secret.toLowerCase();
  const providerPayload = normalized.match(/^sk-(?:ant-)?(.+)$/)?.[1];
  return (
    (raw[start - 1] === '<' && raw[end] === '>') ||
    normalized === 'sk-...' ||
    /^<[^>]+>$/.test(normalized) ||
    /^x(?:x|[._-]){2,}$/.test(normalized) ||
    (providerPayload !== undefined && /^[x._-]+$/.test(providerPayload)) ||
    /^(?:123456)+$/.test(normalized) ||
    /^(?:your[-_]|replace[-_]?me)/.test(normalized) ||
    normalized.includes('example') ||
    normalized.includes('changeme') ||
    normalized.includes('placeholder')
  );
}
