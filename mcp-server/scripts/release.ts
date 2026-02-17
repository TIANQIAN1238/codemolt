#!/usr/bin/env npx tsx

import { execSync } from "child_process"
import fs from "fs"
import path from "path"

const dir = path.resolve(import.meta.dirname, "..")
process.chdir(dir)

const version = process.argv[2]
if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error("Usage: npx tsx scripts/release.ts <version>")
  console.error("Example: npx tsx scripts/release.ts 2.2.0")
  process.exit(1)
}

function run(cmd: string) {
  console.log(`   $ ${cmd}`)
  execSync(cmd, { cwd: dir, stdio: "inherit" })
}

const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"))
const prev = pkg.version
const tag = `mcp-v${version}`

console.log(`\n  codeblog-mcp  ${prev} → ${version}\n`)
console.log("─".repeat(50))

// ─── Step 1: Pre-flight checks ──────────────────
console.log("\n1. Pre-flight checks...")

const status = execSync("git status --porcelain", { cwd: dir }).toString().trim()
if (status) {
  console.error("   ✗ Working tree is not clean. Commit or stash changes first.")
  console.error(status)
  process.exit(1)
}
console.log("   ✓ Working tree clean")

// ─── Step 2: Bump version ───────────────────────
console.log("\n2. Bumping version...")
pkg.version = version
fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n")
console.log("   ✓ package.json")

// ─── Step 3: Build ──────────────────────────────
console.log("\n3. Building...")
run("npm run build")
console.log("   ✓ dist/ ready")

// ─── Step 4: Publish to npm ─────────────────────
console.log("\n4. Publishing to npm...")
run("npm publish --access public")
console.log(`   ✓ codeblog-mcp@${version}`)

// ─── Step 5: Git commit + tag + push ────────────
console.log("\n5. Git commit & tag...")
execSync(`git add package.json`, { cwd: dir })
execSync(`git commit -m "release: codeblog-mcp@${version}"`, { cwd: dir })
execSync(`git tag -a ${tag} -m "codeblog-mcp ${version}"`, { cwd: dir })
execSync(`git push origin main --tags`, { cwd: dir })
console.log(`   ✓ ${tag} pushed`)

// ─── Done ───────────────────────────────────────
console.log("\n" + "─".repeat(50))
console.log(`\n  ✅ codeblog-mcp@${version} released!`)
console.log("")
console.log("  Published:")
console.log(`    npm: codeblog-mcp@${version}`)
console.log(`    git: ${tag} (annotated tag)`)
console.log("")
console.log("  Next step (if CLI client needs this version):")
console.log(`    cd ../codeblog-app/packages/codeblog`)
console.log(`    # Update codeblog-mcp version in package.json`)
console.log(`    # Then run: bun run script/release.ts <new-cli-version>`)
console.log("")
