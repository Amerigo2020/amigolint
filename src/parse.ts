import { parseDocument as parseYamlDocument } from 'yaml';
import { stripLeadingBom } from './fs-utils.js';
import type {
  AgentKind,
  CodeBlock,
  Doc,
  Heading,
  Line,
  Link,
  Span,
} from './types.js';

interface Fence {
  marker: '`' | '~';
  length: number;
  startLine: number;
  lang: string;
  body: string[];
}

interface PositionedSpan {
  span: Span;
  start: number;
  end: number;
}

interface PositionedLink {
  link: Link;
  start: number;
  end: number;
}

const fencePattern = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const atxHeadingPattern = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/;
const setextHeadingPattern = /^ {0,3}(=+|-+)[ \t]*$/;
const angleLinkPattern = /<([^<>\s]+)>/g;
const bareUrlPattern = /(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>"']+/gi;
const importPattern = /(^|\s)@([^\s`<>"'()]+)/g;
const absoluteUriPattern = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const emailAddressPattern = /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/;
const anglePlaceholderPattern = /^(?:\.{3}|[a-zA-Z][a-zA-Z0-9_-]*\\?)$/;

export function detectAgent(filePath: string): AgentKind {
  const path = normalizeDocPath(filePath);
  const basename = path.slice(path.lastIndexOf('/') + 1);

  if (
    basename === 'CLAUDE.md' ||
    basename === 'CLAUDE.local.md' ||
    /(?:^|\/)\.claude\//.test(path)
  ) {
    return 'claude';
  }
  if (basename === 'AGENTS.md' || /(?:^|\/)\.agents\//.test(path)) {
    return 'codex';
  }
  if (
    basename === '.cursorrules' ||
    /(?:^|\/)\.cursor\/rules\/[^/]+\.mdc$/.test(path)
  ) {
    return 'cursor';
  }
  if (
    /(?:^|\/)\.github\/copilot-instructions\.md$/.test(path) ||
    /(?:^|\/)\.github\/instructions\/[^/]+\.instructions\.md$/.test(path)
  ) {
    return 'copilot';
  }
  if (basename === 'GEMINI.md') {
    return 'gemini';
  }
  if (
    basename === '.windsurfrules' ||
    /(?:^|\/)\.windsurf\/rules\/[^/]+\.md$/.test(path)
  ) {
    return 'windsurf';
  }
  if (
    basename === '.clinerules' ||
    /(?:^|\/)\.clinerules\/[^/]+\.md$/.test(path)
  ) {
    return 'cline';
  }
  if (/(?:^|\/)\.roo\/rules\/[^/]+\.md$/.test(path)) {
    return 'roo';
  }
  return 'generic';
}

export function parseDoc(filePath: string, raw: string): Doc {
  const path = normalizeDocPath(filePath);
  const agent = detectAgent(path);
  const source = stripLeadingBom(raw);
  const textLines = source.replace(/\r\n?/g, '\n').split('\n');
  const frontmatterResult = parseFrontmatter(textLines);
  const lines: Line[] = [];
  const codeBlocks: CodeBlock[] = [];
  const fenceLines = new Set<number>();
  let fence: Fence | undefined;

  for (const [index, text] of textLines.entries()) {
    const lineNumber = index + 1;

    if (fence) {
      if (isClosingFence(text, fence)) {
        lines.push({ n: lineNumber, text, inCodeBlock: false });
        fenceLines.add(lineNumber);
        codeBlocks.push({
          startLine: fence.startLine,
          endLine: lineNumber,
          lang: fence.lang,
          body: fence.body.join('\n'),
        });
        fence = undefined;
      } else {
        lines.push({
          n: lineNumber,
          text,
          inCodeBlock: true,
          ...(fence.lang === '' ? {} : { codeLang: fence.lang }),
        });
        fence.body.push(text);
      }
      continue;
    }

    lines.push({ n: lineNumber, text, inCodeBlock: false });
    if (isFrontmatterLine(index, frontmatterResult.endIndex)) {
      continue;
    }

    const opening = text.match(fencePattern);
    if (!opening) {
      continue;
    }
    const markerRun = opening[1];
    if (!markerRun) {
      continue;
    }
    const info = opening[2]?.trim() ?? '';
    if (markerRun[0] === '`' && info.includes('`')) {
      continue;
    }
    fence = {
      marker: markerRun[0] as '`' | '~',
      length: markerRun.length,
      startLine: lineNumber,
      lang: (info.split(/\s+/, 1)[0] ?? '').toLowerCase(),
      body: [],
    };
    fenceLines.add(lineNumber);
  }

  if (fence) {
    codeBlocks.push({
      startLine: fence.startLine,
      endLine: textLines.length,
      lang: fence.lang,
      body: fence.body.join('\n'),
    });
  }

  const inlineCode: Span[] = [];
  const links: Link[] = [];
  const imports: Span[] = [];
  const headings: Heading[] = [];

  for (const [index, text] of textLines.entries()) {
    if (
      lines[index]?.inCodeBlock ||
      fenceLines.has(index + 1) ||
      isFrontmatterLine(index, frontmatterResult.endIndex)
    ) {
      continue;
    }

    const lineNumber = index + 1;
    const positionedCode = findInlineCode(text, lineNumber);
    inlineCode.push(...positionedCode.map(({ span }) => span));
    links.push(...findLinks(text, lineNumber, positionedCode));

    if (agent === 'claude') {
      imports.push(...findImports(text, lineNumber, positionedCode));
    }

    const atxMatch = text.match(atxHeadingPattern);
    if (atxMatch?.[1]) {
      const headingText = (atxMatch[2] ?? '')
        .replace(/[ \t]+#+[ \t]*$/, '')
        .trim();
      headings.push({
        line: lineNumber,
        level: atxMatch[1].length,
        text: headingText,
      });
    }
  }

  addSetextHeadings(
    textLines,
    lines,
    headings,
    fenceLines,
    frontmatterResult.endIndex,
  );
  headings.sort((left, right) => left.line - right.line);

  return {
    path,
    agent,
    raw,
    ...(frontmatterResult.frontmatter === undefined
      ? {}
      : { frontmatter: frontmatterResult.frontmatter }),
    ...(frontmatterResult.error === undefined
      ? {}
      : { frontmatterError: frontmatterResult.error }),
    lines,
    codeBlocks,
    inlineCode,
    links,
    imports,
    headings,
    approxTokens: Math.ceil(source.length / 3.6),
  };
}

function normalizeDocPath(filePath: string): string {
  return filePath.replaceAll('\\', '/').replace(/^(?:\.\/)+/, '');
}

function parseFrontmatter(textLines: string[]): {
  frontmatter?: Record<string, unknown>;
  endIndex?: number;
  error?: string;
} {
  if (!/^---[ \t]*$/.test(textLines[0] ?? '')) {
    return {};
  }

  const endIndex = textLines.findIndex(
    (line, index) => index > 0 && /^---[ \t]*$/.test(line),
  );
  if (endIndex < 0) {
    return {};
  }

  const source = stripLeadingBom(textLines.slice(1, endIndex).join('\n'));
  try {
    const document = parseYamlDocument(source, { logLevel: 'silent' });
    const parseError = document.errors[0];
    if (parseError) {
      return { frontmatter: {}, endIndex, error: parseError.message };
    }
    const parsed: unknown = document.toJS();
    const frontmatter = isRecord(parsed) ? parsed : {};
    return { frontmatter, endIndex };
  } catch (error) {
    return { frontmatter: {}, endIndex, error: errorMessage(error) };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFrontmatterLine(
  index: number,
  endIndex: number | undefined,
): boolean {
  return endIndex !== undefined && index <= endIndex;
}

function isClosingFence(text: string, fence: Fence): boolean {
  const match = text.match(/^ {0,3}(`+|~+)[ \t]*$/);
  const markerRun = match?.[1];
  return (
    markerRun !== undefined &&
    markerRun[0] === fence.marker &&
    markerRun.length >= fence.length
  );
}

function findInlineCode(text: string, line: number): PositionedSpan[] {
  const spans: PositionedSpan[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const start = findUnescapedBacktick(text, cursor);
    if (start < 0) {
      break;
    }

    const delimiterLength = countRun(text, start, '`');
    let searchFrom = start + delimiterLength;
    let end = -1;

    while (searchFrom < text.length) {
      const possibleEnd = findUnescapedBacktick(text, searchFrom);
      if (possibleEnd < 0) {
        break;
      }
      const runLength = countRun(text, possibleEnd, '`');
      if (runLength === delimiterLength) {
        end = possibleEnd;
        break;
      }
      searchFrom = possibleEnd + runLength;
    }

    if (end < 0) {
      cursor = start + delimiterLength;
      continue;
    }

    spans.push({
      span: {
        line,
        col: start + delimiterLength + 1,
        text: text.slice(start + delimiterLength, end),
      },
      start,
      end: end + delimiterLength,
    });
    cursor = end + delimiterLength;
  }

  return spans;
}

function findUnescapedBacktick(text: string, from: number): number {
  let index = text.indexOf('`', from);
  while (index >= 0) {
    let backslashes = 0;
    for (
      let before = index - 1;
      before >= 0 && text[before] === '\\';
      before--
    ) {
      backslashes += 1;
    }
    if (backslashes % 2 === 0) {
      return index;
    }
    index = text.indexOf('`', index + 1);
  }
  return -1;
}

function countRun(text: string, start: number, character: string): number {
  let end = start;
  while (text[end] === character) {
    end += 1;
  }
  return end - start;
}

function findLinks(
  text: string,
  line: number,
  codeSpans: PositionedSpan[],
): Link[] {
  const found: PositionedLink[] = [];
  const occupied = codeSpans.map(({ start, end }) => ({ start, end }));

  for (const match of findMarkdownLinks(text)) {
    const { start, end, target } = match;
    if (overlaps(start, end, occupied)) {
      continue;
    }
    found.push({
      link: {
        line,
        text: match.text,
        target,
        isLocal: isLocalTarget(target),
      },
      start,
      end,
    });
    occupied.push({ start, end });
  }

  for (const match of text.matchAll(angleLinkPattern)) {
    const start = match.index;
    const rawMatch = match[0];
    const target = match[1];
    if (start === undefined || rawMatch === undefined || target === undefined) {
      continue;
    }
    const end = start + rawMatch.length;
    if (overlaps(start, end, occupied)) {
      continue;
    }
    if (isEscapedAt(text, start) || !isAutolinkTarget(target)) {
      occupied.push({ start, end });
      continue;
    }
    found.push({
      link: { line, text: target, target, isLocal: isLocalTarget(target) },
      start,
      end,
    });
    occupied.push({ start, end });
  }

  for (const match of text.matchAll(bareUrlPattern)) {
    const start = match.index;
    const rawMatch = match[0];
    if (start === undefined || rawMatch === undefined) {
      continue;
    }
    const target = trimBareUrl(rawMatch);
    const end = start + target.length;
    if (target === '' || overlaps(start, end, occupied)) {
      continue;
    }
    found.push({
      link: { line, text: target, target, isLocal: false },
      start,
      end,
    });
    occupied.push({ start, end });
  }

  found.sort((left, right) => left.start - right.start);
  return found.map(({ link }) => link);
}

interface MarkdownLinkMatch {
  start: number;
  end: number;
  text: string;
  target: string;
}

function findMarkdownLinks(input: string): MarkdownLinkMatch[] {
  if (!input.includes('](')) {
    return [];
  }
  const matches: MarkdownLinkMatch[] = [];
  const openingPattern = /!?\[([^\]\n]{0,500})\]\(/g;

  for (const opening of input.matchAll(openingPattern)) {
    if (opening.index === undefined || opening[1] === undefined) {
      continue;
    }
    const parsed = parseMarkdownLinkTarget(
      input,
      opening.index + opening[0].length,
    );
    if (!parsed) {
      continue;
    }
    if (
      parsed.target.startsWith('#') ||
      (parsed.angleWrapped && isAnglePlaceholderTarget(parsed.target))
    ) {
      continue;
    }
    matches.push({
      start: opening.index,
      end: parsed.end,
      text: opening[1],
      target: parsed.target,
    });
  }

  return matches;
}

function parseMarkdownLinkTarget(
  input: string,
  afterOpen: number,
): { target: string; end: number; angleWrapped: boolean } | undefined {
  let start = afterOpen;
  while (input[start] === ' ' || input[start] === '\t') {
    start += 1;
  }

  if (input[start] === '<') {
    const angleEnd = input.indexOf('>', start + 1);
    if (angleEnd < 0) {
      return undefined;
    }
    const close = findMarkdownLinkClose(input, angleEnd + 1);
    return close < 0
      ? undefined
      : {
          target: input.slice(start + 1, angleEnd),
          end: close + 1,
          angleWrapped: true,
        };
  }

  let depth = 0;
  for (let index = start; index < input.length; index++) {
    if (isEscapedAt(input, index)) {
      index += 1;
      continue;
    }
    const character = input[index];
    if (character === '(') {
      depth += 1;
    } else if (character === ')' && depth === 0) {
      return {
        target: input.slice(start, index),
        end: index + 1,
        angleWrapped: false,
      };
    } else if (character === ')') {
      depth -= 1;
    } else if ((character === ' ' || character === '\t') && depth === 0) {
      const close = findMarkdownLinkClose(input, index);
      return close < 0
        ? undefined
        : {
            target: input.slice(start, index),
            end: close + 1,
            angleWrapped: false,
          };
    }
  }
  return undefined;
}

function findMarkdownLinkClose(input: string, from: number): number {
  let depth = 0;
  let quote: '"' | "'" | undefined;
  for (let index = from; index < input.length; index++) {
    if (isEscapedAt(input, index)) {
      index += 1;
      continue;
    }
    const character = input[index];
    if (quote !== undefined) {
      if (character === quote) {
        quote = undefined;
      }
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '(') {
      depth += 1;
    } else if (character === ')' && depth === 0) {
      return index;
    } else if (character === ')') {
      depth -= 1;
    }
  }
  return -1;
}

function isEscapedAt(input: string, index: number): boolean {
  let backslashes = 0;
  for (
    let before = index - 1;
    before >= 0 && input[before] === '\\';
    before--
  ) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function findImports(
  text: string,
  line: number,
  codeSpans: PositionedSpan[],
): Span[] {
  const imports: Span[] = [];
  for (const match of text.matchAll(importPattern)) {
    const matchStart = match.index;
    const boundary = match[1] ?? '';
    let importedPath = match[2];
    if (matchStart === undefined || importedPath === undefined) {
      continue;
    }
    importedPath = importedPath.replace(/[.,;:!?]+$/, '');
    if (importedPath === '') {
      continue;
    }
    const atIndex = matchStart + boundary.length;
    const end = atIndex + 1 + importedPath.length;
    if (overlaps(atIndex, end, codeSpans)) {
      continue;
    }
    imports.push({ line, col: atIndex + 2, text: importedPath });
  }
  return imports;
}

function isLocalTarget(target: string): boolean {
  return !(
    target.startsWith('#') ||
    target.startsWith('//') ||
    target.toLowerCase().startsWith('www.') ||
    emailAddressPattern.test(target) ||
    absoluteUriPattern.test(target)
  );
}

function isAutolinkTarget(target: string): boolean {
  return absoluteUriPattern.test(target) || emailAddressPattern.test(target);
}

function isAnglePlaceholderTarget(target: string): boolean {
  return anglePlaceholderPattern.test(target);
}

function trimBareUrl(value: string): string {
  let result = value.replace(/[.,;:!?]+$/, '');
  while (
    result.endsWith(')') &&
    countCharacter(result, ')') > countCharacter(result, '(')
  ) {
    result = result.slice(0, -1);
  }
  while (
    result.endsWith(']') &&
    countCharacter(result, ']') > countCharacter(result, '[')
  ) {
    result = result.slice(0, -1);
  }
  return result;
}

function countCharacter(value: string, character: string): number {
  let count = 0;
  for (const candidate of value) {
    if (candidate === character) {
      count += 1;
    }
  }
  return count;
}

function overlaps(
  start: number,
  end: number,
  ranges: Array<{ start: number; end: number }>,
): boolean {
  return ranges.some((range) => start < range.end && end > range.start);
}

function addSetextHeadings(
  textLines: string[],
  lines: Line[],
  headings: Heading[],
  fenceLines: Set<number>,
  frontmatterEndIndex: number | undefined,
): void {
  const existingLines = new Set(headings.map(({ line }) => line));
  for (let index = 1; index < textLines.length; index++) {
    const underline = textLines[index]?.match(setextHeadingPattern);
    const headingText = textLines[index - 1]?.trim() ?? '';
    const headingLine = index;
    if (
      !underline?.[1] ||
      headingText === '' ||
      lines[index]?.inCodeBlock ||
      lines[index - 1]?.inCodeBlock ||
      fenceLines.has(index) ||
      fenceLines.has(index + 1) ||
      isFrontmatterLine(index, frontmatterEndIndex) ||
      isFrontmatterLine(index - 1, frontmatterEndIndex) ||
      existingLines.has(headingLine) ||
      atxHeadingPattern.test(headingText)
    ) {
      continue;
    }
    headings.push({
      line: headingLine,
      level: underline[1][0] === '=' ? 1 : 2,
      text: headingText,
    });
    existingLines.add(headingLine);
  }
}
