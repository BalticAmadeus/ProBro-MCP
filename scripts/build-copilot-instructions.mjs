#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const githubDir = path.join(repoRoot, ".github");
const bootstrapDir = path.join(githubDir, "copilot-bootstrap");
const profilesDir = path.join(bootstrapDir, "profiles");

const profileArg = process.argv.find((arg) => arg.startsWith("--profile="));
const selectedProfile = profileArg?.split("=")[1] || process.env.COPILOT_DB_PROFILE || "sports2020";
const listProfilesOnly = process.argv.includes("--list-profiles");

const globalPath = path.join(bootstrapDir, "global-rules.md");
const profilePath = path.join(profilesDir, `${selectedProfile}.md`);
const outputPath = path.join(githubDir, "copilot-instructions.md");

function getAvailableProfiles() {
  if (!fs.existsSync(profilesDir)) {
    return [];
  }

  return fs
    .readdirSync(profilesDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
    .map((entry) => path.parse(entry.name).name)
    .filter((name) => name.toLowerCase() !== "template")
    .sort((a, b) => a.localeCompare(b));
}

function readOrThrow(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8").trim();
}

try {
  const availableProfiles = getAvailableProfiles();

  if (listProfilesOnly) {
    if (availableProfiles.length === 0) {
      console.log("No DB profiles found in .github/copilot-bootstrap/profiles.");
      process.exit(0);
    }

    console.log("Available DB profiles:");
    for (const profile of availableProfiles) {
      console.log(`- ${profile}`);
    }
    process.exit(0);
  }

  if (!availableProfiles.includes(selectedProfile)) {
    const suggestions = availableProfiles.length > 0 ? availableProfiles.join(", ") : "(none found)";
    throw new Error(
      `Unknown DB profile '${selectedProfile}'. Expected file '${selectedProfile}.md' in .github/copilot-bootstrap/profiles. Available profiles: ${suggestions}`
    );
  }

  const globalRules = readOrThrow(globalPath);
  const dbProfile = readOrThrow(profilePath);

  const output = [
    "<!-- AUTO-GENERATED FILE. DO NOT EDIT DIRECTLY. -->",
    "<!-- Source: .github/copilot-bootstrap/global-rules.md + selected profile -->",
    "",
    globalRules,
    "",
    "## 5) Active DB Profile",
    "",
    dbProfile,
    "",
    "## 6) Profile Switch Template",
    "",
    "When changing databases, keep global rules unchanged and swap only the DB profile file.",
    "",
    "Suggested profile format:",
    "",
    "- DB name",
    "- Known table constraints",
    "- Required field naming quirks",
    "- High-risk operations",
    "- Verified examples",
    ""
  ].join("\n");

  fs.writeFileSync(outputPath, output, "utf8");
  console.log(`Generated ${outputPath} using profile '${selectedProfile}'.`);
} catch (error) {
  console.error(`Failed to build copilot instructions: ${error.message}`);
  process.exit(1);
}
