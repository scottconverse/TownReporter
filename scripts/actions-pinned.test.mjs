import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const workflows = join(process.cwd(), ".github", "workflows");

test("official GitHub Actions are pinned to immutable commits", () => {
  for (const name of readdirSync(workflows).filter((file) => /\.ya?ml$/i.test(file))) {
    const source = readFileSync(join(workflows, name), "utf8");
    const floating = [...source.matchAll(/uses:\s+actions\/[^@\s]+@(?![0-9a-f]{40}\b)([^\s#]+)/gi)];
    assert.deepEqual(
      floating.map((match) => match[0]),
      [],
      `${name} contains a floating official action reference`,
    );

    for (const match of source.matchAll(/uses:\s+actions\/[^@\s]+@([0-9a-f]{40})([^\r\n]*)/gi)) {
      assert.match(match[2], /#\s+v\d/, `${name} must name the recognizable upstream release beside ${match[1]}`);
    }
  }
});
