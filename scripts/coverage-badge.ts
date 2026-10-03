import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from './files.ts';

interface LineTotals {
  total: number;
  covered: number;
}

interface CoverageSummary {
  total: { lines: LineTotals };
}

const SUMMARIES = [
  'coverage/coverage-summary.json',
  'apps/editor/coverage/editor/coverage-summary.json',
];
const OUTPUT = 'docs/media/coverage.svg';
const CHAR_WIDTH = 6.4;
const PADDING = 12;

export function combinedLinePercent(summaries: readonly CoverageSummary[]): number {
  const covered = summaries.reduce((sum, entry) => sum + entry.total.lines.covered, 0);
  const total = summaries.reduce((sum, entry) => sum + entry.total.lines.total, 0);
  return total === 0 ? 0 : Math.floor((covered / total) * 1000) / 10;
}

function colorFor(percent: number): string {
  if (percent >= 90) return '#2e7d32';
  if (percent >= 80) return '#9a6700';
  return '#c62828';
}

function textWidth(text: string): number {
  return Math.round(text.length * CHAR_WIDTH + PADDING);
}

export function badgeSvg(label: string, value: string, color: string): string {
  const left = textWidth(label);
  const right = textWidth(value);
  const width = left + right;
  const title = `${label}: ${value}`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${title}">`,
    `<title>${title}</title>`,
    `<clipPath id="round"><rect width="${width}" height="20" rx="3"/></clipPath>`,
    `<g clip-path="url(#round)">`,
    `<rect width="${left}" height="20" fill="#555"/>`,
    `<rect x="${left}" width="${right}" height="20" fill="${color}"/>`,
    `</g>`,
    `<g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle">`,
    `<text x="${left / 2}" y="14">${label}</text>`,
    `<text x="${left + right / 2}" y="14">${value}</text>`,
    `</g>`,
    `</svg>`,
    ``,
  ].join('');
}

function readSummary(path: string): CoverageSummary {
  return JSON.parse(readFileSync(resolve(repoRoot, path), 'utf8')) as CoverageSummary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const percent = combinedLinePercent(SUMMARIES.map(readSummary));
  writeFileSync(resolve(repoRoot, OUTPUT), badgeSvg('coverage', `${percent}%`, colorFor(percent)));
  process.stdout.write(`${OUTPUT}: ${percent}% of lines\n`);
}
