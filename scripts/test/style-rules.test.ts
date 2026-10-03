import { describe, expect, it } from 'vitest';
import { findComments, findDashes, isCommentChecked } from '../style-rules.ts';

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);

describe('findComments', () => {
  it('finds line, block and trailing comments in TypeScript', () => {
    const text = ['const a = 1; // trailing', '/* block */', 'const b = 2;', '// own line'].join(
      '\n',
    );
    expect(findComments('a.ts', '.ts', text).map((violation) => violation.line)).toEqual([1, 2, 4]);
  });

  it('ignores comment markers inside strings, templates and regular expressions', () => {
    const text = [
      'const url = "http://example.test/a";',
      'const template = `// not a comment`;',
      'const pattern = /a\\/\\//u;',
    ].join('\n');
    expect(findComments('a.ts', '.ts', text)).toEqual([]);
  });

  it('allows a shebang line', () => {
    expect(findComments('a.js', '.js', '#!/usr/bin/env node\nconsole.log(1);\n')).toEqual([]);
  });

  it('finds comments in JSON', () => {
    expect(findComments('a.json', '.json', '{ // note\n  "a": 1\n}\n')).toHaveLength(1);
    expect(findComments('a.json', '.json', '{ "url": "http://x.test" }\n')).toEqual([]);
  });

  it('finds comments in markup and stylesheets', () => {
    expect(findComments('a.html', '.html', '<div></div>\n<!-- x -->')).toHaveLength(1);
    expect(findComments('a.css', '.css', 'a { color: red; } /* x */')).toHaveLength(1);
  });

  it('does not check other file types', () => {
    expect(isCommentChecked('.md')).toBe(false);
    expect(findComments('a.md', '.md', '<!-- x -->')).toEqual([]);
  });
});

describe('findDashes', () => {
  it('finds em and en dashes with line numbers', () => {
    const text = `fine\nbad ${EM_DASH} here\nalso ${EN_DASH} bad`;
    expect(findDashes(text).map((violation) => violation.line)).toEqual([2, 3]);
  });

  it('accepts hyphens and minus signs', () => {
    expect(findDashes('well-known 1 - 2 -3')).toEqual([]);
  });
});
