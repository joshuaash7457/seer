import crypto from 'crypto';
import {
  AnalysisProgressEvent,
  AnalysisRunSummary,
  CalibrationExample,
  DocChunk,
  FixType,
  GapRecommendation,
  GapVerdictType,
  ScrubbedTicket,
  TaxonomyAndPromptsConfig,
  TicketAnalysisVerdict,
} from '../../src/types/seer';
import { AIConfig, generateJsonCompletion } from './aiProvider';
import { indexDocusaurusRepo, searchDocChunks } from './docsIndexer';

export function formatCalibrationFewShotBlock(examples: CalibrationExample[]): string {
  if (!examples || examples.length === 0) return '';
  const selected = examples.slice(0, 8);
  const lines = selected.map(
    (ex, idx) =>
      `Example ${idx + 1} (${ex.auditType.toUpperCase()} by Human Auditor):\n` +
      `- Product: ${ex.product} | Category: ${ex.category}\n` +
      `- Customer Question: "${ex.customerQuestion}"\n` +
      `- Matched Doc: ${ex.matchedDocPath || 'None'}\n` +
      `- Verified Verdict: ${ex.verifiedVerdict} (Fix Type: ${ex.verifiedFixType})\n` +
      `- Auditor Note: ${ex.humanNote}`
  );
  return `\n\nHuman-Verified Calibration Examples (Follow these precedents closely):\n${lines.join('\n\n')}`;
}

interface LlmExtractionResult {
  isSelfServiceable: boolean;
  nonSelfServiceReason?: string;
  product: string;
  category: string;
  customerQuestion: string;
  resolutionSummary: string;
}

interface LlmJudgeResult {
  verdict: GapVerdictType;
  fixType: FixType;
  matchedDocPath: string | null;
  matchedDocTitle: string | null;
  confidence: number;
  gapReasoning: string;
  recommendedAction: string;
  suggestedTitleOrSection: string;
}

function mapVerdictToDefaultFixType(verdict: GapVerdictType): FixType {
  switch (verdict) {
    case 'NO_DOC':
      return 'NEW_ARTICLE';
    case 'PARTIAL_COVERAGE':
    case 'COVERED_FOUND_UNHELPFUL':
      return 'EDIT_ARTICLE';
    case 'COVERED_HARD_TO_FIND':
      return 'IMPROVE_FINDABILITY';
    case 'NEEDS_TOOL':
      return 'BUILD_TOOL';
    case 'WELL_COVERED':
    default:
      return 'NONE';
  }
}

/**
 * Deterministic fallback extractor & judge when Ollama/Cloud AI is unreachable
 * or during fast offline verification tests.
 */
function fallbackExtractAndJudge(
  ticket: ScrubbedTicket,
  matchedChunks: DocChunk[],
  taxonomy: TaxonomyAndPromptsConfig
): { extraction: LlmExtractionResult; judge: LlmJudgeResult } {
  const lower = `${ticket.subject} ${ticket.scrubbedBody}`.toLowerCase();

  // 1. Check non-self-service keywords (e.g. RMA / physical repair / billing)
  for (const kw of taxonomy.nonSelfServiceKeywords) {
    if (lower.includes(kw.toLowerCase())) {
      return {
        extraction: {
          isSelfServiceable: false,
          nonSelfServiceReason: `Matched non-self-service hardware/billing workflow ("${kw}")`,
          product: 'General / Multiple PTZOptics Gear',
          category: 'RMA / Hardware Repair / Billing',
          customerQuestion: ticket.subject,
          resolutionSummary: 'Handled via RMA/support fulfillment workflow.',
        },
        judge: {
          verdict: 'WELL_COVERED',
          fixType: 'NONE',
          matchedDocPath: null,
          matchedDocTitle: null,
          confidence: 0.95,
          gapReasoning: 'Ticket is a physical RMA/shipping request rather than a documentation gap.',
          recommendedAction: 'No documentation change needed.',
          suggestedTitleOrSection: '',
        },
      };
    }
  }

  // 2. Detect product
  let product = 'General / Multiple PTZOptics Gear';
  for (const p of taxonomy.products) {
    const shortName = p.split('(')[0].trim().toLowerCase();
    if (shortName && lower.includes(shortName)) {
      product = p;
      break;
    }
  }
  if (lower.includes('superjoy')) product = 'SuperJoy (PT-SUPERJOY-G1)';
  else if (lower.includes('hc-joy-g4')) product = 'HC-JOY-G4 (Serial Joystick)';
  else if (lower.includes('pt-joy-g4') || lower.includes('joy-g4')) product = 'PT-JOY-G4 (4D IP Joystick)';
  else if (lower.includes('move 4k')) product = 'Move 4K';
  else if (lower.includes('move se')) product = 'Move SE';
  else if (lower.includes('pt20x') || lower.includes('pt30x') || lower.includes('pt12x'))
    product = 'PT30X-SDI / PT20X-SDI / PT12X-SDI (Gen 2)';

  // 3. Detect category & craft question/resolution
  let category = 'Other Technical Setup';
  let customerQuestion = ticket.subject;
  let resolutionSummary = 'Resolved by support agent.';

  const topDoc = matchedChunks[0] || null;
  const topDocContent = topDoc ? topDoc.content : '';

  if (lower.includes('configuration failed') && lower.includes('superjoy')) {
    category = 'Joystick Controller Pairing & Mapping';
    customerQuestion =
      'Why does the SuperJoy display "Configuration Failed" when adding or pairing a PTZOptics camera?';
    resolutionSummary =
      'Verify the SuperJoy and camera are on the same IP subnet, confirm DHCP/router readiness, and set control protocol to VISCA over IP (UDP port 1259) or verify ONVIF credentials.';

    // Prefer the dedicated configuration-failed.mdx doc if present in matchedChunks
    const configFailedDoc =
      matchedChunks.find((c) => c.relativePath.endsWith('configuration-failed.mdx')) ||
      matchedChunks.find((c) => c.relativePath.includes('configuration-failed')) ||
      topDoc;

    const joystickErrorsDoc = matchedChunks.find((c) =>
      c.relativePath.includes('common-error-messages/joysticks.mdx')
    );

    const cfContent = configFailedDoc ? configFailedDoc.content : '';
    const cfWords = configFailedDoc ? configFailedDoc.wordCount : 0;
    const isCfVideoStub =
      cfContent.includes('only links to a YouTube video') || cfWords < 35;

    if (!isCfVideoStub && configFailedDoc) {
      // The user has updated configuration-failed.mdx with written steps!
      const mentionsPortOrVisca = /1259|visca|onvif|subnet/i.test(cfContent);
      return {
        extraction: { isSelfServiceable: true, product, category, customerQuestion, resolutionSummary },
        judge: {
          verdict: mentionsPortOrVisca ? 'WELL_COVERED' : 'PARTIAL_COVERAGE',
          fixType: mentionsPortOrVisca ? 'NONE' : 'EDIT_ARTICLE',
          matchedDocPath: configFailedDoc.relativePath,
          matchedDocTitle: configFailedDoc.title,
          confidence: 0.94,
          gapReasoning: mentionsPortOrVisca
            ? `${configFailedDoc.relativePath} (${cfWords} words) now includes written troubleshooting steps covering network/subnet and control configuration.`
            : `${configFailedDoc.relativePath} (${cfWords} words) now has written network/DHCP steps, but does not yet mention VISCA UDP port 1259 or ONVIF password mismatches when adding a camera.`,
          recommendedAction: mentionsPortOrVisca
            ? 'No change needed — written troubleshooting steps are now present.'
            : `Add a note to ${configFailedDoc.relativePath} covering VISCA over IP UDP port 1259 and ONVIF credential checks.`,
          suggestedTitleOrSection:
            'SuperJoy "Configuration Failed" Checklist (Subnet, Port 1259 & ONVIF Credentials)',
        },
      };
    }

    return {
      extraction: { isSelfServiceable: true, product, category, customerQuestion, resolutionSummary },
      judge: {
        verdict: 'COVERED_FOUND_UNHELPFUL',
        fixType: 'EDIT_ARTICLE',
        matchedDocPath:
          configFailedDoc?.relativePath ||
          'docs/knowledge-base/troubleshooting/configuration-failed.mdx',
        matchedDocTitle: configFailedDoc?.title || 'Configuration Failed',
        confidence: 0.94,
        gapReasoning: joystickErrorsDoc
          ? `While ${joystickErrorsDoc.relativePath} includes written steps for "Configuration Failed", the standalone page ${
              configFailedDoc?.relativePath ||
              'docs/knowledge-base/troubleshooting/configuration-failed.mdx'
            } (${cfWords} words) still only embeds a YouTube video thumbnail with no written checklist.`
          : `The standalone page ${
              configFailedDoc?.relativePath ||
              'docs/knowledge-base/troubleshooting/configuration-failed.mdx'
            } (${cfWords} words) only embeds a YouTube video thumbnail with no written troubleshooting steps.`,
        recommendedAction: `Replace the video-only stub in ${
          configFailedDoc?.relativePath ||
          'docs/knowledge-base/troubleshooting/configuration-failed.mdx'
        } with the written checklist (DHCP/router check, subnet match, and VISCA UDP port 1259 / ONVIF credentials).`,
        suggestedTitleOrSection:
          'SuperJoy "Configuration Failed" Checklist (Subnet, Port 1259 & ONVIF Credentials)',
      },
    };
  }

  if (lower.includes('192.168.100.88') || (lower.includes('subnet') && lower.includes('ip'))) {
    category = 'IP Address Discovery & Subnet Setup';
    customerQuestion =
      'How do I access and change a new camera stuck on the fallback IP 192.168.100.88 when my local network is on a different subnet?';
    resolutionSummary =
      'Guided customer to temporarily assign a 192.168.100.x secondary IP or use the IP discovery tool to move the camera onto their local DHCP subnet.';

    return {
      extraction: { isSelfServiceable: true, product, category, customerQuestion, resolutionSummary },
      judge: {
        verdict: 'NEEDS_TOOL',
        fixType: 'BUILD_TOOL',
        matchedDocPath: topDoc?.relativePath || 'docs/technical-docs/software/gen-3-web-ui/network-settings.mdx',
        matchedDocTitle: topDoc?.title || 'Network Settings',
        confidence: 0.92,
        gapReasoning:
          'Customers repeatedly get stuck when a camera falls back to 192.168.100.88 on a 192.168.1.x or 10.x.x.x LAN. Prose instructions on Windows/Mac NIC subnet changes are error-prone for non-IT users.',
        recommendedAction:
          'Build an interactive "192.168.100.88 Subnet Recovery & IP Helper" wizard in docs (where the user types their PC IP and gets exact copy-paste steps or 1-click PTZ Control App discovery instructions).',
        suggestedTitleOrSection: 'Interactive Tool: 192.168.100.88 Cross-Subnet Recovery Wizard',
      },
    };
  }

  if (lower.includes('ndi') && (lower.includes('black') || lower.includes('obs') || lower.includes('studio monitor'))) {
    category = 'NDI / NDI|HX Configuration & Activation';
    customerQuestion =
      'Why does NDI Studio Monitor or OBS show a black screen for my camera after a Gen 3 firmware update?';
    resolutionSummary =
      'Enabled Stream 2 H.264 encoding, toggled NDI off/on in Gen 3 Web UI, rebooted camera, and verified Windows Firewall rules for NDI runtime.';

    return {
      extraction: { isSelfServiceable: true, product, category, customerQuestion, resolutionSummary },
      judge: {
        verdict: 'PARTIAL_COVERAGE',
        fixType: 'EDIT_ARTICLE',
        matchedDocPath: topDoc?.relativePath || 'docs/technical-docs/software/gen-3-web-ui/ndi-settings.mdx',
        matchedDocTitle: topDoc?.title || 'NDI Settings',
        confidence: 0.89,
        gapReasoning:
          'The NDI Settings page describes basic toggles but does not troubleshoot the "NDI discovered but black video feed after firmware update" symptom caused by Stream 2 encoding/multicast state.',
        recommendedAction:
          'Add a "Troubleshooting NDI Black Screen / No Video" section to the Gen 3 NDI Settings and OBS Setup guides.',
        suggestedTitleOrSection: 'Troubleshooting NDI|HX Black Screen After Firmware Update',
      },
    };
  }

  if (lower.includes('1259') || lower.includes('5678') || lower.includes('visca over ip') || lower.includes('companion')) {
    category = 'VISCA over IP / Serial Control & Baud Rate';
    customerQuestion =
      'Which TCP or UDP port (1259 vs 5678) should be used for VISCA over IP control in Bitfocus Companion and OBS?';
    resolutionSummary =
      'Clarified that PTZOptics native VISCA over IP uses UDP port 1259 while Sony-compatible VISCA over IP uses TCP port 5678.';

    return {
      extraction: { isSelfServiceable: true, product, category, customerQuestion, resolutionSummary },
      judge: {
        verdict: 'COVERED_HARD_TO_FIND',
        fixType: 'IMPROVE_FINDABILITY',
        matchedDocPath: topDoc?.relativePath || 'docs/developers/visca-api/network.mdx',
        matchedDocTitle: topDoc?.title || 'VISCA Network Configuration',
        confidence: 0.87,
        gapReasoning:
          'Port numbers are buried in developer VISCA API docs rather than cross-linked in user-facing OBS/Bitfocus Companion/Joystick setup articles.',
        recommendedAction:
          'Add a prominent "Default Control Ports (UDP 1259 / TCP 5678 / HTTP 80)" quick-reference callout box to the top of OBS, Companion, and Joystick setup guides.',
        suggestedTitleOrSection: 'Quick Reference: VISCA over IP Ports (UDP 1259 vs TCP 5678)',
      },
    };
  }

  if (lower.includes('rs-485') || lower.includes('rs-232') || lower.includes('daisy chain') || lower.includes('baud')) {
    category = 'VISCA over IP / Serial Control & Baud Rate';
    customerQuestion =
      'How do I set camera VISCA addresses, baud rate, and RS-485 termination when daisy-chaining multiple cameras to a serial joystick?';
    resolutionSummary =
      'Set unique VISCA addresses (1–7) per camera, 9600 baud rate across all devices, and enable RS-485 termination only on the final camera in the chain.';

    return {
      extraction: { isSelfServiceable: true, product, category, customerQuestion, resolutionSummary },
      judge: {
        verdict: 'NO_DOC',
        fixType: 'NEW_ARTICLE',
        matchedDocPath: topDoc?.relativePath || null,
        matchedDocTitle: topDoc?.title || null,
        confidence: 0.9,
        gapReasoning:
          'No dedicated KB guide walks through multi-camera RS-485 daisy-chaining, termination switch rules, and rotary/OSD VISCA addressing end-to-end.',
        recommendedAction:
          'Create a new Knowledge Base guide with wiring diagram, rotary switch address table, and RS-485 termination rules for HC-JOY-G4 and Gen 2/Gen 3 cameras.',
        suggestedTitleOrSection: 'How to Daisy-Chain Multiple PTZOptics Cameras via RS-485 & RS-232',
      },
    };
  }

  return {
    extraction: {
      isSelfServiceable: true,
      product,
      category,
      customerQuestion,
      resolutionSummary,
    },
    judge: {
      verdict: topDoc ? 'PARTIAL_COVERAGE' : 'NO_DOC',
      fixType: topDoc ? 'EDIT_ARTICLE' : 'NEW_ARTICLE',
      matchedDocPath: topDoc?.relativePath || null,
      matchedDocTitle: topDoc?.title || null,
      confidence: 0.78,
      gapReasoning: topDoc
        ? `Matched "${topDoc.title}" (${topDoc.relativePath}), but the specific troubleshooting scenario from this ticket is not explicitly addressed.`
        : 'No closely matching article was found in the local Docusaurus repository.',
      recommendedAction: topDoc
        ? `Expand ${topDoc.relativePath} with a troubleshooting FAQ entry covering "${ticket.subject}".`
        : `Write a new KB article covering "${ticket.subject}".`,
      suggestedTitleOrSection: ticket.subject,
    },
  };
}

export async function analyzeSingleTicket(
  ticket: ScrubbedTicket,
  runId: string,
  docChunks: DocChunk[],
  taxonomy: TaxonomyAndPromptsConfig,
  aiConfig: AIConfig,
  useLlm: boolean,
  calibrationExamples: CalibrationExample[] = []
): Promise<TicketAnalysisVerdict> {
  let extraction: LlmExtractionResult | null = null;
  let judge: LlmJudgeResult | null = null;

  if (useLlm) {
    try {
      const extractionUserPrompt = `
Allowed Products: ${JSON.stringify(taxonomy.products)}
Allowed Categories: ${JSON.stringify(taxonomy.categories)}
Non-Self-Service Keywords: ${JSON.stringify(taxonomy.nonSelfServiceKeywords)}

Scrubbed Support Ticket (#${ticket.externalId}):
${ticket.scrubbedBody.slice(0, 3500)}

Return JSON with this exact shape:
{
  "isSelfServiceable": boolean,
  "nonSelfServiceReason": string (optional, only if false),
  "product": string (pick closest from Allowed Products),
  "category": string (pick closest from Allowed Categories),
  "customerQuestion": string (1 clear sentence anonymized question the customer is trying to solve),
  "resolutionSummary": string (1-2 sentences explaining how support solved or should solve it)
}`.trim();

      extraction = await generateJsonCompletion<LlmExtractionResult>(
        aiConfig,
        taxonomy.extractionSystemPrompt,
        extractionUserPrompt
      );
    } catch {
      extraction = null;
    }
  }

  const prelimQuery = extraction
    ? {
        product: extraction.product,
        category: extraction.category,
        customerQuestion: extraction.customerQuestion,
        rawTicketText: ticket.scrubbedBody,
      }
    : {
        customerQuestion: ticket.subject,
        rawTicketText: ticket.scrubbedBody,
      };

  const matchedChunks = searchDocChunks(docChunks, prelimQuery, 4);

  if (useLlm && extraction) {
    if (!extraction.isSelfServiceable) {
      judge = {
        verdict: 'WELL_COVERED',
        fixType: 'NONE',
        matchedDocPath: null,
        matchedDocTitle: null,
        confidence: 0.95,
        gapReasoning: extraction.nonSelfServiceReason || 'Non-self-serviceable ticket (RMA/billing/hardware).',
        recommendedAction: 'None',
        suggestedTitleOrSection: '',
      };
    } else {
      try {
        const formattedDocs =
          matchedChunks.length > 0
            ? matchedChunks
                .map(
                  (c, idx) =>
                    `[Doc ${idx + 1}] Path: ${c.relativePath} | Title: ${c.title} (${c.sectionHeading})\nContent:\n${c.content.slice(
                      0,
                      1200
                    )}`
                )
                .join('\n\n---\n\n')
            : 'No matching documentation chunks found in repository.';

        const fewShotSection = formatCalibrationFewShotBlock(calibrationExamples);
        const judgeUserPrompt = `
Ticket Product: ${extraction.product}
Ticket Category: ${extraction.category}
Customer Question: ${extraction.customerQuestion}
Support Resolution: ${extraction.resolutionSummary}

Closest Matching Docusaurus Docs:
${formattedDocs}${fewShotSection}

Return JSON with this exact shape:
{
  "verdict": "NO_DOC" | "PARTIAL_COVERAGE" | "COVERED_FOUND_UNHELPFUL" | "COVERED_HARD_TO_FIND" | "NEEDS_TOOL" | "WELL_COVERED",
  "fixType": "NEW_ARTICLE" | "EDIT_ARTICLE" | "IMPROVE_FINDABILITY" | "BUILD_TOOL" | "NONE",
  "matchedDocPath": string | null (exact Path from the closest doc above, or null if NO_DOC),
  "matchedDocTitle": string | null,
  "confidence": number (0.0 to 1.0),
  "gapReasoning": string (1-2 sentences explaining why our docs failed or succeeded for this customer),
  "recommendedAction": string (specific, actionable change for the docs team),
  "suggestedTitleOrSection": string (proposed article title, section heading, or interactive tool name)
}`.trim();

        judge = await generateJsonCompletion<LlmJudgeResult>(
          aiConfig,
          taxonomy.judgeSystemPrompt,
          judgeUserPrompt
        );
      } catch {
        judge = null;
      }
    }
  }

  if (!extraction || !judge) {
    const fallback = fallbackExtractAndJudge(ticket, matchedChunks, taxonomy);
    extraction = extraction || fallback.extraction;
    judge = judge || fallback.judge;

    // Apply human calibration precedent if a matching ticket or question was previously corrected
    const matchingCal = calibrationExamples.find(
      (c) =>
        c.auditType === 'corrected' &&
        (c.ticketExternalId === ticket.externalId ||
          c.customerQuestion.toLowerCase() === extraction!.customerQuestion.toLowerCase())
    );
    if (matchingCal && judge) {
      judge.verdict = matchingCal.verifiedVerdict;
      judge.fixType = matchingCal.verifiedFixType;
      if (matchingCal.matchedDocPath !== undefined) {
        judge.matchedDocPath = matchingCal.matchedDocPath;
      }
      if (matchingCal.humanNote) {
        judge.gapReasoning = `${judge.gapReasoning} [Calibrated via Spot-Check: ${matchingCal.humanNote}]`;
      }
    }
  }

  const fixType = judge.fixType || mapVerdictToDefaultFixType(judge.verdict);

  return {
    id: `vrd_${runId}_${ticket.externalId}`,
    runId,
    ticketId: ticket.id,
    externalId: ticket.externalId,
    createdAt: ticket.createdAt,
    isSelfServiceable: Boolean(extraction.isSelfServiceable),
    nonSelfServiceReason: extraction.nonSelfServiceReason,
    product: extraction.product || 'General / Multiple PTZOptics Gear',
    category: extraction.category || 'Other Technical Setup',
    customerQuestion: extraction.customerQuestion || ticket.subject,
    resolutionSummary: extraction.resolutionSummary || '',
    verdict: judge.verdict,
    fixType,
    originalVerdict: judge.verdict,
    originalFixType: fixType,
    matchedDocPath: judge.matchedDocPath,
    matchedDocTitle: judge.matchedDocTitle,
    confidence: typeof judge.confidence === 'number' ? judge.confidence : 0.85,
    gapReasoning: judge.gapReasoning || '',
    recommendedAction: judge.recommendedAction || '',
    suggestedTitleOrSection: judge.suggestedTitleOrSection || ticket.subject,
    scrubbedSnippet: ticket.scrubbedBody.slice(0, 600),
    humanAudit: null,
    humanCorrectionNote: null,
    auditedAt: null,
  };
}

export function clusterVerdictsIntoRecommendations(
  runId: string,
  verdicts: TicketAnalysisVerdict[]
): GapRecommendation[] {
  const actionable = verdicts.filter(
    (v) => v.isSelfServiceable && v.verdict !== 'WELL_COVERED' && v.fixType !== 'NONE'
  );

  const groups = new Map<string, TicketAnalysisVerdict[]>();

  for (const v of actionable) {
    const normalizedSuggestion = (v.suggestedTitleOrSection || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const groupKey = normalizedSuggestion
      ? `suggestion:${normalizedSuggestion}:${v.fixType}`
      : v.matchedDocPath && (v.fixType === 'EDIT_ARTICLE' || v.fixType === 'IMPROVE_FINDABILITY')
      ? `doc:${v.matchedDocPath}:${v.fixType}`
      : `topic:${v.category}:${v.fixType}`;

    const existing = groups.get(groupKey) || [];
    existing.push(v);
    groups.set(groupKey, existing);
  }

  const recommendations: GapRecommendation[] = [];

  for (const [key, items] of groups.entries()) {
    const primary = items[0];
    const count = items.length;

    const severityMultiplier =
      primary.verdict === 'NO_DOC'
        ? 1.35
        : primary.verdict === 'NEEDS_TOOL'
        ? 1.3
        : primary.verdict === 'COVERED_FOUND_UNHELPFUL'
        ? 1.25
        : 1.1;

    const avgConfidence =
      items.reduce((acc, item) => acc + (item.confidence || 0.8), 0) / items.length;

    const priorityScore = Math.round(count * 25 * severityMultiplier * avgConfidence);

    const uniqueQuestions = Array.from(new Set(items.map((i) => i.customerQuestion))).slice(0, 5);
    const uniqueResolutions = Array.from(
      new Set(items.map((i) => i.resolutionSummary).filter(Boolean))
    ).slice(0, 5);
    const recId = `rec_${crypto.createHash('md5').update(`${runId}-${key}`).digest('hex').slice(0, 8)}`;

    const title = primary.suggestedTitleOrSection || `${primary.product}: ${primary.category}`;
    const draftMdxOutline =
      primary.fixType === 'BUILD_TOOL'
        ? [
            `{/* Interactive Tool Spec for ${primary.matchedDocPath || 'docs/knowledge-base/tools/'} */}`,
            `## ${title}`,
            ``,
            `**Problem Solved:** ${primary.gapReasoning}`,
            ``,
            `### Interactive Inputs`,
            `- User's Current PC IPv4 Address & Subnet Mask`,
            `- Target ${primary.product} Fallback/Current IP (e.g., \`192.168.100.88\`)`,
            ``,
            `### Automated Output Steps`,
            ...uniqueResolutions.map((r, idx) => `${idx + 1}. ${r}`),
          ].join('\n')
        : [
            `---`,
            `title: "${title.replace(/"/g, '\\"')}"`,
            `---`,
            ``,
            `## ${title}`,
            ``,
            `:::tip Quick Summary`,
            `${primary.recommendedAction}`,
            `:::`,
            ``,
            `### Common Symptoms`,
            ...uniqueQuestions.map((q) => `- "${q}"`),
            ``,
            `### Step-by-Step Resolution`,
            ...uniqueResolutions.map((r, idx) => `${idx + 1}. ${r}`),
          ].join('\n');

    recommendations.push({
      id: recId,
      runId,
      title,
      product: primary.product,
      category: primary.category,
      verdict: primary.verdict,
      fixType: primary.fixType,
      ticketCount: count,
      priorityScore,
      targetDocPath: primary.matchedDocPath,
      targetDocTitle: primary.matchedDocTitle,
      whyDocsFailed: primary.gapReasoning,
      concreteAction: primary.recommendedAction,
      exampleQuestions: uniqueQuestions,
      resolutionSummaries: uniqueResolutions,
      draftMdxOutline,
      ticketIds: items.map((i) => i.externalId),
    });
  }

  recommendations.sort((a, b) => b.priorityScore - a.priorityScore || b.ticketCount - a.ticketCount);
  return recommendations;
}

export async function runFullGapAnalysis(options: {
  tickets: ScrubbedTicket[];
  sourceType: 'csv' | 'hubspot';
  sourceLabel: string;
  dateRangeStart: string;
  dateRangeEnd: string;
  docsRepoPath: string;
  taxonomy: TaxonomyAndPromptsConfig;
  aiConfig: AIConfig;
  calibrationExamples?: CalibrationExample[];
  useLlm?: boolean;
  onProgress?: (event: AnalysisProgressEvent) => void;
}): Promise<{
  run: AnalysisRunSummary;
  verdicts: TicketAnalysisVerdict[];
  recommendations: GapRecommendation[];
  indexedDocCount: number;
}> {
  const runId = `run_${Date.now()}`;
  const startedAt = new Date().toISOString();
  const emit = (
    stage: AnalysisProgressEvent['stage'],
    current: number,
    total: number,
    message: string
  ) => {
    options.onProgress?.({ runId, stage, current, total, message });
  };

  emit('indexing_docs', 0, 1, `Indexing Docusaurus MDX files in ${options.docsRepoPath || 'local repo'}...`);
  const docChunks = indexDocusaurusRepo(options.docsRepoPath);
  emit('indexing_docs', 1, 1, `Indexed ${docChunks.length} documentation sections.`);

  // Check if AI provider is reachable so we don't stall on every ticket if offline
  let llmAvailable = options.useLlm !== false;
  if (llmAvailable && options.aiConfig.provider === 'ollama') {
    try {
      const cleanUrl = (options.aiConfig.ollamaBaseUrl || 'http://localhost:11434').replace(/\/+$/, '');
      const ping = await fetch(`${cleanUrl}/api/tags`, { signal: AbortSignal.timeout(2500) });
      if (!ping.ok) llmAvailable = false;
    } catch {
      llmAvailable = false;
    }
  } else if (llmAvailable && options.aiConfig.provider === 'opencode-zen') {
    const zenModel = (options.aiConfig.openCodeZenModel || options.aiConfig.cloudModel || '').toLowerCase();
    const isFreeZenModel = zenModel.endsWith('-free') || zenModel === 'big-pickle';
    const hasZenKey = Boolean(options.aiConfig.cloudApiKey || process.env.OPENCODE_API_KEY);
    if (!hasZenKey && !isFreeZenModel) {
      llmAvailable = false;
    }
  } else if (llmAvailable && !options.aiConfig.cloudApiKey) {
    llmAvailable = false;
  }

  const verdicts: TicketAnalysisVerdict[] = [];
  const total = options.tickets.length;

  for (let i = 0; i < total; i++) {
    const ticket = options.tickets[i];
    emit(
      'analyzing_tickets',
      i + 1,
      total,
      `Analyzing ticket ${i + 1}/${total} (#${ticket.externalId})...`
    );
    const verdict = await analyzeSingleTicket(
      ticket,
      runId,
      docChunks,
      options.taxonomy,
      options.aiConfig,
      llmAvailable,
      options.calibrationExamples || []
    );
    verdicts.push(verdict);
  }

  emit('clustering', 1, 1, 'Clustering verdicts into prioritized KB recommendations...');
  const recommendations = clusterVerdictsIntoRecommendations(runId, verdicts);

  const selfServiceableTickets = verdicts.filter((v) => v.isSelfServiceable).length;
  const gapTicketsCount = verdicts.filter(
    (v) => v.isSelfServiceable && v.verdict !== 'WELL_COVERED'
  ).length;

  const activeModelName =
    options.aiConfig.provider === 'ollama'
      ? options.aiConfig.ollamaModel
      : options.aiConfig.provider === 'opencode-zen'
      ? options.aiConfig.openCodeZenModel || options.aiConfig.cloudModel || 'gpt-5.5'
      : options.aiConfig.cloudModel;

  const modelLabel = `${activeModelName}${llmAvailable ? '' : ' (Local Heuristic Fallback)'}`;

  const run: AnalysisRunSummary = {
    id: runId,
    startedAt,
    completedAt: new Date().toISOString(),
    sourceType: options.sourceType,
    sourceLabel: options.sourceLabel,
    dateRangeStart: options.dateRangeStart,
    dateRangeEnd: options.dateRangeEnd,
    totalTickets: total,
    selfServiceableTickets,
    gapTicketsCount,
    aiProvider: options.aiConfig.provider,
    aiModel: modelLabel,
    status: 'completed',
  };

  emit('completed', total, total, `Completed analysis: ${recommendations.length} recommendations generated.`);

  return {
    run,
    verdicts,
    recommendations,
    indexedDocCount: docChunks.length,
  };
}
