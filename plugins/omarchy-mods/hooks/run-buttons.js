// Run-it-for-me buttons: commands a reply tells the user to run open typed, not run, in a new terminal
import { terminalArgv } from './adapter.js'

const MAX = 3
const SHELL_LANGS = ['bash', 'sh', 'shell', 'zsh', 'console']
const CUE = /\b(run|type|execute|paste|enter)\b/i

// Commands Claude ran itself this session, so a reply that shows them gets no button
const ran = new Set()
// The last reply's commands, offered in the band with digit hotkeys
let latest = []
let launched = ''

function norm(cmd) {
  return cmd.replace(/\s+/g, ' ').trim()
}

function looksLikeCommand(cmd) {
  return /^(sudo\s+)?[a-z0-9][a-z0-9._+-]*(\s|$)/.test(cmd) && cmd.length >= 3 && cmd.length <= 300 && !cmd.includes('<<')
}

// Finds commands the reply tells the user to run: shell code blocks, and inline code after a run/type cue
export function extractCommands(text) {
  const found = []
  for (const m of text.matchAll(/```([a-zA-Z]*)[^\n]*\n([\s\S]*?)```/g)) {
    if (!SHELL_LANGS.includes(m[1].toLowerCase())) continue
    const lines = m[2].replace(/\\\n\s*/g, ' ').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    // A long block is a script, not a command to hand over line by line
    if (lines.length > 4) continue
    for (let line of lines) {
      if (m[1].toLowerCase() === 'console') {
        if (!line.startsWith('$ ')) continue
      }
      line = line.replace(/^\$\s+/, '')
      if (looksLikeCommand(line)) found.push(norm(line))
    }
  }
  const prose = text.replace(/```[\s\S]*?```/g, '')
  for (const sentence of prose.split(/(?<=[.!?:])\s+|\n/)) {
    if (!CUE.test(sentence)) continue
    for (const m of sentence.matchAll(/`([^`\n]+)`/g)) {
      const cmd = norm(m[1].replace(/^\$\s+/, ''))
      if (looksLikeCommand(cmd) && cmd.includes(' ')) found.push(cmd)
    }
  }
  // Also skip a part of a command Claude ran: a reply that quotes `yay -S --noconfirm` from `yay -S --noconfirm pkg`
  return [...new Set(found)].filter(c => ![...ran].some(r => r === c || r.startsWith(c + ' '))).slice(0, MAX)
}

async function launch($, cmd) {
  launched = cmd
  $.ui.invalidate('ui.render')
  try {
    const r = await $.process.run(terminalArgv($.plugin.root, cmd), { timeoutMs: 15000 })
    if (r.exitCode !== 0) $.ui.toast('Could not open a terminal: ' + (r.stderr || r.exitCode))
    else $.ui.toast('Opened in a terminal, not run yet: ' + cmd)
  } catch (err) {
    $.ui.toast('Could not open a terminal: ' + String(err && err.message ? err.message : err))
  }
}

function short(cmd) {
  return cmd.length > 50 ? cmd.slice(0, 47) + '...' : cmd
}

export function registerRunButtons(on, options) {

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    ran.add(norm(e.command))
    return next(e)
  })

  on('turn.complete', { isAborted: false }, async ($, e, next) => {
    if (e.agentId === undefined && !e.isAborted) {
      latest = extractCommands(e.answer || '')
      launched = ''
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    latest = []
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary) return next(e)
    const cmds = extractCommands(e.props.text || '')
    if (!cmds.length) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const reply = await next(e)
    return Box({
      flexDirection: 'column',
      children: [
        reply,
        Box({
          flexDirection: 'row',
          columnGap: 2,
          children: [
            Text({ dimColor: true, children: ['Open in a terminal:'] }),
            ...cmds.map((cmd, i) => Button({ key: 'run-' + i, label: short(cmd), onPress: () => launch($, cmd) })),
          ],
        }),
      ],
    })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!latest.length) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const below = await next(e)
    return Box({
      flexDirection: 'column',
      children: [
        Box({
          flexDirection: 'row',
          columnGap: 2,
          children: [
            Text({ color: 'suggestion', children: [launched ? 'Opened: ' + short(launched) : 'Run it yourself:'] }),
            ...latest.map((cmd, i) => Button({ key: 'band-run-' + i, label: short(cmd), hotkey: String(i + 1), plain: true, onPress: () => launch($, cmd) })),
          ],
        }),
        ...(below ? [below] : []),
      ],
    })
  })
}
