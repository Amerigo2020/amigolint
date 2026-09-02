export type AgentKind =
  | 'claude'
  | 'codex'
  | 'cursor'
  | 'copilot'
  | 'gemini'
  | 'windsurf'
  | 'cline'
  | 'roo'
  | 'generic';

export interface Line {
  n: number;
  text: string;
  inCodeBlock: boolean;
  codeLang?: string;
}

export interface CodeBlock {
  startLine: number;
  endLine: number;
  lang: string;
  body: string;
}

export interface Span {
  line: number;
  col: number;
  text: string;
}

export interface Link {
  line: number;
  text: string;
  target: string;
  isLocal: boolean;
}

export interface Heading {
  line: number;
  level: number;
  text: string;
}

export interface Doc {
  path: string;
  agent: AgentKind;
  raw: string;
  frontmatter?: Record<string, unknown>;
  lines: Line[];
  codeBlocks: CodeBlock[];
  inlineCode: Span[];
  links: Link[];
  imports: Span[];
  headings: Heading[];
  approxTokens: number;
}
