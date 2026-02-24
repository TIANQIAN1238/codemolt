#!/usr/bin/env npx tsx

import { execSync } from "child_process";
import { createInterface } from "readline";
import fs from "fs";
import path from "path";

const dir = path.resolve(import.meta.dirname, "..");
process.chdir(dir);

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error("Usage: npx tsx scripts/release.ts <version>");
  console.error("Example: npx tsx scripts/release.ts 2.2.0");
  process.exit(1);
}

function run(cmd: string) {
  console.log(`   $ ${cmd}`);
  execSync(cmd, { cwd: dir, stdio: "inherit" });
}

const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));
const prev = pkg.version;
const tag = `mcp-v${version}`;

console.log(`\n  codeblog-mcp  ${prev} → ${version}\n`);
console.log("─".repeat(50));

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

// ─── Step 1: Pre-flight checks ──────────────────
console.log("\n1. Pre-flight checks...");

// 1a. Check working tree is clean
const status = execSync("git status --porcelain", { cwd: dir })
  .toString()
  .trim();
if (status) {
  console.error(
    "   ✗ Working tree is not clean. Commit or stash changes first.",
  );
  console.error(status);
  process.exit(1);
}
console.log("   ✓ Working tree clean");

// 1b. Check current branch is main and up-to-date with remote
const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: dir })
  .toString()
  .trim();
if (currentBranch !== "main") {
  console.warn(`   ⚠ Current branch is '${currentBranch}', not 'main'.`);
  const answer = await ask("   Switch to main and continue? (y/n) ");
  if (answer !== "y") {
    console.error("   ✗ Aborted. Please switch to main manually.");
    process.exit(1);
  }
  run("git checkout main");
  console.log("   ✓ Switched to main");
}

execSync("git fetch origin main", { cwd: dir, stdio: "inherit" });
const localHead = execSync("git rev-parse HEAD", { cwd: dir })
  .toString()
  .trim();
const remoteHead = execSync("git rev-parse origin/main", { cwd: dir })
  .toString()
  .trim();

if (localHead !== remoteHead) {
  const behind = execSync("git rev-list HEAD..origin/main --count", {
    cwd: dir,
  })
    .toString()
    .trim();
  const ahead = execSync("git rev-list origin/main..HEAD --count", { cwd: dir })
    .toString()
    .trim();
  console.warn(
    `   ⚠ Local main is out of sync with origin/main (ahead: ${ahead}, behind: ${behind})`,
  );
  if (Number(behind) > 0) {
    const answer = await ask("   Pull latest from origin/main? (y/n) ");
    if (answer !== "y") {
      console.error("   ✗ Aborted. Please sync with origin/main manually.");
      process.exit(1);
    }
    run("git pull origin main");
    console.log("   ✓ Pulled latest changes");
  } else {
    console.warn(`   ⚠ Local main is ${ahead} commit(s) ahead of origin/main.`);
    const answer = await ask(
      "   Continue release with unpushed commits? (y/n) ",
    );
    if (answer !== "y") {
      console.error(
        "   ✗ Aborted. Push your commits first or reset to origin/main.",
      );
      process.exit(1);
    }
  }
}
console.log("   ✓ On main, synced with origin");

// ─── Confirm before proceeding ──────────────────
const confirm = await ask(
  `\n   Ready to release codeblog-mcp@${version}. Proceed? (y/n) `,
);
if (confirm !== "y") {
  console.error("\n   ✗ Release aborted.");
  process.exit(1);
}

// ─── Step 2: Bump version ───────────────────────
console.log("\n2. Bumping version...");
pkg.version = version;
fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
console.log("   ✓ package.json");

// ─── Step 3: Build ──────────────────────────────
console.log("\n3. Building...");
run("npm run build");
console.log("   ✓ dist/ ready");

// ─── Step 4: Publish to npm ─────────────────────
console.log("\n4. Publishing to npm...");
run("npm publish --access public");
console.log(`   ✓ codeblog-mcp@${version}`);

// ─── Step 5: Git commit + tag + push ────────────
console.log("\n5. Git commit & tag...");
execSync(`git add package.json`, { cwd: dir });
execSync(`git commit -m "release: codeblog-mcp@${version}"`, { cwd: dir });
execSync(`git tag -a ${tag} -m "codeblog-mcp ${version}"`, { cwd: dir });
execSync(`git push origin main --tags`, { cwd: dir });
console.log(`   ✓ ${tag} pushed`);

// ─── Step 6: GitHub Release ─────────────────────
console.log("\n6. Creating GitHub Release...");

// Collect commit messages since previous tag for release notes
let commits = "";
try {
  const prevTag = execSync(`git describe --tags --abbrev=0 ${tag}^`, {
    cwd: dir,
  })
    .toString()
    .trim();
  commits = execSync(`git log ${prevTag}..${tag}^ --oneline --no-decorate`, {
    cwd: dir,
  })
    .toString()
    .trim();
} catch {
  commits = "(first release or unable to determine previous tag)";
}

const releaseNotes = [
  `## codeblog-mcp ${version}`,
  "",
  "### Changes",
  "",
  ...commits
    .split("\n")
    .filter(Boolean)
    .map((line: string) => `- ${line.replace(/^[a-f0-9]+ /, "")}`),
  "",
  "### npm",
  "```bash",
  `npm install codeblog-mcp@${version}`,
  "```",
].join("\n");

const notesFile = path.join(dir, ".release-notes.md");
fs.writeFileSync(notesFile, releaseNotes);

try {
  execSync(
    `gh release create ${tag} --title "${tag}" --notes-file ${notesFile}`,
    { cwd: dir, stdio: "inherit" },
  );
  console.log(`   ✓ GitHub Release ${tag} created`);
} catch {
  console.log("   ⚠ gh CLI not available or failed — create release manually:");
  console.log(`     gh release create ${tag} --title "${tag}"`);
}

// Clean up temp file
try {
  fs.unlinkSync(notesFile);
} catch {}

// ─── Done ───────────────────────────────────────
console.log("\n" + "─".repeat(50));
console.log(`\n  ✅ codeblog-mcp@${version} released!`);
console.log("");
console.log("  Published:");
console.log(`    npm: codeblog-mcp@${version}`);
console.log(`    git: ${tag} (annotated tag)`);
console.log(`    gh:  GitHub Release ${tag}`);
console.log("");
console.log("  Next step (if CLI client needs this version):");
console.log(`    cd ../codeblog-app/packages/codeblog`);
console.log(`    # Update codeblog-mcp version in package.json`);
console.log(`    # Then run: bun run script/release.ts <new-cli-version>`);
console.log("");
