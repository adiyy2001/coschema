import { extensionOf, listProjectFiles, readProjectFile } from './files.ts';
import { findComments, findDashes, isCommentChecked } from './style-rules.ts';

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.mts',
  '.cts',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.html',
  '.css',
  '.scss',
  '.md',
  '.yml',
  '.yaml',
  '.sql',
  '.conf',
  '.txt',
  '',
]);
const SKIPPED_FILES = new Set(['pnpm-lock.yaml', 'BRIEF.md', 'NOTES_FOR_ADRIAN.md', 'PLAN.md']);

function main(): void {
  const problems: string[] = [];
  for (const file of listProjectFiles()) {
    const extension = extensionOf(file);
    if (SKIPPED_FILES.has(file) || !TEXT_EXTENSIONS.has(extension)) continue;
    const text = readProjectFile(file);
    const violations = [
      ...(isCommentChecked(extension) ? findComments(file, extension, text) : []),
      ...findDashes(text),
    ];
    for (const violation of violations) {
      problems.push(`${file}:${violation.line} ${violation.message}`);
    }
  }
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    console.error(`style check failed: ${problems.length} problem(s)`);
    process.exit(1);
  }
  console.log('style check passed');
}

main();
