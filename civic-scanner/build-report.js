#!/usr/bin/env node
/**
 * Civic Scanner — Permanent Report Build Script
 *
 * Reads a JSON pipeline data file and generates a complete .docx report.
 * Every agent's FULL output is included inline. No summaries. No "see above."
 *
 * Usage:
 *   node build-report.js <pipeline-data.json> [output-dir]
 *
 *   node build-report.js --validate-only <pipeline-data.json>
 * Default output-dir: the input JSON file's directory.
 *
 * The JSON file must conform to the schema in report-schema.json.
 * If validation fails, the script exits with an error listing what's missing.
 *
 * DO NOT MODIFY THIS FILE UNLESS THE REPORT SPEC CHANGES.
 * This script is the single source of truth for report generation.
 */

const fs = require("fs");
const path = require("path");

// ─── Color constants ────────────────────────────────────────────────
const GREEN = "2E7D32";
const AMBER = "D4760A";
const RED   = "C62828";
const GRAY  = "757575";

// ─── CLI args ───────────────────────────────────────────────────────
const args = process.argv.slice(2);
const validateOnly = args[0] === "--validate-only";
const jsonPath = validateOnly ? args[1] : args[0];
const outputDir = validateOnly ? null : (args[1] || (jsonPath ? path.dirname(path.resolve(jsonPath)) : null));

if (!jsonPath || (validateOnly && args.length !== 2) || (!validateOnly && args.length > 2)) {
  console.error("Usage: node build-report.js [--validate-only] <pipeline-data.json> [output-dir]");
  process.exit(1);
}

if (!fs.existsSync(jsonPath)) {
  console.error(`ERROR: File not found: ${jsonPath}`);
  process.exit(1);
}

// ─── Load and parse JSON ────────────────────────────────────────────
let data;
try {
  data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
} catch (e) {
  console.error(`ERROR: Invalid JSON in ${jsonPath}: ${e.message}`);
  process.exit(1);
}

// ─── Validation ─────────────────────────────────────────────────────
const errors = [];

function requireField(obj, field, label) {
  if (!obj || obj[field] === undefined || obj[field] === null || obj[field] === "") {
    errors.push(`Missing: ${label}.${field}`);
  }
}

function requireArray(obj, field, label, minLen = 1) {
  if (!obj || !Array.isArray(obj[field]) || obj[field].length < minLen) {
    errors.push(`Missing or empty array: ${label}.${field} (need >= ${minLen})`);
  }
}

// Meta
requireField(data, "meta", "root");
if (data.meta) {
  ["city", "state", "date", "runNumber", "version"].forEach(f => requireField(data.meta, f, "meta"));
}

// Stats
requireField(data, "stats", "root");

// Meeting action coverage — separate from ranked leads
requireField(data, "meetingCoverage", "root");
if (data.meetingCoverage) {
  const coverage = data.meetingCoverage;
  ["status", "sourceInventory", "agendaReconciliation"].forEach(f => requireField(coverage, f, "meetingCoverage"));
  if (!["COMPLETE", "PARTIAL"].includes(coverage.status)) errors.push("meetingCoverage.status must be COMPLETE or PARTIAL");
  if (!Array.isArray(coverage.meetings)) errors.push("meetingCoverage.meetings must be an array");
  if (!Array.isArray(coverage.actions)) errors.push("meetingCoverage.actions must be an array");
  if (!Array.isArray(coverage.unresolvedGaps)) errors.push("meetingCoverage.unresolvedGaps must be an array");
  if (coverage.status === "COMPLETE" && coverage.unresolvedGaps?.length) errors.push("COMPLETE coverage cannot have unresolved gaps");
  if (coverage.status === "PARTIAL" && Array.isArray(coverage.unresolvedGaps) && !coverage.unresolvedGaps.length) errors.push("PARTIAL coverage must name its unresolved gaps");
  (coverage.meetings || []).forEach((meeting, i) => {
    ["body", "date", "coverageStatus"].forEach(f => requireField(meeting, f, `meetingCoverage.meetings[${i}]`));
    if (coverage.status === "COMPLETE" && meeting.coverageStatus !== "complete") errors.push(`COMPLETE coverage has a partial or unavailable meeting: ${meeting.body}`);
  });
  (coverage.actions || []).forEach((action, i) => {
    ["actionId", "timestamp", "motionOrAction", "outcome", "vote", "policyStage", "evidence", "disposition"].forEach(f => requireField(action, f, `meetingCoverage.actions[${i}]`));
    if (coverage.status === "COMPLETE" && ["unknown", "unverified", "unresolved"].some(value => [action.timestamp, action.vote, action.outcome, action.disposition].includes(value))) errors.push(`COMPLETE coverage has an unresolved action: ${action.actionId}`);
  });
}

// Agent 1 leads
requireArray(data, "agent1_leads", "root", 0);
if (data.agent1_leads) {
  data.agent1_leads.forEach((lead, i) => {
    requireField(lead, "headline", `agent1_leads[${i}]`);
    requireField(lead, "tier", `agent1_leads[${i}]`);
    requireField(lead, "details", `agent1_leads[${i}]`);
  });
}

// Agent 2 stories
requireArray(data, "agent2_stories", "root", 0);
if (data.agent2_stories) {
  const storyIds = new Set();
  data.agent2_stories.forEach((story, i) => {
    requireField(story, "id", `agent2_stories[${i}]`);
    if (storyIds.has(story.id)) errors.push(`Duplicate story ID: ${story.id}`);
    storyIds.add(story.id);
    requireField(story, "headline", `agent2_stories[${i}]`);
    requireField(story, "draft", `agent2_stories[${i}]`);
    requireArray(story, "claims", `agent2_stories[${i}]`);
    requireArray(story, "sourceList", `agent2_stories[${i}]`);
    if (story.draft && story.draft.length < 400) {
      errors.push(`agent2_stories[${i}].draft is too short (${story.draft.length} chars, need >= 400): "${story.headline}"`);
    }
    const sourceIds = new Set();
    for (const [j, source] of (story.sourceList || []).entries()) {
      ["id", "title", "tier", "locator"].forEach(f => requireField(source, f, `agent2_stories[${i}].sourceList[${j}]`));
      if (sourceIds.has(source.id)) errors.push(`agent2_stories[${i}]: duplicate source ID ${source.id}`);
      sourceIds.add(source.id);
      if (!["A", "B", "C"].includes(source.tier)) errors.push(`agent2_stories[${i}].sourceList[${j}]: invalid tier`);
      if (!source.url && !source.recordRef) errors.push(`agent2_stories[${i}].sourceList[${j}]: URL or offline recordRef required`);
      if (source.url) {
        try {
          const parsed = new URL(source.url);
          if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("unsupported protocol");
        } catch { errors.push(`agent2_stories[${i}].sourceList[${j}]: invalid public URL`); }
      }
    }
    const claimIds = new Set();
    for (const [j, claim] of (story.claims || []).entries()) {
      ["id", "text", "status"].forEach(f => requireField(claim, f, `agent2_stories[${i}].claims[${j}]`));
      if (claimIds.has(claim.id)) errors.push(`agent2_stories[${i}]: duplicate claim ID ${claim.id}`);
      claimIds.add(claim.id);
      if (!["VERIFIED", "CONTESTED", "UNVERIFIED"].includes(claim.status)) errors.push(`agent2_stories[${i}].claims[${j}]: invalid status`);
      if (!Array.isArray(claim.sourceIds)) errors.push(`agent2_stories[${i}].claims[${j}]: sourceIds array required`);
      const refs = Array.isArray(claim.sourceIds) ? claim.sourceIds : [];
      for (const id of refs) if (!sourceIds.has(id)) errors.push(`agent2_stories[${i}].claims[${j}]: unknown source ID ${id}`);
      if (claim.status !== "UNVERIFIED" && refs.length === 0) errors.push(`agent2_stories[${i}].claims[${j}]: ${claim.status} claim needs a source`);
      if (claim.status === "VERIFIED" && !refs.some(id => story.sourceList?.find(source => source.id === id && source.tier === "A"))) errors.push(`agent2_stories[${i}].claims[${j}]: VERIFIED claim needs Tier A evidence`);
    }
  });
}

// Agent 2.5 gate
requireArray(data, "agent25_gate", "root", 0);
if (data.agent25_gate) {
  data.agent25_gate.forEach((g, i) => {
    requireField(g, "headline", `agent25_gate[${i}]`);
    requireField(g, "total", `agent25_gate[${i}]`);
    requireField(g, "decision", `agent25_gate[${i}]`);
    ["editorialTier", "editorRecommendation", "whatCannotSay", "aiNextStep", "reportingNotes"].forEach(field => requireField(g, field, `agent25_gate[${i}]`));
    if (g.editorialTier && ![1, 2, 3].includes(g.editorialTier)) errors.push(`agent25_gate[${i}].editorialTier must be 1, 2, or 3`);
    if (g.editorRecommendation && !["EDIT", "REWRITE", "MORE_REPORTING", "DARK_DESK", "HOLD", "KILL"].includes(g.editorRecommendation)) errors.push(`agent25_gate[${i}].editorRecommendation is invalid`);
    if (g.editorialTier === 1 && g.decision !== "ADVANCE") errors.push(`agent25_gate[${i}]: Tier 1 requires ADVANCE`);
    if (g.editorialTier === 1 && g.editorRecommendation !== "EDIT") errors.push(`agent25_gate[${i}]: Tier 1 requires EDIT recommendation`);
    if (g.decision === "ADVANCE" && !data.agent2_stories?.some(story => story.id === g.id)) errors.push(`ADVANCE lead ${g.id} has no story packet with claims and sources`);
  });
}

// Agent 3 black desk
requireArray(data, "agent3_blackDesk", "root", 0);
if (data.agent3_blackDesk) {
  data.agent3_blackDesk.forEach((signal, i) => {
    ["signalId", "source", "sourceTier", "confidence", "title", "speculativeAngle", "investigationQuestion", "vulnerabilityDetail", "agent4Target"].forEach(f => requireField(signal, f, `agent3_blackDesk[${i}]`));
    requireArray(signal, "vulnerabilityTypes", `agent3_blackDesk[${i}]`);
    if (signal.confidence < 0.1 || signal.confidence > 0.5) errors.push(`agent3_blackDesk[${i}].confidence must be 0.1–0.5`);
  });
}

// Agent 4 adversarial
requireArray(data, "agent4_adversarial", "root", 0);
if (data.agent4_adversarial) {
  data.agent4_adversarial.forEach((a, i) => {
    requireField(a, "headline", `agent4_adversarial[${i}]`);
    requireField(a, "gate1", `agent4_adversarial[${i}]`);
    requireField(a, "gate2", `agent4_adversarial[${i}]`);
    requireField(a, "gate3_counterNarrative", `agent4_adversarial[${i}]`);
    if (a.gate3_counterNarrative && a.gate3_counterNarrative.length < 100) {
      errors.push(`agent4_adversarial[${i}].gate3_counterNarrative too short (${a.gate3_counterNarrative.length} chars): "${a.headline}"`);
    }
  });
}
for (const signal of data.agent3_blackDesk || []) {
  const review = (data.agent4_adversarial || []).find(a => a.id === signal.signalId);
  if (!review) errors.push(`Agent 4 disposition missing for Black Desk signal ${signal.signalId}`);
  else {
    ["severity", "verdict", "targetCheck"].forEach(field => requireField(review, field, `agent4_adversarial[${signal.signalId}]`));
  }
}
for (const gate of data.agent25_gate || []) {
  if (gate.decision === "ADVANCE" && !data.agent4_adversarial?.some(review => review.id === gate.id)) errors.push(`ADVANCE story ${gate.id} has no adversarial review`);
}

// Agent 5
requireArray(data, "agent5_completeness", "root", 0);

// Agent 6
requireArray(data, "agent6_legal", "root", 0);
if (data.agent6_legal) {
  data.agent6_legal.forEach((l, i) => {
    requireField(l, "analysis", `agent6_legal[${i}]`);
  });
}

// Agent 7
requireArray(data, "agent7_plainLanguage", "root", 0);
if (data.agent7_plainLanguage) {
  data.agent7_plainLanguage.forEach((p, i) => {
    requireField(p, "rewrite", `agent7_plainLanguage[${i}]`);
    if (p.rewrite && p.rewrite.length < 150) {
      errors.push(`agent7_plainLanguage[${i}].rewrite too short (${p.rewrite.length} chars): "${p.headline}"`);
    }
  });
}

// Agent 7.5
requireArray(data, "agent75_distribution", "root", 0);
if (data.agent75_distribution) {
  data.agent75_distribution.forEach((d, i) => {
    ["seo", "twitter", "facebook", "linkedin", "nextdoor", "newsletter", "emailSubjects"].forEach(f => {
      requireField(d, f, `agent75_distribution[${i}]`);
    });
  });
}

// Agent 8
requireField(data, "agent8_hygiene", "root");

// Held stories (can be empty array)
if (!Array.isArray(data.heldStories)) {
  errors.push("Missing: heldStories (must be array, can be empty)");
} else {
  data.heldStories.forEach((held, i) => {
    requireField(held, "storyId", `heldStories[${i}]`);
    requireField(held, "headline", `heldStories[${i}]`);
    if (!data.agent2_stories?.some(story => story.id === held.storyId)) errors.push(`heldStories[${i}]: story packet missing for ${held.storyId}`);
  });
}

// Trust dashboard
requireField(data, "trustDashboard", "root");

if (errors.length > 0) {
  console.error("═══ VALIDATION FAILED ═══");
  errors.forEach(e => console.error("  ✗ " + e));
  console.error(`\n${errors.length} error(s). Fix the JSON data file and re-run.`);
  process.exit(1);
}

if (validateOnly) {
  console.log("Report data passed required-field and meeting-coverage checks.");
  process.exit(0);
}

// The optional docx dependency is needed only to create a document.
let docxPath;
for (const candidate of [path.join(__dirname, "node_modules", "docx"), path.join(process.cwd(), "node_modules", "docx"), "docx"]) {
  try { require.resolve(candidate); docxPath = candidate; break; } catch {}
}
if (!docxPath) {
  console.error("ERROR: Cannot find 'docx' module. Run: npm install docx");
  process.exit(1);
}
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, PageBreak, Footer, Header } = require(docxPath);
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

// ─── Helper functions ───────────────────────────────────────────────

function h1(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 150 } });
}
function h2(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 120 } });
}
function h3(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 100 } });
}

function para(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({ text, font: "Calibri", size: 22, ...opts })],
  });
}

function boldPara(label, value) {
  return new Paragraph({
    spacing: { after: 80 },
    children: [
      new TextRun({ text: label, bold: true, font: "Calibri", size: 22 }),
      new TextRun({ text: value, font: "Calibri", size: 22 }),
    ],
  });
}

function colorLabel(label, color, text) {
  return new Paragraph({
    spacing: { after: 80 },
    children: [
      new TextRun({ text: label + ": ", bold: true, font: "Calibri", size: 22 }),
      new TextRun({ text, bold: true, color, font: "Calibri", size: 22 }),
    ],
  });
}

function bullet(text) {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 60 },
    children: [new TextRun({ text, font: "Calibri", size: 22 })],
  });
}

function longText(text) {
  // Split long text into paragraphs on double newline, or treat as single block
  const blocks = text.split(/\n\n+/);
  return blocks.map(block =>
    new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({ text: block.replace(/\n/g, " ").trim(), font: "Calibri", size: 22 })],
    })
  );
}

function pb() {
  return new Paragraph({ children: [new PageBreak()] });
}

function severityColor(sev) {
  const s = (sev || "").toUpperCase();
  if (s.includes("GREEN") || s.includes("VERIFIED") || s.includes("PUBLISH") || s.includes("PASS")) return GREEN;
  if (s.includes("AMBER") || s.includes("CONTEST") || s.includes("REVISE") || s.includes("CORRECT")) return AMBER;
  if (s.includes("RED") || s.includes("KILL") || s.includes("SUPPRESS") || s.includes("FAIL")) return RED;
  return GRAY;
}

// ─── Build document ─────────────────────────────────────────────────
const m = data.meta;
const s = data.stats;
const children = [];

// ── TITLE PAGE ──────────────────────────────────────────────────────
children.push(new Paragraph({ spacing: { before: 2000 } }));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [
  new TextRun({ text: "CIVIC SOURCE SCANNER", font: "Calibri", size: 48, bold: true }),
]}));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [
  new TextRun({ text: "Full Pipeline Report", font: "Calibri", size: 36, color: GRAY }),
]}));
children.push(new Paragraph({ spacing: { before: 200 }, alignment: AlignmentType.CENTER, children: [
  new TextRun({ text: `${m.city}, ${m.state}`, font: "Calibri", size: 28, bold: true }),
]}));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [
  new TextRun({ text: m.date, font: "Calibri", size: 24, color: GRAY }),
]}));
children.push(new Paragraph({ spacing: { before: 300 }, alignment: AlignmentType.CENTER, children: [
  new TextRun({ text: `Pipeline: Full (9+ agents) | Scanner: ${m.version} | Run #${m.runNumber}`, font: "Calibri", size: 20 }),
]}));
children.push(new Paragraph({ spacing: { before: 100 }, alignment: AlignmentType.CENTER, children: [
  new TextRun({ text: `Stories scanned: ${s.scanned} | Advanced: ${s.advanced} | Held: ${s.held} | Killed: ${s.killed} | Suppressed: ${s.suppressed}`, font: "Calibri", size: 20, bold: true }),
]}));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [
  new TextRun({ text: `Sources checked: ${s.tierACounts} Tier A / ${s.tierBCounts} Tier B / ${s.tierCCounts} Tier C`, font: "Calibri", size: 20 }),
]}));

// ══════════════════════════════════════════════════════════════════════
// SECTION A: EDITORIAL DASHBOARD
// ══════════════════════════════════════════════════════════════════════
children.push(pb());
children.push(h1("SECTION A: EDITORIAL DASHBOARD"));

// Beat Context
if (data.beatContext && data.beatContext.text) {
  children.push(h2("Beat Context"));
  children.push(para(data.beatContext.text));
}

// Source Access Limitations
if (data.sourceAccessLimitations) {
  children.push(h2("Source Access Limitations"));
  if (data.sourceAccessLimitations.blockedDomains) {
    children.push(para(`WARNING: ${data.sourceAccessLimitations.blockedDomains}`));
  }
  if (data.sourceAccessLimitations.manualReviewItems) {
    data.sourceAccessLimitations.manualReviewItems.forEach(item => children.push(bullet(item)));
  }
}

// Meeting coverage is an audit trail, not a subset of ranked story leads.
const coverage = data.meetingCoverage;
children.push(h2("Meeting Action Coverage"));
children.push(colorLabel("Run status", coverage.status === "COMPLETE" ? GREEN : AMBER, coverage.status));
children.push(boldPara("Source inventory: ", coverage.sourceInventory));
children.push(boldPara("Agenda and minutes reconciliation: ", coverage.agendaReconciliation));
coverage.meetings.forEach(meeting => {
  children.push(bullet(`${meeting.body} — ${meeting.date} — ${meeting.coverageStatus}${meeting.recordingUrl ? ` — ${meeting.recordingUrl}` : ""}`));
  if (meeting.gaps) children.push(boldPara("Coverage gaps: ", meeting.gaps));
});
if (coverage.unresolvedGaps.length) {
  children.push(h3("Unresolved coverage gaps"));
  coverage.unresolvedGaps.forEach(gap => children.push(bullet(gap)));
}
children.push(h3("All substantive actions"));
if (!coverage.actions.length) children.push(para("No substantive actions logged for the stated window."));
coverage.actions.forEach(action => {
  children.push(boldPara(`${action.actionId} at ${action.timestamp}: `, action.motionOrAction));
  children.push(para(`${action.outcome}; vote: ${action.vote}; stage: ${action.policyStage}; disposition: ${action.disposition}`));
  children.push(boldPara("Official evidence: ", action.evidence));
});

// ── Dashboard: Editor desk ──────────────────────────────────────────
children.push(h2("Editor Desk — Tiered Story Packets"));
children.push(para("Editorial readiness Tier 1 = nearly finished draft for edit; Tier 2 = developing story with identified gaps; Tier 3 = possible lead for investigation. These differ from source tiers A/B/C and newsworthiness scores. The AI recommends a move; the human editor may edit, request a rewrite, order more reporting or a Dark Signal Desk dig, hold, or kill any item. Full drafts, claims, and sources appear in the appendix."));
const ranked = [...data.agent25_gate].sort((a, b) => a.editorialTier - b.editorialTier || b.total - a.total);
if (!ranked.length) children.push(para("No scored story packet is ready in this run. Review the Black Desk and Tier B/C signals below for possible reporting."));
ranked.forEach((gate, idx) => {
  const story = data.agent2_stories.find(st => st.id === gate.id);
  const adv = data.agent4_adversarial.find(a => a.id === gate.id);
  children.push(h3(`${idx + 1}. Tier ${gate.editorialTier}: ${gate.headline}`));
  children.push(colorLabel("Severity", severityColor(adv ? adv.severity : ""), adv ? adv.severity : "N/A"));
  children.push(boldPara("Newsworthiness: ", `${gate.total}/20 (Immediacy ${gate.immediacy}, Impact ${gate.impact}, Conflict ${gate.conflict}, Novelty ${gate.novelty})`));
  children.push(boldPara("Gate decision: ", gate.decision));
  children.push(boldPara("AI recommendation for editor: ", gate.editorRecommendation));
  children.push(boldPara("What the story cannot say: ", gate.whatCannotSay));
  children.push(boldPara("AI next step: ", gate.aiNextStep));
  children.push(boldPara("Beat: ", gate.beat || "NEW"));
  children.push(boldPara("Headline audit: ", gate.headlineAudit || "PASSED"));
  children.push(boldPara("Legal risk: ", gate.legalRisk || "LOW"));
  children.push(para(gate.reportingNotes, { italics: true }));
  if (story?.sourceList?.length) {
    children.push(boldPara("Story sources: ", story.sourceList.map(source => `${source.id}: ${source.url || source.recordRef}`).join("; ")));
  }
});

// ── Dashboard: Held Stories ─────────────────────────────────────────
if (data.heldStories && data.heldStories.length > 0) {
  children.push(h2("Stories on Hold"));
  data.heldStories.forEach(held => {
    const packet = data.agent2_stories.find(story => story.id === held.storyId);
    children.push(h3(held.headline));
    children.push(colorLabel("Severity", GRAY, "HOLD"));
    if (packet) children.push(boldPara("Story sources: ", packet.sourceList.map(source => `${source.id}: ${source.url || source.recordRef}`).join("; ")));
    if (held.source) children.push(boldPara("Source: ", held.source));
    if (held.details) children.push(para(held.details));
    if (held.scoring) children.push(para(held.scoring));
    children.push(boldPara("Why held: ", held.reason || "Below threshold"));
    children.push(boldPara("What would elevate: ", held.elevate || "N/A"));
  });
}

// ── Dashboard: Black Desk possible stories ─────────────────────────
children.push(h2("Black Desk — Possible Stories to Investigate (Unverified)"));
children.push(para("These are speculative investigation leads, not verified stories or publication copy. Agent 4's check does not by itself promote a hypothesis into a story packet."));
if (!data.agent3_blackDesk.length) children.push(para("No Black Desk hypotheses generated for this run."));
data.agent3_blackDesk.forEach((signal, index) => {
  const review = data.agent4_adversarial.find(item => item.id === signal.signalId);
  children.push(h3(`${index + 1}. ${signal.title}`));
  children.push(colorLabel("Status", GRAY, "UNVERIFIED HYPOTHESIS"));
  children.push(boldPara("Source and confidence: ", `Tier ${signal.sourceTier} — ${signal.source}; ${signal.confidence}`));
  children.push(boldPara("Possible story: ", signal.speculativeAngle));
  children.push(boldPara("Evidence problem: ", `${signal.vulnerabilityTypes.join(", ")} — ${signal.vulnerabilityDetail}`));
  children.push(boldPara("Check next: ", signal.agent4Target));
  children.push(boldPara("Agent 4 disposition: ", `${review.verdict} (${review.severity}) — ${review.targetCheck}`));
});

// ── Dashboard: Tier B Leads ─────────────────────────────────────────
const tierBLeads = (data.agent1_leads || []).filter(l => l.tier === "B");
if (tierBLeads.length > 0) {
  children.push(h2("Tier B Leads (Need Tier A Corroboration)"));
  tierBLeads.forEach(lead => {
    children.push(h3(`[B] ${lead.headline}`));
    children.push(boldPara("Source: ", lead.source || "N/A"));
    if (lead.url) children.push(boldPara("URL: ", lead.url));
    children.push(para(lead.details));
    if (lead.action) children.push(boldPara("Action: ", lead.action));
  });
}

// ── Dashboard: Tier C Signals ───────────────────────────────────────
const tierCSignals = (data.agent1_leads || []).filter(l => l.tier === "C");
if (tierCSignals.length > 0) {
  children.push(h2("Tier C Signals (Investigation Needed)"));
  tierCSignals.forEach(sig => {
    children.push(h3(`[C] ${sig.headline}`));
    children.push(para(sig.details));
    if (sig.action) children.push(boldPara("Action: ", sig.action));
  });
}

// ── Upcoming Meetings ───────────────────────────────────────────────
if (data.upcomingMeetings && data.upcomingMeetings.length > 0) {
  children.push(h2("Upcoming Meetings"));
  data.upcomingMeetings.forEach(mtg => children.push(bullet(mtg)));
}

// ── Trust Dashboard ─────────────────────────────────────────────────
if (data.trustDashboard) {
  children.push(h2("Trust Dashboard"));
  const td = data.trustDashboard;
  Object.entries(td).forEach(([k, v]) => {
    children.push(boldPara(`${k}: `, String(v)));
  });
}

// ══════════════════════════════════════════════════════════════════════
// SECTION B: VERIFICATION APPENDIX
// ══════════════════════════════════════════════════════════════════════
children.push(pb());
children.push(h1("SECTION B: VERIFICATION APPENDIX"));

// ── Agent 1: Full Lead List ─────────────────────────────────────────
children.push(pb());
children.push(h2("Agent 1: News Aggregator — Full Lead List"));
(data.agent1_leads || []).forEach((lead, i) => {
  children.push(h3(`${i + 1}. [${lead.tier}] ${lead.headline}`));
  if (lead.source) children.push(boldPara("Source: ", lead.source));
  if (lead.url) children.push(boldPara("URL: ", lead.url));
  if (lead.confidence) children.push(boldPara("Confidence: ", lead.confidence));
  if (lead.beat) children.push(boldPara("Beat: ", lead.beat));
  children.push(para(lead.details));
  if (lead.action) children.push(boldPara("Action: ", lead.action));
});

// ── Agent 2: Full Story Drafts ──────────────────────────────────────
children.push(pb());
children.push(h2("Agent 2: Story Expansion — Full Drafts"));
(data.agent2_stories || []).forEach(story => {
  children.push(h3(story.headline));
  children.push(...longText(story.draft));
  children.push(h3("Claims and evidence"));
  story.claims.forEach(claim => {
    children.push(boldPara(`[${claim.status}] ${claim.id}: `, claim.text));
    children.push(para(`Sources: ${claim.sourceIds.length ? claim.sourceIds.join(", ") : "none yet"}${claim.note ? ` — ${claim.note}` : ""}`));
  });
  children.push(h3("Source list"));
  story.sourceList.forEach(source => {
    children.push(bullet(`[${source.id}] Tier ${source.tier} — ${source.title} — ${source.url || source.recordRef} — ${source.locator}${source.date ? ` — ${source.date}` : ""}`));
  });
});

// ── Agent 2.5: Newsworthiness Gate ──────────────────────────────────
children.push(pb());
children.push(h2("Agent 2.5: Newsworthiness Gate — Full Scoring"));
children.push(para("Scoring key: Each story scored on 4 dimensions (1-5 each, total 4-20). Threshold to advance: 10/20. Score 7-9 = HOLD. Score ≤6 = DEMOTE."));
(data.agent25_gate || []).forEach(g => {
  children.push(h3(`${g.headline} — ${g.decision}`));
  children.push(boldPara("Immediacy: ", `${g.immediacy}/5 — ${g.immediacyReason || ""}`));
  children.push(boldPara("Impact: ", `${g.impact}/5 — ${g.impactReason || ""}`));
  children.push(boldPara("Conflict: ", `${g.conflict}/5 — ${g.conflictReason || ""}`));
  children.push(boldPara("Novelty: ", `${g.novelty}/5 — ${g.noveltyReason || ""}`));
  children.push(boldPara("Total: ", `${g.total}/20`));
  children.push(boldPara("Beat: ", g.beat || "NEW"));
  children.push(boldPara("Decision: ", g.reasoning || g.decision));
  children.push(boldPara("Editorial readiness: ", `Tier ${g.editorialTier} — AI recommends ${g.editorRecommendation}`));
  children.push(boldPara("What the story cannot say: ", g.whatCannotSay));
  children.push(boldPara("AI next step: ", g.aiNextStep));
  children.push(h3("AI Reporting Notes"));
  children.push(para(g.reportingNotes));
  if (g.visualDirection) {
    children.push(h3("Visual Direction Brief"));
    children.push(...longText(g.visualDirection));
  }
});

// ── Agent 3: Black Desk ─────────────────────────────────────────────
children.push(pb());
children.push(h2("Agent 3: Black Desk — Speculative Signals"));
children.push(para("NOTE: Black Desk output is NEVER publication copy. It feeds the Dark Signal Desk and further AI reporting; the editor may order more digging or kill a signal."));
(data.agent3_blackDesk || []).forEach((sig, i) => {
  children.push(h3(`Signal ${i + 1}: ${sig.title} (Confidence: ${sig.confidence})`));
  children.push(boldPara("Source: ", `${sig.sourceTier} — ${sig.source}`));
  children.push(boldPara("Speculative Angle: ", sig.speculativeAngle));
  if (sig.connections) children.push(boldPara("Connections: ", sig.connections));
  children.push(boldPara("Investigation Question: ", sig.investigationQuestion));
  children.push(boldPara("Vulnerability: ", `${sig.vulnerabilityTypes.join(", ")} — ${sig.vulnerabilityDetail}`));
  children.push(boldPara("Agent 4 target: ", sig.agent4Target));
});

// ── Agent 4: Adversarial Challenge ──────────────────────────────────
children.push(pb());
children.push(h2("Agent 4: Adversarial Challenge — Full 4-Gate Verification"));
(data.agent4_adversarial || []).forEach(adv => {
  children.push(h3(`${adv.headline}`));
  children.push(colorLabel("Verdict", severityColor(adv.severity), `${adv.severity} — ${adv.verdict}`));
  if (adv.targetCheck) children.push(boldPara("Black Desk target check: ", adv.targetCheck));
  children.push(boldPara("Gate 1 — Contestation Check: ", adv.gate1));
  children.push(boldPara("Gate 2 — Mandatory Adverse Search: ", adv.gate2));
  children.push(h3("Gate 3 — Counter-Narrative (Full Text)"));
  children.push(...longText(adv.gate3_counterNarrative));
  children.push(boldPara("Gate 4 — Self-Referential Warning: ", adv.gate4 || "N/A"));
});

// ── Agent 5: Completeness Auditor ───────────────────────────────────
children.push(pb());
children.push(h2("Agent 5: Completeness Auditor"));
(data.agent5_completeness || []).forEach(audit => {
  children.push(h3(audit.headline));
  children.push(colorLabel("Verdict", severityColor(audit.verdict), audit.verdict));
  children.push(boldPara("Attribution: ", audit.attribution));
  children.push(boldPara("Balance: ", audit.balance));
  children.push(boldPara("Harm Assessment: ", audit.harm));
  children.push(boldPara("Legal Risk Flag: ", audit.legalFlag));
  if (audit.notes) children.push(para(audit.notes));
});

// ── Agent 6: First Amendment Counsel ────────────────────────────────
children.push(pb());
children.push(h2("Agent 6: First Amendment Counsel"));
(data.agent6_legal || []).forEach(legal => {
  children.push(h3(legal.headline));
  children.push(boldPara("Threat Classification: ", legal.threatType || "None identified"));
  children.push(boldPara("Applicable Doctrine: ", legal.doctrine || "Fair report privilege"));
  children.push(boldPara("Risk Assessment: ", legal.riskLevel || "LOW"));
  children.push(h3("Analysis"));
  children.push(...longText(legal.analysis));
  children.push(boldPara("Recommendation: ", legal.recommendation || "Proceed"));
});
children.push(para("DISCLAIMER: This is editorial guidance, NOT legal advice. For situations assessed as MEDIUM or HIGH risk, consult a media law attorney.", { italics: true }));

// ── Agent 7: Plain-Language Rewrites ────────────────────────────────
children.push(pb());
children.push(h2("Agent 7: Plain-Language Translator — Full Rewrites"));
children.push(para("Target reading level: 8th grade. Public-facing summaries for newsletters and social media."));
(data.agent7_plainLanguage || []).forEach(pl => {
  children.push(h3(pl.headline));
  children.push(...longText(pl.rewrite));
});

// ── Agent 7.5: Distribution Packages ────────────────────────────────
children.push(pb());
children.push(h2("Agent 7.5: Distribution Packager — Full Packages"));
(data.agent75_distribution || []).forEach(dist => {
  children.push(h3(`Distribution Package: ${dist.headline}`));

  children.push(boldPara("SEO: ", ""));
  children.push(para(dist.seo));

  children.push(boldPara("Twitter/X: ", ""));
  children.push(para(dist.twitter));
  if (dist.hashtags) children.push(boldPara("Hashtags: ", dist.hashtags));

  children.push(boldPara("Facebook: ", ""));
  children.push(para(dist.facebook));

  children.push(boldPara("LinkedIn: ", ""));
  children.push(para(dist.linkedin));

  children.push(boldPara("Nextdoor: ", ""));
  children.push(para(dist.nextdoor));

  children.push(boldPara("Newsletter Brief: ", ""));
  children.push(para(dist.newsletter));

  children.push(boldPara("Email Subject Lines: ", ""));
  if (Array.isArray(dist.emailSubjects)) {
    dist.emailSubjects.forEach((subj, i) => children.push(bullet(`${i + 1}. ${subj}`)));
  } else {
    children.push(para(dist.emailSubjects));
  }
});

// ── Agent 8: Source Hygiene + Headline Audit ────────────────────────
children.push(pb());
children.push(h2("Agent 8: Source Hygiene + Headline Audit"));
const hyg = data.agent8_hygiene;
if (hyg.sourceChecks) {
  children.push(h3("Source Hygiene Checks"));
  children.push(...longText(hyg.sourceChecks));
}
if (hyg.headlineAudit) {
  children.push(h3("Headline / Status Audit"));
  children.push(...longText(hyg.headlineAudit));
}
if (hyg.originalityCheck) {
  children.push(h3("Originality Verification"));
  children.push(...longText(hyg.originalityCheck));
}

// ── Agent 9: Additional Research ────────────────────────────────────
if (data.agent9_research && data.agent9_research.text) {
  children.push(pb());
  children.push(h2("Agent 9: Story Research & Writing"));
  children.push(...longText(data.agent9_research.text));
}

// ── Suppression Ledger ──────────────────────────────────────────────
children.push(pb());
children.push(h2("Suppression Ledger"));
if (data.suppressionLedger && data.suppressionLedger.length > 0) {
  data.suppressionLedger.forEach(entry => {
    children.push(h3(entry.headline));
    children.push(boldPara("Date: ", entry.date || "N/A"));
    children.push(boldPara("Reason: ", entry.reason));
    children.push(boldPara("Reopen Trigger: ", entry.reopenTrigger || "N/A"));
  });
} else {
  children.push(para("No stories suppressed this run."));
}
if (data.heldStories && data.heldStories.length > 0) {
  data.heldStories.forEach(held => {
    children.push(boldPara("HELD — ", `${held.headline}: ${held.reason}. Reopen trigger: ${held.elevate || "N/A"}`));
  });
}

// ── Build the document ──────────────────────────────────────────────
const doc = new Document({
  sections: [{
    headers: {
      default: new Header({
        children: [new Paragraph({
          children: [new TextRun({
            text: `CIVIC SOURCE SCANNER ${m.version} | ${m.city}, ${m.state} | ${m.date}`,
            font: "Calibri", size: 18, color: GRAY, italics: true,
          })],
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({
            text: "CONFIDENTIAL — For Editorial Review Only",
            font: "Calibri", size: 16, color: GRAY, italics: true,
          })],
        })],
      }),
    },
    children,
  }],
});

// ── Write file ──────────────────────────────────────────────────────
const now = new Date();
const timeStr = String(now.getHours()).padStart(2, "0") + String(now.getMinutes()).padStart(2, "0");
const citySlug = m.city.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const outFile = path.join(outputDir, `CivicScanner-Pipeline-Report-${citySlug}-${m.date}-${timeStr}.docx`);

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync(outFile, buffer);

  // ── Post-generation validation ──────────────────────────────────
  // Quick content size check by counting total text in the JSON
  let totalText = "";
  (data.agent2_stories || []).forEach(s => totalText += s.draft);
  (data.agent4_adversarial || []).forEach(a => totalText += a.gate3_counterNarrative);
  (data.agent7_plainLanguage || []).forEach(p => totalText += p.rewrite);
  (data.agent75_distribution || []).forEach(d => totalText += d.twitter + d.facebook + d.linkedin + d.nextdoor + d.newsletter);

  const charCount = totalText.length;
  const storyCount = data.agent2_stories.length;

  console.log("═══ REPORT GENERATED ═══");
  console.log(`  File: ${outFile}`);
  console.log(`  Size: ${buffer.length} bytes`);
  console.log(`  Stories: ${storyCount}`);
  console.log(`  Core content: ${charCount} characters`);

  if (charCount < 15000) {
    console.warn(`  ⚠ WARNING: Core content is ${charCount} chars (expected >= 15,000). Report may be incomplete.`);
  } else {
    console.log(`  ✓ Content validation passed (${charCount} >= 15,000 chars)`);
  }

  console.log("═══════════════════════");
}).catch(err => {
  console.error("ERROR building .docx:", err);
  process.exit(1);
});
