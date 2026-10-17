// PreToolUse guard for Bash. Claude may only:
//  - push with `git push [-u] origin pre-dev` (no other branch, no force, no --no-verify)
//  - run read-only Vercel commands (ls, inspect, logs, whoami, env ls, project ls/inspect)
// Deploys happen through git (push to pre-dev → Vercel preview); production is released
// by a human through a pull request. This is a best-effort check on the command text:
// GitHub branch protection on the production branch is the real barrier.
import { readFileSync } from 'fs'

const command = JSON.parse(readFileSync(0, 'utf-8')).tool_input?.command ?? ''

function deny(reason) {
  console.log(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  }))
  process.exit(0)
}

// Text up to the next shell separator or quote
const ARGS = String.raw`([^;&|\n"'\x60)]*)`

// `git [global options] push <args>` — global options (e.g. -C dir, --no-pager) are skipped
const gitPush = new RegExp(String.raw`\bgit(?:\s+-{1,2}[^\s;&|]+(?:\s+[^-\s;&|][^\s;&|]*)?)*\s+push\b` + ARGS, 'g')
for (const [, rawArgs] of command.matchAll(gitPush)) {
  const args = rawArgs.trim().replace(/\s+/g, ' ')
  if (!/^(?:(?:-u|--set-upstream) )?origin (?:HEAD:)?pre-dev$/.test(args)) {
    deny(`Only "git push origin pre-dev" is allowed in this project (got "git push ${args}"). `
      + 'Production is released by a human through a pull request dev → prod.')
  }
}

// `vercel <subcommand> …`, also through npx / bunx / pnpm dlx
const vercel = new RegExp(String.raw`(?:^|[\s;&|(\x60"'])(?:npx\s+|bunx\s+|pnpm\s+dlx\s+)?vercel(?:@\S+)?(?=\s|$)` + ARGS, 'g')
const FLAGS_WITH_VALUE = new Set(['--scope', '-S', '--cwd', '--token', '-t', '-A', '--local-config', '-Q', '--global-config', '--team', '-T'])
const READ_ONLY = { ls: true, list: true, inspect: true, logs: true, whoami: true, help: true, env: ['ls', 'list'], project: ['ls', 'list', 'inspect'] }
for (const [, rawArgs] of command.matchAll(vercel)) {
  const tokens = rawArgs.trim().split(/\s+/).filter(Boolean)
  if (tokens.some((t) => t === '--version' || t === '-v' || t === '--help' || t === '-h')) continue
  const positional = tokens.filter((t, i) => !t.startsWith('-') && !FLAGS_WITH_VALUE.has(tokens[i - 1]))
  const [sub, action] = positional
  const allowed = READ_ONLY[sub]
  const ok = allowed === true || (Array.isArray(allowed) && allowed.includes(action))
  if (!ok || tokens.some((t) => t === '--prod' || t.startsWith('--target'))) {
    deny(`"vercel ${tokens.join(' ')}" is not allowed: only read-only Vercel commands (ls, inspect, logs, whoami, env ls, project ls/inspect). `
      + 'Deploy by pushing to the pre-dev branch; production is released by a human.')
  }
}
