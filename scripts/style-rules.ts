import ts from 'typescript';

export interface Violation {
  line: number;
  message: string;
}

const SCRIPT_EXTENSIONS = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs']);
const JSON_EXTENSIONS = new Set(['.json']);
const MARKUP_EXTENSIONS = new Set(['.html']);
const STYLESHEET_EXTENSIONS = new Set(['.css', '.scss']);
const EN_DASH = String.fromCharCode(0x2013);
const EM_DASH = String.fromCharCode(0x2014);
const DASH_PATTERN = new RegExp(`[${EN_DASH}${EM_DASH}]`, 'u');

export function isCommentChecked(extension: string): boolean {
  return (
    SCRIPT_EXTENSIONS.has(extension) ||
    JSON_EXTENSIONS.has(extension) ||
    MARKUP_EXTENSIONS.has(extension) ||
    STYLESHEET_EXTENSIONS.has(extension)
  );
}

function lineOf(sourceFile: ts.SourceFile, position: number): number {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}

function commentsInTokens(sourceFile: ts.SourceFile, text: string): Violation[] {
  const violations: Violation[] = [];
  const seen = new Set<number>();
  const record = (ranges: readonly ts.CommentRange[] | undefined): void => {
    for (const range of ranges ?? []) {
      if (seen.has(range.pos)) continue;
      seen.add(range.pos);
      const isShebang = range.pos === 0 && text.startsWith('#!');
      if (!isShebang) violations.push({ line: lineOf(sourceFile, range.pos), message: 'comment' });
    }
  };
  const visit = (node: ts.Node): void => {
    const children = node.getChildren(sourceFile);
    if (children.length === 0) {
      record(ts.getLeadingCommentRanges(text, node.getFullStart()));
      record(ts.getTrailingCommentRanges(text, node.getEnd()));
      return;
    }
    children.forEach(visit);
  };
  visit(sourceFile);
  return violations.sort((left, right) => left.line - right.line);
}

function scriptComments(file: string, text: string): Violation[] {
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  return commentsInTokens(sourceFile, text);
}

function jsonComments(file: string, text: string): Violation[] {
  const sourceFile = ts.parseJsonText(file, text);
  return commentsInTokens(sourceFile, text);
}

function patternComments(text: string, pattern: RegExp): Violation[] {
  const violations: Violation[] = [];
  text.split('\n').forEach((line, index) => {
    if (pattern.test(line)) violations.push({ line: index + 1, message: 'comment' });
  });
  return violations;
}

export function findComments(file: string, extension: string, text: string): Violation[] {
  if (SCRIPT_EXTENSIONS.has(extension)) return scriptComments(file, text);
  if (JSON_EXTENSIONS.has(extension)) return jsonComments(file, text);
  if (MARKUP_EXTENSIONS.has(extension)) return patternComments(text, /<!--/u);
  if (STYLESHEET_EXTENSIONS.has(extension)) return patternComments(text, /\/\*/u);
  return [];
}

export function findDashes(text: string): Violation[] {
  const violations: Violation[] = [];
  text.split('\n').forEach((line, index) => {
    if (DASH_PATTERN.test(line)) {
      violations.push({ line: index + 1, message: 'em or en dash' });
    }
  });
  return violations;
}
