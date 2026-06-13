/* Minimal colored logger for the nexus CLI. No deps, mirrors scripts/lib/log.ts. */
const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};

export const log = {
  title: (s: string) => console.log(`\n${c.bold}${c.cyan}━━ ${s} ━━${c.reset}`),
  step: (s: string) => console.log(`${c.cyan}▸${c.reset} ${s}`),
  ok: (s: string) => console.log(`  ${c.green}✔${c.reset} ${s}`),
  warn: (s: string) => console.log(`  ${c.yellow}⚠${c.reset} ${s}`),
  fail: (s: string) => console.log(`  ${c.red}✗${c.reset} ${s}`),
  info: (s: string) => console.log(`  ${c.dim}${s}${c.reset}`),
  arrow: (s: string) => console.log(`  ${c.cyan}➜${c.reset}  ${s}`),
  plain: (s: string) => console.log(s),
};

/** A CLI error whose message is printed without a stack trace. */
export class CliError extends Error {}
