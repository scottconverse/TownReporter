#!/usr/bin/env node
/**
 * Score a meeting story against a golden fact fixture.
 *
 *   node --experimental-strip-types scripts/golden-score.mjs \
 *     --fixture src/lib/news/__fixtures__/golden-meetings/longmont-2026-09-22.json \
 *     --text-file path/to/story.txt
 *
 * The text file is either a story with HEADLINE / DEK / BODY sections or plain body text.
 * Prints one line per fact with the sentence that decided it, then the counts and PASS.
 * Exit 1 when the story fails, 2 when the arguments are wrong.
 */
import { readFileSync } from "node:fs";
import { assertStoryHasText, parseStoryText, scoreGoldenFacts, loadGoldenFixture, formatVerdicts } from "../src/lib/news/golden-facts.ts";

function parseArgs(argv) {
  const args = { fixture: null, textFile: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--fixture") args.fixture = argv[++index] ?? null;
    else if (flag === "--text-file") args.textFile = argv[++index] ?? null;
    else if (flag === "--help" || flag === "-h") args.help = true;
    else throw new Error(`unknown argument: ${flag}`);
  }
  return args;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`golden-score: ${error.message}`);
    console.error("usage: node --experimental-strip-types scripts/golden-score.mjs --fixture <fixture.json> --text-file <story.txt>");
    return 2;
  }
  if (args.help) {
    console.log("usage: node --experimental-strip-types scripts/golden-score.mjs --fixture <fixture.json> --text-file <story.txt>");
    return 0;
  }
  if (!args.fixture || !args.textFile) {
    console.error("golden-score: --fixture and --text-file are both required");
    console.error("usage: node --experimental-strip-types scripts/golden-score.mjs --fixture <fixture.json> --text-file <story.txt>");
    return 2;
  }

  const fixture = loadGoldenFixture(JSON.parse(readFileSync(args.fixture, "utf8")));
  const story = assertStoryHasText(parseStoryText(readFileSync(args.textFile, "utf8")));
  const score = scoreGoldenFacts(story, fixture);

  console.log(`meeting: ${score.meeting} — ${fixture.meeting.title}`);
  console.log(`fixture: ${args.fixture}`);
  console.log(`text:    ${args.textFile}`);
  console.log(`facts:   ${score.fixtureFacts}`);
  console.log("");
  console.log(formatVerdicts(score));
  console.log("");
  const counts = score.counts;
  console.log(
    `counts: correct ${counts.correct}, wrong ${counts.wrong}, not-stated ${counts["not-stated"]}, ` +
      `masked-correct-role ${counts["masked-correct-role"]}, masked-wrong-role ${counts["masked-wrong-role"]}`,
  );
  console.log(`PASS: ${score.pass}`);
  for (const failure of score.failures) console.log(`  - ${failure}`);
  return score.pass ? 0 : 1;
}

process.exit(main());
