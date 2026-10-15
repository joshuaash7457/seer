import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import {
  parseOpenCodeZenModelsPayload,
  resolveOpenCodeZenProtocol,
  stripOpenCodePrefix,
} from '../electron/services/aiProvider';
import { SeerStorage } from '../electron/services/storage';
import { getSamplePTZOpticsTickets, normalizeAndScrubTickets } from '../electron/services/ticketIngestor';
import {
  formatCalibrationFewShotBlock,
  runFullGapAnalysis,
} from '../electron/services/analysisPipeline';
import { TaxonomyAndPromptsConfig } from '../src/types/seer';

describe('OpenCode Zen Provider & Accuracy Calibration Loop (Phase 3)', () => {
  it('routes OpenCode Zen models to the correct protocol endpoints (/responses, /messages, /models, /chat/completions)', () => {
    expect(stripOpenCodePrefix('opencode/gpt-5.5')).toBe('gpt-5.5');
    expect(resolveOpenCodeZenProtocol('opencode/gpt-5.5')).toBe('responses');
    expect(resolveOpenCodeZenProtocol('gpt-5.3-codex')).toBe('responses');
    expect(resolveOpenCodeZenProtocol('claude-sonnet-4-6')).toBe('messages');
    expect(resolveOpenCodeZenProtocol('qwen3.6-plus')).toBe('messages');
    expect(resolveOpenCodeZenProtocol('gemini-3.5-flash')).toBe('gemini');
    expect(resolveOpenCodeZenProtocol('deepseek-v4.1-flash')).toBe('chat_completions');
    expect(resolveOpenCodeZenProtocol('big-pickle')).toBe('chat_completions');

    const catalog = parseOpenCodeZenModelsPayload({
      data: [{ id: 'opencode/gpt-5.5' }, { id: 'claude-sonnet-4-6' }, { id: 'big-pickle' }],
    });
    expect(catalog).toEqual(['gpt-5.5', 'claude-sonnet-4-6', 'big-pickle']);
  });

  it('tracks Spot-Check Trust Score, re-clusters recommendations on override, and feeds CalibrationExamples into future runs', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seer-phase3-test-'));
    const store = new SeerStorage({ dataDir: tmpDir });

    // Default provider should be opencode-zen
    expect(store.getSettings().aiProvider).toBe('opencode-zen');

    const tickets = normalizeAndScrubTickets(getSamplePTZOpticsTickets());
    const taxonomyPath = path.resolve(process.cwd(), 'config', 'taxonomy-and-prompts.json');
    const taxonomy = JSON.parse(fs.readFileSync(taxonomyPath, 'utf-8')) as TaxonomyAndPromptsConfig;

    const firstRun = await runFullGapAnalysis({
      tickets,
      sourceType: 'csv',
      sourceLabel: 'Phase 3 Calibration Batch',
      dateRangeStart: '2020-01-01',
      dateRangeEnd: '2030-12-31',
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

    store.saveRunResult(firstRun.run, firstRun.verdicts, firstRun.recommendations);

    // Spot-check 3 verdicts: Approve 2, Correct 1
    const v1 = firstRun.verdicts[0];
    const v2 = firstRun.verdicts[1];
    const v3 = firstRun.verdicts[4]; // Move SE NDI|HX ticket

    store.submitVerdictAudit({
      verdictId: v1.id,
      auditStatus: 'approved',
    });
    store.submitVerdictAudit({
      verdictId: v2.id,
      auditStatus: 'approved',
    });

    const overrideRes = store.submitVerdictAudit({
      verdictId: v3.id,
      auditStatus: 'corrected',
      correctedVerdict: 'NEEDS_TOOL',
      correctedFixType: 'BUILD_TOOL',
      correctedRecommendedAction: 'Build an NDI|HX Stream & Firewall Diagnostic Tool.',
      humanNote: 'Recurring NDI black screen issue needs a diagnostic utility.',
    });

    // 2 approved out of 3 audited = 67% agreement rate
    expect(overrideRes.metrics.auditedCount).toBe(3);
    expect(overrideRes.metrics.approvedCount).toBe(2);
    expect(overrideRes.metrics.correctedCount).toBe(1);
    expect(overrideRes.metrics.agreementRatePercent).toBe(67);
    expect(overrideRes.calibrationExamples.length).toBe(3);

    // Few-shot block must include the human auditor note
    const fewShotPrompt = formatCalibrationFewShotBlock(overrideRes.calibrationExamples);
    expect(fewShotPrompt).toContain('Recurring NDI black screen issue needs a diagnostic utility.');

    // Run a second analysis with calibrationExamples and verify it learned the override for v3
    const secondRun = await runFullGapAnalysis({
      tickets,
      sourceType: 'csv',
      sourceLabel: 'Phase 3 Second Batch',
      dateRangeStart: '2020-01-01',
      dateRangeEnd: '2030-12-31',
      docsRepoPath: '',
      taxonomy,
      calibrationExamples: overrideRes.calibrationExamples,
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

    const calibratedV3 = secondRun.verdicts.find((v) => v.externalId === v3.externalId);
    expect(calibratedV3?.verdict).toBe('NEEDS_TOOL');
    expect(calibratedV3?.fixType).toBe('BUILD_TOOL');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
