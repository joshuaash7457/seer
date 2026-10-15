import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { SeerStorage } from '../electron/services/storage';
import { getSamplePTZOpticsTickets, normalizeAndScrubTickets } from '../electron/services/ticketIngestor';
import { runFullGapAnalysis } from '../electron/services/analysisPipeline';
import { TaxonomyAndPromptsConfig } from '../src/types/seer';

describe('Trends Over Time, Shipped Doc Impact & Leadership Report Export (Phase 4)', () => {
  it('computes rising/falling trend deltas, tracks shipped doc ticket reduction, and exports zero-PII HTML/Markdown reports', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seer-phase4-test-'));
    const store = new SeerStorage({ dataDir: tmpDir });

    const tickets = normalizeAndScrubTickets(getSamplePTZOpticsTickets());
    const taxonomyPath = path.resolve(process.cwd(), 'config', 'taxonomy-and-prompts.json');
    const taxonomy = JSON.parse(fs.readFileSync(taxonomyPath, 'utf-8')) as TaxonomyAndPromptsConfig;

    const currentAnalysis = await runFullGapAnalysis({
      tickets,
      sourceType: 'csv',
      sourceLabel: 'Current Week Support Batch',
      dateRangeStart: '2026-10-08',
      dateRangeEnd: '2026-10-15',
      docsRepoPath: '',
      taxonomy,
      aiConfig: {
        provider: 'opencode-zen',
        ollamaBaseUrl: 'http://localhost:11434',
        ollamaModel: 'llama3.1:8b',
        openCodeZenBaseUrl: 'https://opencode.ai/zen/v1',
        openCodeZenModel: 'gpt-5.5',
        cloudModel: 'gpt-5.5',
      },
      useLlm: false,
    });

    store.saveRunResult(
      currentAnalysis.run,
      currentAnalysis.verdicts,
      currentAnalysis.recommendations
    );

    // Seed prior week baseline & shipped PoE+ fix
    const seeded = store.seedPreviousWeekBaselineRun();
    expect(seeded.shippedFixes.length).toBeGreaterThanOrEqual(1);

    // Also mark one of the current recommendations as shipped
    const topRec = currentAnalysis.recommendations[0];
    const updatedShipped = store.markRecommendationShipped(
      topRec.id,
      'Published updated checklist to docs.ptzoptics.com'
    );
    expect(updatedShipped.length).toBe(2);

    const { trends, report } = store.getTrendsAndReport(
      currentAnalysis.run.id,
      seeded.baselineRunId
    );

    expect(trends.currentRun?.id).toBe(currentAnalysis.run.id);
    expect(trends.previousRun?.id).toBe(seeded.baselineRunId);

    // Check that SuperJoy rose from 1 -> 2 ('rising') and 192.168.100.88 fell from 4 -> 2 ('falling')
    const risingRec = trends.recommendationDeltas.find(
      (d) => d.trendDirection === 'rising'
    );
    const fallingRec = trends.recommendationDeltas.find(
      (d) => d.trendDirection === 'falling'
    );
    expect(risingRec).toBeDefined();
    expect(risingRec?.deltaTicketCount).toBe(1);
    expect(fallingRec).toBeDefined();
    expect(fallingRec?.deltaTicketCount).toBe(-2);

    // Check that the shipped PoE+ doc shows 'resolved' (dropped from 3 baseline tickets -> 0 current tickets)
    const poeImpact = trends.shippedFixImpacts.find((imp) =>
      imp.shippedFix.title.includes('PoE+')
    );
    expect(poeImpact).toBeDefined();
    expect(poeImpact?.status).toBe('resolved');
    expect(poeImpact?.currentTicketCount).toBe(0);
    expect(poeImpact?.percentChange).toBe(-100);

    // Verify Markdown & HTML Leadership Reports
    expect(report).not.toBeNull();
    expect(report?.markdown).toContain('# Seer — PTZOptics Support-Driven Knowledge Base Gap Report');
    expect(report?.markdown).toContain('Impact of Previously Shipped Docs & Tools');
    expect(report?.html).toContain('<!DOCTYPE html>');
    expect(report?.html).toContain('Zero-PII Verified');

    // Verify zero customer PII appears in either report
    expect(report?.markdown).not.toContain('dmiller@calvarychapelav.org');
    expect(report?.html).not.toContain('dmiller@calvarychapelav.org');
    expect(report?.markdown).not.toContain('Pastor David Miller');
    expect(report?.html).not.toContain('Pastor David Miller');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
