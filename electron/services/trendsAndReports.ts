import {
  AccuracyMetrics,
  AnalysisRunSummary,
  GapRecommendation,
  LeadershipReportBundle,
  RecommendationTrendDelta,
  ShippedFixImpact,
  ShippedFixRecord,
  TrendsComparisonResult,
} from '../../src/types/seer';
import { scrubPII } from './piiScrubber';

function normalizeTopicKey(rec: {
  title: string;
  targetDocPath?: string | null;
  product: string;
  category: string;
}): string {
  if (rec.targetDocPath) {
    return `doc:${rec.targetDocPath.toLowerCase().trim()}`;
  }
  const cleanTitle = (rec.title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  if (cleanTitle) return `title:${cleanTitle}`;
  return `cat:${rec.product.toLowerCase()}:${rec.category.toLowerCase()}`;
}

export function computeTrendsComparison(params: {
  currentRun: AnalysisRunSummary | null;
  currentRecommendations: GapRecommendation[];
  previousRun: AnalysisRunSummary | null;
  previousRecommendations: GapRecommendation[];
  shippedFixes: ShippedFixRecord[];
}): TrendsComparisonResult {
  const {
    currentRun,
    currentRecommendations,
    previousRun,
    previousRecommendations,
    shippedFixes,
  } = params;

  const prevMap = new Map<string, GapRecommendation>();
  for (const prev of previousRecommendations) {
    prevMap.set(normalizeTopicKey(prev), prev);
  }

  const matchedPrevKeys = new Set<string>();
  const recommendationDeltas: RecommendationTrendDelta[] = [];

  for (const curr of currentRecommendations) {
    const key = normalizeTopicKey(curr);
    // Also fallback to category + product match if exact doc/title didn't match
    let matchedPrev = prevMap.get(key);
    if (!matchedPrev) {
      matchedPrev = previousRecommendations.find(
        (p) => p.category === curr.category && p.fixType === curr.fixType
      );
    }

    if (!previousRun) {
      recommendationDeltas.push({
        recommendationId: curr.id,
        title: curr.title,
        product: curr.product,
        category: curr.category,
        fixType: curr.fixType,
        targetDocPath: curr.targetDocPath,
        currentTicketCount: curr.ticketCount,
        previousTicketCount: 0,
        deltaTicketCount: curr.ticketCount,
        trendDirection: 'new',
      });
      continue;
    }

    if (!matchedPrev) {
      recommendationDeltas.push({
        recommendationId: curr.id,
        title: curr.title,
        product: curr.product,
        category: curr.category,
        fixType: curr.fixType,
        targetDocPath: curr.targetDocPath,
        currentTicketCount: curr.ticketCount,
        previousTicketCount: 0,
        deltaTicketCount: curr.ticketCount,
        trendDirection: 'new',
      });
    } else {
      matchedPrevKeys.add(normalizeTopicKey(matchedPrev));
      const delta = curr.ticketCount - matchedPrev.ticketCount;
      const direction: RecommendationTrendDelta['trendDirection'] =
        delta > 0 ? 'rising' : delta < 0 ? 'falling' : 'stable';

      recommendationDeltas.push({
        recommendationId: curr.id,
        title: curr.title,
        product: curr.product,
        category: curr.category,
        fixType: curr.fixType,
        targetDocPath: curr.targetDocPath,
        currentTicketCount: curr.ticketCount,
        previousTicketCount: matchedPrev.ticketCount,
        deltaTicketCount: delta,
        trendDirection: direction,
      });
    }
  }

  const resolvedClustersFromPreviousRun = previousRecommendations
    .filter((prev) => !matchedPrevKeys.has(normalizeTopicKey(prev)))
    .map((prev) => ({
      title: prev.title,
      product: prev.product,
      category: prev.category,
      previousTicketCount: prev.ticketCount,
    }));

  const shippedFixImpacts: ShippedFixImpact[] = shippedFixes.map((shipped) => {
    const key = normalizeTopicKey(shipped);
    const matchingCurr = currentRecommendations.find(
      (c) =>
        normalizeTopicKey(c) === key ||
        (shipped.targetDocPath && c.targetDocPath === shipped.targetDocPath) ||
        (c.category === shipped.category && c.product === shipped.product)
    );

    const currentTicketCount = matchingCurr ? matchingCurr.ticketCount : 0;
    const deltaFromBaseline = currentTicketCount - shipped.baselineTicketCount;
    const percentChange =
      shipped.baselineTicketCount > 0
        ? Math.round((deltaFromBaseline / shipped.baselineTicketCount) * 100)
        : 0;

    let status: ShippedFixImpact['status'] = 'unchanged';
    if (currentTicketCount === 0) status = 'resolved';
    else if (deltaFromBaseline < 0) status = 'improved';
    else if (deltaFromBaseline > 0) status = 'regressed';

    return {
      shippedFix: shipped,
      currentTicketCount,
      deltaFromBaseline,
      percentChange,
      status,
    };
  });

  return {
    currentRun,
    previousRun,
    recommendationDeltas,
    resolvedClustersFromPreviousRun,
    shippedFixImpacts,
  };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function generateLeadershipReport(params: {
  run: AnalysisRunSummary;
  recommendations: GapRecommendation[];
  trends: TrendsComparisonResult;
  accuracy: AccuracyMetrics;
}): LeadershipReportBundle {
  const { run, recommendations, trends, accuracy } = params;
  const generatedAt = new Date().toISOString();
  const dateStr = new Date(generatedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const deltaMap = new Map<string, RecommendationTrendDelta>();
  for (const d of trends.recommendationDeltas) {
    deltaMap.set(d.recommendationId, d);
  }

  // 1. Build Markdown Report
  const mdLines: string[] = [
    `# Seer — PTZOptics Support-Driven Knowledge Base Gap Report`,
    `**Generated:** ${dateStr} | **Analysis Window:** ${run.dateRangeStart} to ${run.dateRangeEnd} | **Source:** ${run.sourceLabel}`,
    ``,
    `> *"Where are customers contacting support because our self-service resources didn't help them, and what should we build or fix to change that?"*`,
    ``,
    `## 1. Executive Summary`,
    `- **Total Support Tickets Analyzed (PII Scrubbed):** ${run.totalTickets}`,
    `- **Self-Serviceable Technical Issues:** ${run.selfServiceableTickets} (${
      run.totalTickets - run.selfServiceableTickets
    } non-doc RMA/billing tickets filtered out)`,
    `- **Prioritized Documentation & Tool Recommendations:** ${recommendations.length} (covering ${run.gapTicketsCount} tickets)`,
    `- **Spot-Check Verdict Accuracy Score:** ${
      accuracy.agreementRatePercent !== null
        ? `${accuracy.agreementRatePercent}% agreement (${accuracy.approvedCount}/${accuracy.auditedCount} spot-checked verdicts approved)`
        : `Pending spot-check audit (${accuracy.calibrationExamplesCount} calibration rules active)`
    }`,
    ``,
  ];

  if (trends.shippedFixImpacts.length > 0) {
    mdLines.push(`## 2. Impact of Previously Shipped Docs & Tools`);
    mdLines.push(
      `| Shipped Fix / Article | Product | Baseline Tickets | Current Tickets | Impact |`
    );
    mdLines.push(`| :--- | :--- | :---: | :---: | :--- |`);
    for (const imp of trends.shippedFixImpacts) {
      const badge =
        imp.status === 'resolved'
          ? '✅ 100% Resolved (0 tickets)'
          : imp.status === 'improved'
          ? `📉 Reduced (${imp.deltaFromBaseline} tickets, ${imp.percentChange}%)`
          : imp.status === 'regressed'
          ? `⚠️ Increased (+${imp.deltaFromBaseline} tickets)`
          : '➖ Unchanged';
      mdLines.push(
        `| **${imp.shippedFix.title}** (${imp.shippedFix.targetDocPath || 'New'}) | ${
          imp.shippedFix.product
        } | ${imp.shippedFix.baselineTicketCount} | ${imp.currentTicketCount} | ${badge} |`
      );
    }
    mdLines.push(``);
  }

  mdLines.push(`## 3. Prioritized Self-Service Recommendations`);
  recommendations.forEach((rec, idx) => {
    const delta = deltaMap.get(rec.id);
    const trendTag = delta
      ? delta.trendDirection === 'rising'
        ? `📈 Rising (+${delta.deltaTicketCount} vs prior run)`
        : delta.trendDirection === 'falling'
        ? `📉 Falling (${delta.deltaTicketCount} vs prior run)`
        : delta.trendDirection === 'new'
        ? `🆕 New Cluster`
        : `➖ Stable`
      : '';

    mdLines.push(`### #${idx + 1}. ${rec.title}`);
    mdLines.push(
      `- **Fix Type:** \`${rec.fixType}\` | **Gap Verdict:** \`${rec.verdict}\` | **Product:** ${rec.product}`
    );
    mdLines.push(
      `- **Support Volume:** **${rec.ticketCount}** ${
        rec.ticketCount === 1 ? 'ticket' : 'tickets'
      } (${rec.ticketIds.join(', ')}) ${trendTag ? `— ${trendTag}` : ''}`
    );
    if (rec.targetDocPath) {
      mdLines.push(`- **Target Docusaurus File:** \`${rec.targetDocPath}\``);
    }
    mdLines.push(`- **Why Self-Service Failed:** ${rec.whyDocsFailed}`);
    mdLines.push(`- **Recommended Action:** ${rec.concreteAction}`);
    mdLines.push(`- **Anonymized Customer Questions:**`);
    rec.exampleQuestions.forEach((q) => {
      mdLines.push(`  - *"${q}"*`);
    });
    mdLines.push(``);
  });

  if (trends.resolvedClustersFromPreviousRun.length > 0) {
    mdLines.push(`## 4. Issues From Prior Run With Zero Tickets This Run`);
    for (const res of trends.resolvedClustersFromPreviousRun) {
      mdLines.push(
        `- **${res.title}** (${res.product}) — dropped from ${res.previousTicketCount} tickets to **0 tickets** this run.`
      );
    }
    mdLines.push(``);
  }

  const rawMarkdown = mdLines.join('\n');
  const scrubbedMd = scrubPII(rawMarkdown);

  // 2. Build Standalone HTML Report
  const recCardsHtml = recommendations
    .map((rec, idx) => {
      const delta = deltaMap.get(rec.id);
      const trendHtml = delta
        ? delta.trendDirection === 'rising'
          ? `<span class="badge badge-rising">▲ +${delta.deltaTicketCount} vs prior run</span>`
          : delta.trendDirection === 'falling'
          ? `<span class="badge badge-falling">▼ ${delta.deltaTicketCount} vs prior run</span>`
          : delta.trendDirection === 'new'
          ? `<span class="badge badge-new">NEW CLUSTER</span>`
          : `<span class="badge badge-neutral">Stable</span>`
        : '';

      return `
      <div class="card">
        <div class="card-header">
          <div>
            <div class="badges">
              <span class="badge badge-rank">#${idx + 1} Priority</span>
              <span class="badge badge-fix">${escapeHtml(rec.fixType)}</span>
              <span class="badge badge-verdict">${escapeHtml(rec.verdict)}</span>
              <span class="badge badge-product">${escapeHtml(rec.product)}</span>
              ${trendHtml}
            </div>
            <h3>${escapeHtml(rec.title)}</h3>
          </div>
          <div class="volume-box">
            <div class="volume-num">${rec.ticketCount} ${
        rec.ticketCount === 1 ? 'Ticket' : 'Tickets'
      }</div>
            <div class="volume-sub">Impact Score: ${rec.priorityScore}</div>
          </div>
        </div>
        <div class="grid-2">
          <div class="panel panel-gap">
            <div class="panel-label">WHY SELF-SERVICE FAILED</div>
            <p>${escapeHtml(rec.whyDocsFailed)}</p>
            ${
              rec.targetDocPath
                ? `<div class="doc-path">Target File: <code>${escapeHtml(
                    rec.targetDocPath
                  )}</code></div>`
                : ''
            }
          </div>
          <div class="panel panel-action">
            <div class="panel-label">RECOMMENDED ACTION</div>
            <p>${escapeHtml(rec.concreteAction)}</p>
          </div>
        </div>
        <div class="questions">
          <div class="questions-label">Anonymized Customer Questions (${escapeHtml(
            rec.ticketIds.join(', ')
          )}):</div>
          <ul>
            ${rec.exampleQuestions.map((q) => `<li>"${escapeHtml(q)}"</li>`).join('')}
          </ul>
        </div>
      </div>`;
    })
    .join('\n');

  const shippedTableHtml =
    trends.shippedFixImpacts.length > 0
      ? `
      <h2>Impact of Shipped Documentation & Tools</h2>
      <table>
        <thead>
          <tr>
            <th>Shipped Fix / Article</th>
            <th>Product</th>
            <th>Baseline Tickets</th>
            <th>Current Tickets</th>
            <th>Measured Outcome</th>
          </tr>
        </thead>
        <tbody>
          ${trends.shippedFixImpacts
            .map(
              (imp) => `
            <tr>
              <td><strong>${escapeHtml(imp.shippedFix.title)}</strong><br/><small>${escapeHtml(
                imp.shippedFix.targetDocPath || 'New Resource'
              )}</small></td>
              <td>${escapeHtml(imp.shippedFix.product)}</td>
              <td>${imp.shippedFix.baselineTicketCount}</td>
              <td><strong>${imp.currentTicketCount}</strong></td>
              <td>${
                imp.status === 'resolved'
                  ? '✅ 100% Resolved (0 tickets)'
                  : imp.status === 'improved'
                  ? `📉 Reduced (${imp.deltaFromBaseline} tickets / ${imp.percentChange}%)`
                  : imp.status === 'regressed'
                  ? `⚠️ Increased (+${imp.deltaFromBaseline} tickets)`
                  : '➖ Unchanged'
              }</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>`
      : '';

  const rawHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Seer — PTZOptics Support Knowledge Gap Report (${escapeHtml(dateStr)})</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b1120; color: #f1f5f9; margin: 0; padding: 36px; line-height: 1.5; }
    .container { max-width: 1060px; margin: 0 auto; }
    header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #1e293b; padding-bottom: 20px; margin-bottom: 24px; }
    .brand { display: flex; align-items: center; gap: 16px; }
    h1 { margin: 0; font-size: 24px; color: #ffffff; }
    h2 { font-size: 18px; color: #e2e8f0; margin-top: 28px; margin-bottom: 12px; border-bottom: 1px solid #1e293b; padding-bottom: 6px; }
    h3 { margin: 6px 0 0 0; font-size: 17px; color: #ffffff; }
    .subtitle { color: #94a3b8; font-size: 13px; margin-top: 4px; }
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 24px; }
    .kpi { background: #111827; border: 1px solid #1f2937; border-radius: 12px; padding: 16px; }
    .kpi-label { font-size: 12px; color: #94a3b8; }
    .kpi-val { font-size: 26px; font-weight: 700; color: #38bdf8; margin-top: 4px; }
    .card { background: #111827; border: 1px solid #1f2937; border-radius: 12px; padding: 20px; margin-bottom: 16px; }
    .card-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 14px; }
    .badges { display: flex; flex-wrap: wrap; gap: 6px; }
    .badge { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: #1e293b; color: #cbd5e1; }
    .badge-fix { background: rgba(16, 185, 129, 0.15); color: #6ee7b7; border: 1px solid rgba(16, 185, 129, 0.3); }
    .badge-product { background: rgba(56, 189, 248, 0.15); color: #7dd3fc; }
    .badge-rising { background: rgba(244, 63, 94, 0.2); color: #fda4af; }
    .badge-falling { background: rgba(16, 185, 129, 0.2); color: #6ee7b7; }
    .badge-new { background: rgba(168, 85, 247, 0.2); color: #d8b4fe; }
    .volume-box { text-align: right; background: #030712; border: 1px solid #1f2937; padding: 8px 14px; border-radius: 8px; min-width: 110px; }
    .volume-num { font-size: 15px; font-weight: 700; color: #ffffff; }
    .volume-sub { font-size: 11px; color: #38bdf8; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 12px; }
    .panel { background: #030712; border: 1px solid #1f2937; border-radius: 8px; padding: 12px; font-size: 13px; }
    .panel-label { font-size: 10px; font-weight: 700; letter-spacing: 0.05em; margin-bottom: 6px; color: #94a3b8; }
    .panel-gap .panel-label { color: #fda4af; }
    .panel-action .panel-label { color: #6ee7b7; }
    .doc-path { margin-top: 8px; font-size: 12px; color: #7dd3fc; }
    .questions { font-size: 12px; color: #cbd5e1; }
    .questions-label { color: #94a3b8; font-weight: 600; margin-bottom: 4px; }
    ul { margin: 4px 0 0 0; padding-left: 20px; }
    li { margin-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; background: #111827; border-radius: 10px; overflow: hidden; }
    th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid #1f2937; }
    th { background: #030712; color: #94a3b8; font-size: 11px; text-transform: uppercase; }
    footer { margin-top: 32px; font-size: 11px; color: #64748b; text-align: center; border-top: 1px solid #1e293b; padding-top: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">
        <div>
          <h1>Seer — PTZOptics Support Knowledge Gap Report</h1>
          <div class="subtitle">Generated ${escapeHtml(dateStr)} • Window: ${escapeHtml(
    run.dateRangeStart
  )} to ${escapeHtml(run.dateRangeEnd)} • Source: ${escapeHtml(run.sourceLabel)}</div>
        </div>
      </div>
      <div style="text-align: right; font-size: 12px; color: #6ee7b7;">
        <strong>Zero-PII Verified</strong><br/>
        <span style="color: #94a3b8;">Engine: ${escapeHtml(
          run.aiProvider.toUpperCase()
        )} (${escapeHtml(run.aiModel)})</span>
      </div>
    </header>

    <div class="kpis">
      <div class="kpi">
        <div class="kpi-label">Tickets Analyzed</div>
        <div class="kpi-val">${run.totalTickets}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Self-Serviceable Issues</div>
        <div class="kpi-val">${run.selfServiceableTickets}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Prioritized Recommendations</div>
        <div class="kpi-val" style="color: #34d399;">${recommendations.length}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Spot-Check Trust Score</div>
        <div class="kpi-val" style="color: #fbbf24;">${
          accuracy.agreementRatePercent !== null
            ? `${accuracy.agreementRatePercent}%`
            : `${accuracy.calibrationExamplesCount} Rules`
        }</div>
      </div>
    </div>

    ${shippedTableHtml}

    <h2>Prioritized Documentation & Tool Recommendations</h2>
    ${recCardsHtml}

    <footer>
      Generated by Seer (PTZOptics Support-Driven Knowledge Base Gap Analyzer). All customer personal information has been scrubbed locally prior to analysis and export.
    </footer>
  </div>
</body>
</html>`;

  const scrubbedHtml = scrubPII(rawHtml);

  return {
    runId: run.id,
    generatedAt,
    markdown: scrubbedMd.scrubbedText,
    html: scrubbedHtml.scrubbedText,
    piiRedactionsAppliedOnExport:
      scrubbedMd.redactionCount + scrubbedHtml.redactionCount,
  };
}
