import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import matter from 'gray-matter';
import { DocChunk } from '../../src/types/seer';

const ALIAS_MAP: Record<string, string> = {
  '@site/': '',
  '@dev/': 'docs/developers/',
  '@devComponents/': 'docs/developers/components/',
  '@tech/': 'docs/technical-docs/',
  '@techComponents/': 'docs/technical-docs/components/',
  '@kb/': 'docs/knowledge-base/',
  '@kbComponents/': 'docs/knowledge-base/components/',
  '@apps/': 'docs/applications/',
  '@appComponents/': 'docs/applications/components/',
};

const PRODUCT_HINTS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bmove[-_\s]?4k\b/i, label: 'Move 4K' },
  { pattern: /\bmove[-_\s]?se\b/i, label: 'Move SE' },
  { pattern: /\blink[-_\s]?4k\b/i, label: 'Link 4K' },
  { pattern: /\bstudio[-_\s]?pro\b/i, label: 'Studio Pro' },
  { pattern: /\bstudio[-_\s]?4k\b/i, label: 'Studio 4K' },
  { pattern: /\bsuperjoy\b/i, label: 'SuperJoy (PT-SUPERJOY-G1)' },
  { pattern: /\bpt[-_\s]?joy[-_\s]?g4\b/i, label: 'PT-JOY-G4 (4D IP Joystick)' },
  { pattern: /\bhc[-_\s]?joy[-_\s]?g4\b/i, label: 'HC-JOY-G4 (Serial Joystick)' },
  { pattern: /\bjoy[-_\s]?g3\b/i, label: 'PT-JOY-G3' },
  { pattern: /\bsimpltrack\b/i, label: 'SimplTrack' },
  { pattern: /\bhive\b/i, label: 'Hive Studio' },
  { pattern: /\bcmp\b|\bcamera management platform\b/i, label: 'CMP (Camera Management Platform)' },
  { pattern: /\bobs\b/i, label: 'OBS Plugin / Dock' },
];

function walkMarkdownFiles(dir: string, results: string[] = []): string[] {
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'build') {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkMarkdownFiles(fullPath, results);
    } else if (/\.(md|mdx)$/i.test(entry.name) && !entry.name.startsWith('_')) {
      results.push(fullPath);
    }
  }
  return results;
}

function resolveImportedMdxContent(
  rawContent: string,
  currentFilePath: string,
  repoRoot: string,
  depth = 0
): string {
  if (depth > 2) return rawContent;

  const importRegex = /import\s+\w+\s+from\s+['"]([^'"]+\.(?:md|mdx))['"]\s*;?/g;
  const inlinedParts: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(rawContent)) !== null) {
    const importSpec = match[1];
    let resolvedPath: string | null = null;

    if (importSpec.startsWith('.')) {
      resolvedPath = path.resolve(path.dirname(currentFilePath), importSpec);
    } else {
      for (const [alias, targetPrefix] of Object.entries(ALIAS_MAP)) {
        if (importSpec.startsWith(alias)) {
          const subPath = importSpec.slice(alias.length);
          resolvedPath = path.resolve(repoRoot, targetPrefix, subPath);
          break;
        }
      }
    }

    if (resolvedPath && fs.existsSync(resolvedPath)) {
      try {
        const importedRaw = fs.readFileSync(resolvedPath, 'utf-8');
        const parsed = matter(importedRaw);
        const nested = resolveImportedMdxContent(parsed.content, resolvedPath, repoRoot, depth + 1);
        inlinedParts.push(nested);
      } catch {
        // Ignore unreadable import
      }
    }
  }

  if (inlinedParts.length === 0) return rawContent;
  return `${rawContent}\n\n${inlinedParts.join('\n\n')}`;
}

function cleanMdxMarkup(raw: string): string {
  const hasYoutubeLink = /youtube\.com\/watch|youtu\.be\//i.test(raw);

  const cleaned = raw
    .replace(/^import\s+.*$/gm, '')
    .replace(/^export\s+.*$/gm, '')
    // Extract alt text from images if present
    .replace(/<img[^>]*alt=["']([^"']+)["'][^>]*\/?>/gi, '[Image: $1]')
    // Strip remaining JSX/HTML tags while preserving inner text
    .replace(/<\/?[A-Za-z][^>]*>/g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const words = cleaned.split(/\s+/).filter(Boolean).length;
  if (hasYoutubeLink && words < 25) {
    return `${cleaned}\n[NOTE: This documentation page only links to a YouTube video and contains no written text steps.]`.trim();
  }
  return cleaned;
}

function detectProducts(textAndPath: string): string[] {
  const found: string[] = [];
  for (const hint of PRODUCT_HINTS) {
    if (hint.pattern.test(textAndPath)) {
      found.push(hint.label);
    }
  }
  return found.length > 0 ? found : ['General / Multiple PTZOptics Gear'];
}

export function indexDocusaurusRepo(repoPath: string): DocChunk[] {
  if (!repoPath || !fs.existsSync(repoPath)) {
    return [];
  }

  const docsDir = fs.existsSync(path.join(repoPath, 'docs'))
    ? path.join(repoPath, 'docs')
    : repoPath;

  const repoRoot = fs.existsSync(path.join(repoPath, 'docs'))
    ? repoPath
    : path.dirname(repoPath);

  const files = walkMarkdownFiles(docsDir);
  const chunks: DocChunk[] = [];

  for (const filePath of files) {
    // Skip pure component partials folder when indexing top-level articles because we inline them into parent pages,
    // EXCEPT when a component partial has substantive standalone content not imported elsewhere.
    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/');
    if (relPath.includes('/components/')) {
      continue;
    }

    let rawFile = '';
    try {
      rawFile = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const fileHash = crypto.createHash('sha1').update(rawFile).digest('hex');
    let parsed: matter.GrayMatterFile<string>;
    try {
      parsed = matter(rawFile);
    } catch {
      parsed = { content: rawFile, data: {}, orig: rawFile, language: '', matter: '', stringify: () => '' };
    }

    const expandedContent = resolveImportedMdxContent(parsed.content, filePath, repoRoot);
    const cleanedContent = cleanMdxMarkup(expandedContent);
    if (!cleanedContent || cleanedContent.length < 15) continue;

    const frontmatterTitle =
      typeof parsed.data?.title === 'string' && parsed.data.title.trim()
        ? parsed.data.title.trim()
        : null;

    const firstHeadingMatch = cleanedContent.match(/^#\s+(.+)$/m);
    const pageTitle =
      frontmatterTitle ||
      (firstHeadingMatch ? firstHeadingMatch[1].trim() : path.basename(filePath, path.extname(filePath)));

    const urlSlug =
      '/' +
      relPath
        .replace(/^docs\//, '')
        .replace(/\.(md|mdx)$/i, '')
        .replace(/\/index$/i, '');

    const products = detectProducts(`${relPath} ${pageTitle} ${cleanedContent.slice(0, 600)}`);

    // Split by ## H2 sections if the document is large, otherwise keep as a single comprehensive chunk
    const sections = cleanedContent.split(/(?=^##\s+)/m);
    if (sections.length <= 1 || cleanedContent.length <= 1800) {
      const words = cleanedContent.split(/\s+/).filter(Boolean).length;
      chunks.push({
        id: `${relPath}#main`,
        filePath,
        relativePath: relPath,
        title: pageTitle,
        sectionHeading: pageTitle,
        urlSlug,
        products,
        content: cleanedContent.slice(0, 3000),
        wordCount: words,
        fileHash,
      });
    } else {
      sections.forEach((sec, idx) => {
        const trimmed = sec.trim();
        if (trimmed.length < 20) return;
        const h2Match = trimmed.match(/^##\s+(.+)$/m);
        const sectionHeading = h2Match ? h2Match[1].trim() : pageTitle;
        const words = trimmed.split(/\s+/).filter(Boolean).length;
        chunks.push({
          id: `${relPath}#sec-${idx}`,
          filePath,
          relativePath: relPath,
          title: pageTitle,
          sectionHeading,
          urlSlug,
          products,
          content: trimmed.slice(0, 2200),
          wordCount: words,
          fileHash,
        });
      });
    }
  }

  return chunks;
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'not', 'are', 'was',
  'but', 'can', 'How', 'how', 'what', 'when', 'where', 'why', 'who', 'camera', 'ptzoptics',
  'does', 'into', 'our', 'your', 'they', 'their', 'has', 'been', 'will', 'would', 'could'
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9.|_-]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

export function searchDocChunks(
  chunks: DocChunk[],
  query: {
    product?: string;
    category?: string;
    customerQuestion: string;
    rawTicketText?: string;
  },
  topK = 4
): DocChunk[] {
  if (chunks.length === 0) return [];

  const queryString = [
    query.product || '',
    query.category || '',
    query.customerQuestion || '',
    (query.rawTicketText || '').slice(0, 400),
  ].join(' ');

  const queryTokens = tokenize(queryString);
  if (queryTokens.length === 0) return chunks.slice(0, topK);

  const uniqueTokens = Array.from(new Set(queryTokens));
  const productLower = (query.product || '').toLowerCase();

  const scored = chunks.map((chunk) => {
    const titleLower = `${chunk.title} ${chunk.sectionHeading}`.toLowerCase();
    const pathLower = chunk.relativePath.toLowerCase();
    const bodyLower = chunk.content.toLowerCase();

    let score = 0;
    for (const token of uniqueTokens) {
      if (titleLower.includes(token)) score += 4.0;
      if (pathLower.includes(token)) score += 3.0;
      if (bodyLower.includes(token)) score += 1.5;
    }

    if (productLower && productLower !== 'general / multiple ptzoptics gear') {
      const shortProd = productLower.split('(')[0].trim();
      if (shortProd && (pathLower.includes(shortProd.replace(/\s+/g, '-')) || titleLower.includes(shortProd))) {
        score += 5.0;
      }
    }

    return { chunk, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored
    .filter((item) => item.score > 0)
    .slice(0, topK)
    .map((item) => item.chunk);
}
