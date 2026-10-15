import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { indexDocusaurusRepo, searchDocChunks } from '../electron/services/docsIndexer';

describe('Docusaurus MDX Indexer & Search', () => {
  it('indexes MDX files, resolves @kbComponents imports, flags video-only stubs, and retrieves matching chunks', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seer-docs-test-'));
    const kbDir = path.join(tmpDir, 'docs', 'knowledge-base', 'joysticks', 'superjoy');
    const compDir = path.join(tmpDir, 'docs', 'knowledge-base', 'components', 'troubleshooting');
    const netDir = path.join(tmpDir, 'docs', 'technical-docs', 'cameras', 'move-4k');

    fs.mkdirSync(kbDir, { recursive: true });
    fs.mkdirSync(compDir, { recursive: true });
    fs.mkdirSync(netDir, { recursive: true });

    // Create a component partial that only has a YouTube link
    fs.writeFileSync(
      path.join(compDir, 'config-failed.mdx'),
      `# Configuration Failed Troubleshooting Guide\n<a href="https://www.youtube.com/watch?v=PFynzNLHSQI"><img src="thumb.jpg" alt="Video" /></a>`
    );

    // Create parent MDX importing via @kbComponents
    fs.writeFileSync(
      path.join(kbDir, 'superjoy-configuration-failed.mdx'),
      `---\ntitle: SuperJoy Configuration Failed\n---\nimport ConfigFailed from '@kbComponents/troubleshooting/config-failed.mdx'\n\n<ConfigFailed />`
    );

    // Create a detailed camera network doc
    fs.writeFileSync(
      path.join(netDir, 'network-setup.mdx'),
      `---\ntitle: Move 4K Network & IP Discovery\n---\n# Move 4K Network Setup\n## Default Static IP Fallback\nBy default, Move 4K uses DHCP and falls back to 192.168.100.88 if no DHCP server responds.`
    );

    const chunks = indexDocusaurusRepo(tmpDir);
    expect(chunks.length).toBe(2);

    const superjoyChunk = chunks.find((c) => c.title.includes('SuperJoy'));
    expect(superjoyChunk).toBeDefined();
    expect(superjoyChunk?.content).toContain('Configuration Failed Troubleshooting Guide');
    expect(superjoyChunk?.content).toContain('only links to a YouTube video');

    const matches = searchDocChunks(chunks, {
      product: 'Move 4K',
      category: 'IP Address Discovery & Subnet Setup',
      customerQuestion: 'Why is my Move 4K camera stuck on IP 192.168.100.88?',
    });

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].title).toBe('Move 4K Network & IP Discovery');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
