import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import "dotenv/config";

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function tryGitShow(cwd, commit, filePath) {
  try {
    return execFileSync("git", ["show", `${commit}:${filePath}`], { cwd, encoding: "utf8" });
  } catch {
    return null;
  }
}

const SUBMODULE_DIR = process.env.SUBMODULE_DIR;
const TARGET_JSON_PATH = process.env.TARGET_JSON_PATH;
const OUTPUT_PATH = process.env.OUTPUT_PATH;
const MAX_COMMITS = process.env.MAX_COMMITS ? Number(process.env.MAX_COMMITS) : null;

if (!SUBMODULE_DIR || !TARGET_JSON_PATH) {
  console.error("Missing env vars. Required: SUBMODULE_DIR, TARGET_JSON_PATH");
  process.exit(1);
}

const submoduleCwd = resolve(process.cwd(), SUBMODULE_DIR);

// Ensure we’re in a git repo (submodule)
try {
  git(submoduleCwd, ["rev-parse", "--is-inside-work-tree"]);
} catch {
  console.error(`SUBMODULE_DIR does not look like a git repo: ${SUBMODULE_DIR}`);
  process.exit(1);
}

// Commits that modified that file (oldest -> newest)
const commitsRaw = git(submoduleCwd, [
  "log",
  "--reverse",
  "--follow",
  "--pretty=format:%H",
  "--",
  TARGET_JSON_PATH,
]);
const commits = commitsRaw.split("\n").map(s => s.trim()).filter(Boolean);
const limited = MAX_COMMITS ? commits.slice(0, MAX_COMMITS) : commits;

const out = [];

console.log('detected', commits.length, 'commits modifying', TARGET_JSON_PATH);
for (const sha of limited) {
  console.log('processing commit', sha);
  const raw = tryGitShow(submoduleCwd, sha, TARGET_JSON_PATH);
  if (!raw) continue;

  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    out.push({ sha, error: `JSON_PARSE_FAILED: ${e.message}` });
    continue;
  }

  const timestamp = git(submoduleCwd, ["show", "-s", "--format=%cI", sha]);
  const sgmlData = json.positions.find(pos => pos.symbol === 'SGML');

  if (sgmlData?.marketValue) {
    out.push({
      timestamp,
      marketValue: sgmlData.marketValue,
      costBasis: sgmlData.costBasis,
    });
  }
}

const outputAbs = resolve(process.cwd(), OUTPUT_PATH);
mkdirSync(dirname(outputAbs), { recursive: true });

writeFileSync(
  outputAbs,
  JSON.stringify(
    {
      submodule: SUBMODULE_DIR,
      file: TARGET_JSON_PATH,
      lastUpdated: new Date().toISOString(),
      count: out.length,
      sgmlHistoryData: out,
    },
    null,
    2
  )
);

console.log(`Wrote ${out.length} snapshots to ${OUTPUT_PATH}`);
