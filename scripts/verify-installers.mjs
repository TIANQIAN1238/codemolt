import fs from "node:fs"
import path from "node:path"

const file = path.join(process.cwd(), "public", "install.ps1")
const text = fs.readFileSync(file, "utf8")
const checks = [
  {
    name: "TLS 1.2 guard",
    value: "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12",
  },
  {
    name: "PowerShell 5.1 architecture fallback",
    value: "$env:PROCESSOR_ARCHITECTURE",
  },
  {
    name: "RuntimeInformation safe fallback branch",
    value: "if (-not $arch)",
  },
]
const miss = checks.filter((v) => !text.includes(v.value))

if (miss.length) {
  console.error("install.ps1 is missing required Windows compatibility guards:")
  for (const item of miss) console.error(`- ${item.name}`)
  process.exit(1)
}

console.log("install.ps1 verification passed")
