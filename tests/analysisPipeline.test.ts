import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import { getSamplePTZOpticsTickets, normalizeAndScrubTickets } from '../electron/services/ticketIngestor';
import { runFullGapAnalysis } from '../electron/services/analysisPipeline';
import { TaxonomyAndPromptsConfig } from '../src/types/seer';

describe('End-to-End Gap Analysis Pipeline', () => {
  it('scrubs PII from tickets, indexes Docusaurus docs, identifies non-self-service RMAs, and produces prioritized gap recommendations', async () => {
    const rawSamples = getSamplePTZOpticsTickets();
    const scrubbedTickets = normalizeAndScrubTickets(rawSamples);

    expect(scrubbedTickets.length).toBe(8);

    // Verify zero PII survived into any scrubbed ticket body
    const allScrubbedText = scrubbedTickets.map((t) => `${t.subject}\n${t.scrubbedBody}`).join('\n');
    expect(allScrubbedText).not.toContain('dmiller@calvarychapelav.org');
    expect(allScrubbedText).not.toContain('Pastor David Miller');
    expect(allScrubbedText).not.toContain('Rachel Green');
    expect(allScrubbedText).not.toContain('SJG1998271');
    expect(allScrubbedText).not.toContain('484-555-0142');

    // Load default taxonomy config
    const taxonomyPath = path.resolve(process.cwd(), 'config', 'taxonomy-and-prompts.json');
    const taxonomy = JSON.parse(fs.readFileSync(taxonomyPath, 'utf-8')) as TaxonomyAndPromptsConfig;

    // Point to local online-docs if available, otherwise empty
    const localOnlineDocs = 'C:\\Users\\JoshuaAsh\\online-docs';
    const docsRepoPath = fs.existsSync(localOnlineDocs) ? localOnlineDocs : '';

    const result = await runFullGapAnalysis({
      tickets: scrubbedTickets,
      sourceType: 'csv',
      sourceLabel: 'Sample PTZOptics Support Batch',
      dateRangeStart: '2020-01-01',
      dateRangeEnd: '2030-12-31',
      docsRepoPath,
      taxonomy,
      aiConfig: {
        provider: 'ollama',
        ollamaBaseUrl: 'http://localhost:11434',
        ollamaModel: 'llama3.1:8b',
        cloudModel: 'gpt-4o-mini',
      },
      useLlm: false,
    });

    expect(result.run.totalTickets).toBe(8);
    // 7 technical tickets + 1 RMA ticket
    expect(result.run.selfServiceableTickets).toBe(7);
    expect(result.recommendations.length).toBeGreaterThanOrEqual(4);

    // Top recommendations should include the 2-ticket clusters (SuperJoy Configuration Failed & 192.168.100.88 Subnet Tool)
    const topRec = result.recommendations[0];
    expect(topRec.ticketCount).toBe(2);
    expect(['EDIT_ARTICLE', 'BUILD_TOOL']).toContain(topRec.fixType);
  });
});
