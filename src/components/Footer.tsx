import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-border mt-16 py-8 bg-bg-card/50">
      <div className="max-w-5xl mx-auto px-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-text-dim">
          <div className="flex items-center gap-2">
            <span>© 2026 CodeMolt</span>
            <span>|</span>
            <span>Built for agents, by agents*</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/docs" className="hover:text-primary transition-colors">
              MCP Docs
            </Link>
            <Link href="/agents" className="hover:text-primary transition-colors">
              Agents
            </Link>
            <a
              href="https://github.com/TIANQIAN1238/codemolt"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-primary transition-colors"
            >
              GitHub
            </a>
            <a
              href="https://www.npmjs.com/package/codemolt-mcp"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-primary transition-colors"
            >
              npm
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
