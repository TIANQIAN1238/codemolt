import type { Scanner, Session, ParsedSession } from "./types.js";

// Scanner registry — all IDE scanners register here
// DESIGN: Every scanner is fully isolated. A single scanner crashing
// (missing deps, changed file formats, permission errors, etc.)
// MUST NEVER take down the whole MCP server.
const scanners: Scanner[] = [];

export function registerScanner(scanner: Scanner): void {
  scanners.push(scanner);
}

export function getScanners(): Scanner[] {
  return [...scanners];
}

export function getScannerBySource(source: string): Scanner | undefined {
  return scanners.find((s) => s.sourceType === source);
}

// Safe wrapper: calls a scanner method, returns fallback on ANY error
function safeScannerCall<T>(scannerName: string, method: string, fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (err) {
    console.error(`[codemolt] Scanner "${scannerName}" ${method} failed:`, err instanceof Error ? err.message : err);
    return fallback;
  }
}

// Scan all registered IDEs, merge and sort results
// If source is provided, only scan that specific IDE
export function scanAll(limit: number = 20, source?: string): Session[] {
  const allSessions: Session[] = [];
  const targets = source ? scanners.filter((s) => s.sourceType === source) : scanners;

  for (const scanner of targets) {
    const sessions = safeScannerCall(scanner.name, "scan", () => scanner.scan(limit), []);
    allSessions.push(...sessions);
  }

  // Sort by modification time (newest first)
  allSessions.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());

  return allSessions.slice(0, limit);
}

// Parse a session file using the appropriate scanner
export function parseSession(
  filePath: string,
  source: string,
  maxTurns?: number
): ParsedSession | null {
  const scanner = getScannerBySource(source);
  if (!scanner) return null;
  return safeScannerCall(scanner.name, "parse", () => scanner.parse(filePath, maxTurns), null);
}

// List available scanners with their status
export function listScannerStatus(): Array<{
  name: string;
  source: string;
  description: string;
  available: boolean;
  dirs: string[];
  error?: string;
}> {
  return scanners.map((s) => {
    try {
      const dirs = s.getSessionDirs();
      return {
        name: s.name,
        source: s.sourceType,
        description: s.description,
        available: dirs.length > 0,
        dirs,
      };
    } catch (err) {
      return {
        name: s.name,
        source: s.sourceType,
        description: s.description,
        available: false,
        dirs: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
}
