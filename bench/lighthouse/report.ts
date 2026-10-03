export const MIN_ACCESSIBILITY_SCORE = 95;
export const LIGHTHOUSE_VERSION = '13.5.0';

export interface FailedAudit {
  readonly id: string;
  readonly title: string;
  readonly items: number;
  readonly examples: readonly string[];
}

export interface AccessibilityReport {
  readonly score: number;
  readonly failed: readonly FailedAudit[];
}

export interface PageResult extends AccessibilityReport {
  readonly path: string;
  readonly formFactor: 'desktop' | 'mobile';
  readonly meetsTarget: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

const MAX_EXAMPLES = 3;
const MAX_EXAMPLE_LENGTH = 160;

function itemsOf(audit: Record<string, unknown>): readonly unknown[] {
  const details = asRecord(audit['details']);
  const items = details?.['items'];
  return Array.isArray(items) ? (items as unknown[]) : [];
}

function snippetOf(item: unknown): string | undefined {
  const node = asRecord(asRecord(item)?.['node']);
  const snippet = node?.['snippet'];
  return typeof snippet === 'string' ? snippet.slice(0, MAX_EXAMPLE_LENGTH) : undefined;
}

export function parseAccessibilityReport(raw: unknown): AccessibilityReport {
  const report = asRecord(raw);
  const categories = asRecord(report?.['categories']);
  const accessibility = asRecord(categories?.['accessibility']);
  const score = accessibility?.['score'];
  if (typeof score !== 'number') throw new Error('report has no accessibility score');
  const audits = asRecord(report?.['audits']) ?? {};
  const failed: FailedAudit[] = [];
  for (const [id, value] of Object.entries(audits)) {
    const audit = asRecord(value);
    if (audit === undefined || audit['scoreDisplayMode'] !== 'binary') continue;
    if (audit['score'] !== 0) continue;
    const title = typeof audit['title'] === 'string' ? audit['title'] : id;
    const items = itemsOf(audit);
    const examples = items.flatMap((item) => snippetOf(item) ?? []).slice(0, MAX_EXAMPLES);
    failed.push({ id, title, items: items.length, examples });
  }
  return { score: Math.round(score * 100), failed };
}

export function toPageResult(
  path: string,
  formFactor: PageResult['formFactor'],
  report: AccessibilityReport,
): PageResult {
  return {
    path,
    formFactor,
    ...report,
    meetsTarget: report.score >= MIN_ACCESSIBILITY_SCORE,
  };
}

export function allMeetTarget(results: readonly PageResult[]): boolean {
  return results.length > 0 && results.every((result) => result.meetsTarget);
}
