// Package cards: redraws yay/pacman install rows as cards and holds AUR installs for review
import { aurInfoUrl, modeOf, officialSearchUrl, pkgbuildUrl, repoCheckArgv } from './adapter.js'

const PANE = 'aur-review'
// Minutes an AUR install waits for Install or Cancel before it is refused; option aur_hold_minutes
const DEFAULT_HOLD_MINUTES = 3

// tool_use_id -> { pkgs: [{ name, source, info? }], state }
const calls = new Map()
// The call waiting in the review pane, or null
let review = null

// Finds the packages a command installs with yay, paru or pacman -S, or null
export function parseInstall(command) {
  const pkgs = []
  let tool = null
  for (const segment of command.split(/&&|\|\||;|\||\n/)) {
    const words = segment.trim().split(/\s+/).filter(Boolean)
    while (words.length && (words[0] === 'sudo' || /^[A-Z_]+=/.test(words[0]))) words.shift()
    if (!['yay', 'paru', 'pacman'].includes(words[0])) continue
    const op = words.find(w => w.startsWith('-') && !w.startsWith('--'))
    const isSync = words.includes('--sync') || (op && /^-S[a-zA-Z]*$/.test(op) && !/[sicglp]/.test(op.slice(2)))
    if (!isSync) continue
    tool = words[0]
    for (const w of words.slice(1)) if (!w.startsWith('-')) pkgs.push(w)
  }
  return pkgs.length ? { tool, pkgs } : null
}

// 'official', 'aur', 'missing', or 'unknown' with a reason; the one function Omarchy swaps
async function classify($, mode, name) {
  if (name.includes('/')) return { source: 'official' }
  // Test seam: point the lookups at another host to make the network fail
  const arch = (await $.env.get('OMARCHY_MODS_ARCH_HOST')) || undefined
  const aurHost = (await $.env.get('OMARCHY_MODS_AUR_HOST')) || undefined
  try {
    if (mode === 'omarchy') {
      const r = await $.process.run(repoCheckArgv(name), { timeoutMs: 10000 })
      // Omarchy's own repo carries some packages the AUR also has (google-chrome): name the repo on the card
      if (r.exitCode === 0) return { source: 'official', repo: (r.stdout.match(/^Repository\s*:\s*(\S+)/m) || [])[1] }
    } else {
      const r = await $.http.fetch(officialSearchUrl(name, arch))
      if (!r.ok) return { source: 'unknown', reason: 'archlinux.org answered ' + r.status }
      if (JSON.parse(r.text).results.length > 0) return { source: 'official' }
    }
    const aur = await $.http.fetch(aurInfoUrl([name], aurHost))
    if (!aur.ok) return { source: 'unknown', reason: 'the AUR answered ' + aur.status }
    const found = JSON.parse(aur.text).results[0]
    return found ? { source: 'aur', info: found } : { source: 'missing' }
  } catch (err) {
    return { source: 'unknown', reason: String(err && err.message ? err.message : err) }
  }
}

async function fetchPkgbuild($, pkgbase, file) {
  try {
    const r = await $.http.fetch(pkgbuildUrl(pkgbase, undefined, file))
    return r.ok ? r.text : 'Could not load the PKGBUILD: the AUR answered ' + r.status
  } catch (err) {
    return 'Could not load the PKGBUILD: ' + String(err && err.message ? err.message : err)
  }
}

// Top-level NAME=value lines of a PKGBUILD, to read $pkgver and friends in the source URLs
function scalarsOf(text) {
  const vars = {}
  // In file order, so url="https://github.com/x/$pkgname" reads the pkgname set above it
  for (const m of text.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)=(?:'([^']*)'|"([^"`]*)"|([^\s'"()`;]+))\s*(?:#.*)?$/gm)) {
    vars[m[1]] = m[2] ?? expand(m[3] ?? m[4] ?? '', vars)
  }
  return vars
}

function expand(text, vars) {
  text = text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(%%?|##?)([^}*?[]*)\}/g, (all, name, op, pat) => {
    const v = vars[name]
    if (v === undefined) return all
    if (op[0] === '%') return v.endsWith(pat) ? v.slice(0, v.length - pat.length) : v
    return v.startsWith(pat) ? v.slice(pat.length) : v
  })
  return text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (all, a, b) => vars[a || b] ?? all)
}

// The words of a NAME=( ... ) array, which may run over several lines
function arrayOf(text, name) {
  const m = text.match(new RegExp('^' + name + '=\\(([\\s\\S]*?)\\)', 'm'))
  if (!m) return null
  const words = []
  for (const w of m[1].matchAll(/'([^']*)'|"([^"]*)"|([^\s'"#]+)|#[^\n]*/g)) {
    if (w[0].startsWith('#')) continue
    words.push(w[1] ?? w[2] ?? w[3])
  }
  return words
}

// The commands inside the functions a name pattern picks: no blank lines, no comments; a line that a
// backslash continues gets its next line indented under it
function functionLines(text, names) {
  const out = []
  const re = new RegExp('^(' + names + ')\\s*\\(\\)\\s*\\{([\\s\\S]*?)^\\}', 'gm')
  for (const m of text.matchAll(re)) {
    const lines = []
    let isContinued = false
    for (const raw of m[2].split('\n')) {
      const l = raw.trim()
      if (!l || l.startsWith('#')) continue
      lines.push((isContinued ? '  ' : '') + l)
      isContinued = l.endsWith('\\')
    }
    out.push({ name: m[1], lines })
  }
  return out
}

const BUILD_FUNCTIONS = '(?:prepare|build|check|package|pkgver)(?:_[A-Za-z0-9_.-]+)?'
const INSTALL_FUNCTIONS = '(?:pre|post)_(?:install|upgrade|remove)'

// A line worth a second look in a build: fetches, root, piping into a shell, deletes
const RISKY = /\b(curl|wget|git clone|sudo|eval|base64 -d|npm (?:i|install)|pip3? install|cargo install|go install)\b|\|\s*(?:ba|z)?sh\b|rm -rf\s+[\/~]|chmod [0-7]*7[0-7]*\b|(?<![\w}"'])\/etc\/|systemctl|useradd|setcap/

// What a reviewer reads first: where the files come from, whether they are checked, what runs as the build
export function reviewOf(pkgbuild, installText) {
  const text = String(pkgbuild || '')
  const vars = scalarsOf(text)
  const sources = []
  for (const name of ['source', 'source_x86_64']) for (const w of arrayOf(text, name) || []) sources.push(expand(w, vars))
  const sums = []
  for (const kind of ['b2sums', 'sha512sums', 'sha256sums', 'sha1sums', 'md5sums', 'cksums']) {
    for (const suffix of ['', '_x86_64']) {
      const list = arrayOf(text, kind + suffix)
      if (!list) continue
      const skipped = list.filter(h => h === 'SKIP').length
      sums.push({ kind: kind + suffix, count: list.length, skipped })
    }
  }
  const installName = (text.match(/^install=["']?([^"'\s]+)/m) || [])[1]
  const install = installName ? expand(installName, vars) : null
  const risky = f => ({ name: f.name, lines: f.lines.map(l => ({ text: expand(l, vars), isRisky: RISKY.test(l) })) })
  const hooks = installText ? functionLines(String(installText), INSTALL_FUNCTIONS).map(risky) : []
  const steps = functionLines(text, BUILD_FUNCTIONS).map(f => ({ name: f.name, lines: f.lines.map(l => ({ text: expand(l, vars), isRisky: RISKY.test(l) })) }))
  return { sources, sums, install, hooks, steps, lineCount: text.split('\n').length }
}

function dateOf(seconds) {
  return seconds ? new Date(seconds * 1000).toISOString().slice(0, 10) : 'unknown'
}

// The review at a glance, for the card in the transcript: four short lines per AUR package
function summaryRows(Box, Text, p) {
  if (!p.info) return []
  const i = p.info
  const r = p.review || { sources: [], sums: [], install: null, steps: [] }
  const remote = r.sources.filter(src => src.includes('://'))
  const host = remote.length ? remote[0].replace(/^.*?::/, '').replace(/^[a-z+]+:\/\//, '').split('/')[0] : null
  const local = r.sources.length - remote.length
  const flagged = r.steps.flatMap(st => st.lines).concat((r.hooks || []).flatMap(h => h.lines)).filter(l => l.isRisky)
  const skipped = r.sums.reduce((n, c) => n + c.skipped, 0)
  const line = (key, label, text, color) => Box({ key: p.name + key, flexDirection: 'row', columnGap: 1, children: [Text({ dimColor: true, children: [label] }), Text({ ...(color ? { color } : {}), children: [text] })] })
  return [
    line('-who', '  maintainer', (i.Maintainer || 'none (orphaned)') + ' · ' + i.NumVotes + ' votes · updated ' + dateOf(i.LastModified), i.Maintainer ? undefined : 'warning'),
    line('-src', '  downloads ', (host ? remote.length + ' from ' + host : 'none') + (local ? ' · ' + local + ' file(s) in the AUR repo' : '')),
    line('-sum', '  checksums ', !r.sums.length ? 'none' : skipped ? skipped + ' SKIP' : 'all set', !r.sums.length || skipped ? 'warning' : 'success'),
    line('-run', '  build     ', r.steps.reduce((n, st) => n + st.lines.length, 0) + ' lines' + (r.install ? ' · install script runs as root' : '') + (flagged.length ? ' · ' + flagged.length + ' flagged' : ''), flagged.length || r.install ? 'warning' : undefined),
  ]
}

function decide(decision) {
  if (review && !review.decision) review.decision = decision
}

export function registerPackageCards(on, options) {
  const mode = modeOf(options)
  const holdMinutes = Number(options.aur_hold_minutes) > 0 ? Number(options.aur_hold_minutes) : DEFAULT_HOLD_MINUTES
  const holdMs = holdMinutes * 60 * 1000

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const parsed = parseInstall(e.command)
    if (!parsed) return next(e)
    const entry = { tool: parsed.tool, pkgs: parsed.pkgs.map(name => ({ name, source: 'checking' })), state: 'checking' }
    calls.set(e.tool_use_id, entry)
    $.ui.invalidate('ui.render')
    entry.pkgs = await Promise.all(parsed.pkgs.map(async name => ({ name, ...(await classify($, mode, name)) })))
    const missing = entry.pkgs.filter(p => p.source === 'missing')
    // A package in neither the repos nor the AUR is refused, so Claude checks the name instead of running a failing install
    if (missing.length) {
      entry.state = 'notfound'
      $.ui.invalidate('ui.render')
      return { deny: 'The install was not run: ' + missing.map(p => p.name).join(', ') + ' is not in the official repos or the AUR. Check the package name with the user.' }
    }
    const held = entry.pkgs.filter(p => p.source === 'aur' || p.source === 'unknown')
    if (!held.length) {
      entry.state = 'passed'
      $.ui.invalidate('ui.render')
      return next(e)
    }
    entry.state = 'held'
    for (const p of held) if (p.info) {
      p.pkgbuild = await fetchPkgbuild($, p.info.PackageBase)
      const first = reviewOf(p.pkgbuild)
      // The install script runs as root when pacman installs the package: fetch it too
      p.review = first.install ? reviewOf(p.pkgbuild, await fetchPkgbuild($, p.info.PackageBase, first.install)) : first
    }
    review = { id: e.tool_use_id, command: e.command, pkgs: held, decision: null }
    $.ui.invalidate('ui.render')
    await $.ui.open({ id: PANE, title: 'AUR review', focus: true, rows: 30 })
    const started = await $.clock.now()
    // Waiting inside $.process.run keeps the hold off the hook's 10 second budget
    while (!review.decision && !next.signal.aborted && (await $.clock.now()) - started < holdMs) {
      await $.process.run(['sleep', '0.3'])
    }
    const decision = review.decision || 'timeout'
    review = null
    await $.ui.close({ id: PANE })
    entry.state = decision === 'install' ? 'approved' : 'cancelled'
    $.ui.invalidate('ui.render')
    if (decision === 'install') return next(e)
    const names = held.map(p => p.name).join(', ')
    const why = decision === 'timeout' ? 'nobody answered the review within ' + holdMinutes + (holdMinutes === 1 ? ' minute' : ' minutes') : 'the user pressed Cancel'
    return { deny: 'The install was not run: ' + why + ' after reviewing the AUR package(s) ' + names + '. Do not retry it; ask the user what to do instead.' }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'The AUR review failed, so the install was not run.' }))

  // The fullscreen layout folds tool rows into one count line ('Ran 2 shell commands'): unfold a group that
  // holds an install call, so its row and card draw (found on the capture box, 2026-11-13)
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const isOurs = !e.props.isExpanded && e.props.calls.some(c => c.tool === 'Bash' && c.tool_use_id && calls.has(c.tool_use_id))
    return next(isOurs ? { ...e, props: { ...e.props, isExpanded: true } } : e)
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const entry = e.props.tool === 'Bash' && calls.get(e.props.tool_use_id)
    if (!entry) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const row = await next(e)
    const label = { official: 'repo', aur: 'AUR', missing: 'not found', unknown: 'lookup failed', checking: 'checking' }
    const color = { official: 'success', aur: 'warning', missing: 'error', unknown: 'warning', checking: 'subtle' }
    const status = { checking: 'checking sources', passed: 'repo packages, no hold', notfound: 'package not found, install refused', held: 'held for review', approved: 'approved after review', cancelled: 'cancelled after review' }
    return Box({
      flexDirection: 'column',
      children: [
        row,
        Box({
          borderStyle: 'round',
          borderColor: entry.state === 'held' ? 'warning' : entry.state === 'notfound' ? 'error' : 'subtle',
          flexDirection: 'column',
          paddingX: 1,
          children: [
            Text({ weight: 'semibold', children: [entry.tool + ' install: ' + status[entry.state]] }),
            ...entry.pkgs.flatMap(p => [
              Box({
                key: 'pkg-' + p.name,
                flexDirection: 'row',
                columnGap: 1,
                children: [Text({ children: [p.name] }), Text({ color: color[p.source], children: [p.source === 'official' && p.repo ? p.repo + ' repo' : label[p.source]] })],
              }),
              ...(entry.state === 'held' ? summaryRows(Box, Text, p) : []),
            ]),
            ...(entry.state === 'held' ? [Text({ key: 'keys', dimColor: true, children: ['7: Review  8: Install  9: Cancel'] })] : []),
          ],
        }),
      ],
    })
  })

  // Laid out for a small terminal (85x19 on the 4K desktop at font 18): buttons first, then what the build
  // downloads, whether it checks it, and the commands it runs; the full PKGBUILD last. The body scrolls.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const { Box, Text, Button, Code } = $.ui.resolve(e)
    if (!review) return Text({ dimColor: true, children: ['No install is waiting for review.'] })
    const heading = (key, text) => Text({ key, weight: 'semibold', children: [text] })
    const blocks = review.pkgs.map(p => {
      if (!p.info) return Text({ key: 'u-' + p.name, color: 'warning', children: [p.name + ': could not check the source (' + p.reason + '). Review before you install.'] })
      const i = p.info
      const r = p.review || { sources: [], sums: [], install: null, steps: [], lineCount: 0 }
      const rows = [
        Box({
          key: 'title',
          flexDirection: 'row',
          flexWrap: 'wrap',
          columnGap: 1,
          children: [
            Text({ weight: 'semibold', children: [i.Name + ' ' + i.Version] }),
            Text({ color: 'warning', children: ['AUR'] }),
            Text({ children: ['· ' + i.NumVotes + ' votes · ' + (i.Maintainer || 'orphaned') + ' · updated ' + dateOf(i.LastModified)] }),
            ...(i.OutOfDate ? [Text({ color: 'error', children: ['· flagged out of date'] })] : []),
          ],
        }),
      ]
      rows.push(heading('h-src', 'Downloads'))
      if (!r.sources.length) rows.push(Text({ key: 'src-none', dimColor: true, children: ['  none listed'] }))
      r.sources.forEach((src, n) => rows.push(Text({ key: 'src-' + n, children: ['  ' + src] })))
      const sumText = r.sums.length
        ? r.sums.map(c => c.kind + ' ' + (c.count - c.skipped) + '/' + c.count + (c.skipped ? ' (' + c.skipped + ' SKIP)' : '')).join(' · ')
        : 'none'
      const sumsWeak = !r.sums.length || r.sums.every(c => c.skipped === c.count)
      rows.push(Box({ key: 'sums', flexDirection: 'row', columnGap: 1, children: [Text({ weight: 'semibold', children: ['Checksums'] }), Text({ color: sumsWeak ? 'warning' : 'success', children: [sumText] })] }))
      if (r.install) {
        rows.push(Box({ key: 'inst', flexDirection: 'row', columnGap: 1, children: [Text({ weight: 'semibold', children: ['Install script'] }), Text({ color: 'warning', children: [r.install + ', runs as root'] })] }))
        for (const hook of r.hooks || []) {
          rows.push(Text({ key: 'ih-' + hook.name, dimColor: true, children: ['  ' + hook.name + '()'] }))
          hook.lines.forEach((l, n) => rows.push(Text({ key: 'ih-' + hook.name + '-' + n, ...(l.isRisky ? { color: 'warning' } : {}), children: ['    ' + l.text] })))
        }
      }
      for (const step of r.steps) {
        rows.push(heading('h-' + step.name, step.name + '()'))
        step.lines.forEach((l, n) => rows.push(Text({ key: step.name + '-' + n, ...(l.isRisky ? { color: 'warning' } : {}), children: ['  ' + l.text] })))
      }
      rows.push(Text({ key: 'h-full', dimColor: true, children: ['Full PKGBUILD, ' + r.lineCount + ' lines (scroll):'] }))
      rows.push(Code({ key: 'code', source: p.pkgbuild || '', language: 'bash', path: 'PKGBUILD' }))
      return Box({ key: 'p-' + p.name, flexDirection: 'column', children: rows })
    })
    return Box({
      flexDirection: 'column',
      children: [
        Box({
          key: 'buttons',
          flexDirection: 'row',
          columnGap: 2,
          children: [
            Button({ key: 'install', label: 'i: Install', hotkey: 'i', variant: 'primary', onPress: () => decide('install') }),
            Button({ key: 'cancel', label: 'c: Cancel', hotkey: 'c', onPress: () => decide('cancel') }),
            Text({ dimColor: true, children: ['PgDn: more · refused in ' + holdMinutes + ' min'] }),
          ],
        }),
        ...blocks,
      ],
    })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!review) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const below = await next(e)
    return Box({
      flexDirection: 'column',
      children: [
        Box({
          flexDirection: 'row',
          columnGap: 2,
          children: [
            Text({ color: 'warning', children: ['Install held for review: ' + review.pkgs.map(p => p.name).join(', ')] }),
            Button({ key: 'aur-show', label: 'Show review', hotkey: '7', plain: true, onPress: () => $.ui.open({ id: PANE, title: 'AUR review', focus: true, rows: 30 }) }),
            Button({ key: 'aur-install', label: 'Install', hotkey: '8', plain: true, onPress: () => decide('install') }),
            Button({ key: 'aur-cancel', label: 'Cancel', hotkey: '9', plain: true, onPress: () => decide('cancel') }),
          ],
        }),
        ...(below ? [below] : []),
      ],
    })
  })
}
