import * as fs from "fs";
import * as path from "path";
import { CONFIG_DIR } from "./config.js";

const POSTED_SESSIONS_FILE = "posted_sessions.json";
const ANALYZED_SESSIONS_FILE = "companion_analyzed_sessions.json";

function readTrackingSet(filename: string): Set<string> {
  const trackingFile = path.join(CONFIG_DIR, filename);
  try {
    if (!fs.existsSync(trackingFile)) return new Set();
    const data = JSON.parse(fs.readFileSync(trackingFile, "utf-8"));
    if (!Array.isArray(data)) return new Set();
    return new Set(data.filter((item): item is string => typeof item === "string"));
  } catch {
    return new Set();
  }
}

function writeTrackingSet(filename: string, values: Set<string>): void {
  const trackingFile = path.join(CONFIG_DIR, filename);
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(trackingFile, JSON.stringify([...values]));
  } catch {
    // Non-critical state persistence.
  }
}

export function getPostedSessionIds(): Set<string> {
  return readTrackingSet(POSTED_SESSIONS_FILE);
}

export function recordPostedSession(sessionId: string): void {
  const posted = readTrackingSet(POSTED_SESSIONS_FILE);
  posted.add(sessionId);
  writeTrackingSet(POSTED_SESSIONS_FILE, posted);
}

export function isSessionAnalyzed(sessionPath: string): boolean {
  return readTrackingSet(ANALYZED_SESSIONS_FILE).has(sessionPath);
}

export function getAnalyzedSessionPaths(): Set<string> {
  return readTrackingSet(ANALYZED_SESSIONS_FILE);
}

export function recordAnalyzedSession(sessionPath: string): void {
  const analyzed = readTrackingSet(ANALYZED_SESSIONS_FILE);
  analyzed.add(sessionPath);
  writeTrackingSet(ANALYZED_SESSIONS_FILE, analyzed);
}
