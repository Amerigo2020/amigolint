import { describe, expect, it } from 'vitest';
import { detectAgent, parseDoc } from '../src/parse.js';

describe('detectAgent', () => {
  it.each([
    ['CLAUDE.md', 'claude'],
    ['packages/api/CLAUDE.local.md', 'claude'],
    ['.claude/skills/review/SKILL.md', 'claude'],
    ['AGENTS.md', 'codex'],
    ['packages/api/AGENTS.md', 'codex'],
    ['.agents/skills/review/SKILL.md', 'codex'],
    ['.cursorrules', 'cursor'],
    ['.cursor/rules/typescript.mdc', 'cursor'],
    ['.github/copilot-instructions.md', 'copilot'],
    ['.github/instructions/tests.instructions.md', 'copilot'],
    ['GEMINI.md', 'gemini'],
    ['.windsurfrules', 'windsurf'],
    ['.windsurf/rules/typescript.md', 'windsurf'],
    ['.clinerules', 'cline'],
    ['.clinerules/typescript.md', 'cline'],
    ['.roo/rules/typescript.md', 'roo'],
    ['docs/custom.md', 'generic'],
  ] as const)('detects %s as %s', (path, expected) => {
    expect(detectAgent(path)).toBe(expected);
  });

  it('normalizes Windows separators before detecting an agent', () => {
    expect(detectAgent('.cursor\\rules\\typescript.mdc')).toBe('cursor');
  });
});

describe('parseDoc', () => {
  it('parses backtick and tilde fenced blocks and records line state', () => {
    const raw = [
      '# Commands',
      '```BASH title=example',
      'pnpm test',
      '~~~ is content in a backtick fence',
      '```',
      '~~~ts',
      'const value = `inline-looking`;',
      '~~~~',
      'After',
    ].join('\n');

    const doc = parseDoc('./AGENTS.md', raw);

    expect(doc.path).toBe('AGENTS.md');
    expect(doc.codeBlocks).toEqual([
      {
        startLine: 2,
        endLine: 5,
        lang: 'bash',
        body: 'pnpm test\n~~~ is content in a backtick fence',
      },
      {
        startLine: 6,
        endLine: 8,
        lang: 'ts',
        body: 'const value = `inline-looking`;',
      },
    ]);
    expect(doc.lines).toEqual([
      { n: 1, text: '# Commands', inCodeBlock: false },
      { n: 2, text: '```BASH title=example', inCodeBlock: false },
      { n: 3, text: 'pnpm test', inCodeBlock: true, codeLang: 'bash' },
      {
        n: 4,
        text: '~~~ is content in a backtick fence',
        inCodeBlock: true,
        codeLang: 'bash',
      },
      { n: 5, text: '```', inCodeBlock: false },
      { n: 6, text: '~~~ts', inCodeBlock: false },
      {
        n: 7,
        text: 'const value = `inline-looking`;',
        inCodeBlock: true,
        codeLang: 'ts',
      },
      { n: 8, text: '~~~~', inCodeBlock: false },
      { n: 9, text: 'After', inCodeBlock: false },
    ]);
    expect(doc.inlineCode).toEqual([]);
  });

  it('keeps an unterminated fence through the final line', () => {
    const doc = parseDoc('CLAUDE.md', 'Before\n```\ninside\nstill inside');

    expect(doc.codeBlocks).toEqual([
      {
        startLine: 2,
        endLine: 4,
        lang: '',
        body: 'inside\nstill inside',
      },
    ]);
    expect(doc.lines[3]).toEqual({
      n: 4,
      text: 'still inside',
      inCodeBlock: true,
    });
  });

  it('parses inline code with variable and nested backtick delimiters', () => {
    const doc = parseDoc(
      'AGENTS.md',
      'Use `src/one.ts`, ``code with `nested` ticks``, and ```a `` pair```.',
    );

    expect(doc.inlineCode).toEqual([
      { line: 1, col: 6, text: 'src/one.ts' },
      { line: 1, col: 21, text: 'code with `nested` ticks' },
      { line: 1, col: 56, text: 'a `` pair' },
    ]);
  });

  it('parses markdown links and bare URLs without duplicating link targets', () => {
    const doc = parseDoc(
      'AGENTS.md',
      'Read [local docs](docs/guide.md#start), [site](https://example.com/a), https://openai.com/docs, and <support@example.com>.',
    );

    expect(doc.links).toEqual([
      {
        line: 1,
        text: 'local docs',
        target: 'docs/guide.md#start',
        isLocal: true,
      },
      {
        line: 1,
        text: 'site',
        target: 'https://example.com/a',
        isLocal: false,
      },
      {
        line: 1,
        text: 'https://openai.com/docs',
        target: 'https://openai.com/docs',
        isLocal: false,
      },
      {
        line: 1,
        text: 'support@example.com',
        target: 'support@example.com',
        isLocal: false,
      },
    ]);
  });

  it('keeps balanced parentheses inside markdown link targets', () => {
    const doc = parseDoc(
      'AGENTS.md',
      'Read [the local page](docs/a_(b).md#section) next.',
    );

    expect(doc.links).toEqual([
      {
        line: 1,
        text: 'the local page',
        target: 'docs/a_(b).md#section',
        isLocal: true,
      },
    ]);
  });

  it('does not parse HTML tags or angle-bracket placeholders as links', () => {
    const doc = parseDoc(
      'AGENTS.md',
      'Use <details>, </summary>, <div>, and <your-key>; read <docs/guide.md>.',
    );

    expect(doc.links).toEqual([
      {
        line: 1,
        text: 'docs/guide.md',
        target: 'docs/guide.md',
        isLocal: true,
      },
    ]);
  });

  it('parses Claude imports only outside code and at a whitespace boundary', () => {
    const doc = parseDoc(
      'CLAUDE.md',
      [
        '@docs/root.md',
        'Also @../shared/CLAUDE.md and email@example.com',
        '`@docs/example.md` is illustrative',
        '```md',
        '@docs/in-a-fence.md',
        '```',
      ].join('\n'),
    );

    expect(doc.imports).toEqual([
      { line: 1, col: 2, text: 'docs/root.md' },
      { line: 2, col: 7, text: '../shared/CLAUDE.md' },
    ]);
    expect(parseDoc('AGENTS.md', '@docs/root.md').imports).toEqual([]);
  });

  it('preserves scoped glob and root-alias import tokens', () => {
    const doc = parseDoc(
      'CLAUDE.md',
      'Packages @atlaskit/* and @higgsfield/quanta/*\nAlias @/path/to/file.json',
    );

    expect(doc.imports).toEqual([
      { line: 1, col: 11, text: 'atlaskit/*' },
      { line: 1, col: 27, text: 'higgsfield/quanta/*' },
      { line: 2, col: 8, text: '/path/to/file.json' },
    ]);
  });

  it('parses YAML frontmatter and omits it from Markdown spans', () => {
    const raw = [
      '---',
      'description: Check [not a link](missing.md)',
      'alwaysApply: true',
      'globs:',
      '  - "src/**/*.ts"',
      '---',
      '# Rule',
      'Read `src/index.ts`.',
    ].join('\n');

    const doc = parseDoc('.cursor/rules/typescript.mdc', raw);

    expect(doc.frontmatter).toEqual({
      description: 'Check [not a link](missing.md)',
      alwaysApply: true,
      globs: ['src/**/*.ts'],
    });
    expect(doc.inlineCode).toEqual([{ line: 8, col: 7, text: 'src/index.ts' }]);
    expect(doc.links).toEqual([]);
    expect(doc.headings).toEqual([{ line: 7, level: 1, text: 'Rule' }]);
  });

  it('keeps parsing when YAML frontmatter is malformed', () => {
    const doc = parseDoc(
      '.cursor/rules/broken.mdc',
      '---\nglobs: [unterminated\n---\n# Still parsed',
    );

    expect(doc.frontmatter).toEqual({});
    expect(doc.headings).toEqual([{ line: 4, level: 1, text: 'Still parsed' }]);
  });

  it('parses ATX and setext headings outside code blocks', () => {
    const doc = parseDoc(
      'AGENTS.md',
      '# First #\n\nSecond\n------\n```md\n# Not a heading\n```',
    );

    expect(doc.headings).toEqual([
      { line: 1, level: 1, text: 'First' },
      { line: 3, level: 2, text: 'Second' },
    ]);
  });

  it('normalizes CRLF for line-oriented parsing while preserving raw text', () => {
    const raw = '---\r\nname: review\r\n---\r\n# Review\r\nUse `src/a.ts`.\r\n';
    const doc = parseDoc('.claude/skills/review/SKILL.md', raw);

    expect(doc.raw).toBe(raw);
    expect(doc.lines).toHaveLength(6);
    expect(doc.lines.map((line) => line.text)).toEqual([
      '---',
      'name: review',
      '---',
      '# Review',
      'Use `src/a.ts`.',
      '',
    ]);
    expect(doc.inlineCode).toEqual([{ line: 5, col: 6, text: 'src/a.ts' }]);
  });

  it('uses the specified approximate token heuristic', () => {
    const raw = 'a'.repeat(37);
    expect(parseDoc('AGENTS.md', raw).approxTokens).toBe(Math.ceil(37 / 3.6));
  });
});
