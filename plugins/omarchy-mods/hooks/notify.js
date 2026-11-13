// Notify when Claude needs you: a desktop notification at turn end, and Approve/Deny buttons before a permission prompt
import { decideArgv, dismissArgv, notifyArgv, windowArgv } from './adapter.js'

const ASK_TITLE = 'Claude needs your OK'
const DONE_TITLE = 'Claude finished'

// The pending question, or null; decision is 'approve', 'deny' or 'prompt'
let pending = null

function summary(tool, input) {
  if (input && typeof input.command === 'string') return tool + ': ' + input.command
  if (input && typeof input.file_path === 'string') return tool + ': ' + input.file_path
  return tool
}

function cut(text, n) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim()
  return flat.length > n ? flat.slice(0, n - 3) + '...' : flat
}

// The reply as plain text for a notification body: no code fences, backticks or bold marks
function plain(text) {
  return String(text || '').replace(/```[a-z]*\n?/gi, '').replace(/`/g, '').replace(/\*\*/g, '').replace(/^#+\s*/gm, '')
}

// The terminal window Claude runs in, for the Focus button; found at send time, so no env var is needed
async function windowAddress($) {
  try {
    const r = await $.process.run(windowArgv($.plugin.root), { timeoutMs: 5000 })
    const address = r.stdout.trim()
    return /^address:0x[0-9a-f]+$/.test(address) ? address : null
  } catch {
    return null
  }
}

// Takes our cards off the screen; a card whose button was pressed is gone already, so 'none' is fine
async function dismiss($, title) {
  try {
    await $.process.run(dismissArgv(title), { timeoutMs: 5000 })
  } catch (err) {
    $.ui.log('notify: dismiss failed: ' + String(err && err.message ? err.message : err))
  }
}

async function send($, argv) {
  try {
    const r = await $.process.run(argv, { timeoutMs: 10000 })
    if (r.exitCode !== 0) $.ui.log('notify: ' + argv[0] + ' exited ' + r.exitCode + ': ' + cut(r.stderr, 200))
  } catch (err) {
    $.ui.log('notify: ' + argv[0] + ' failed: ' + String(err && err.message ? err.message : err))
  }
}

// Sends the notification and waits for Approve, Deny or Focus from it or from the band
async function askByNotification($, what, waitMs, signal) {
  const tmp = ((await $.env.get('TMPDIR')) || '/tmp/').replace(/\/?$/, '/')
  const file = tmp + 'omarchy-mods-decision-' + (await $.clock.now())
  pending = { what, decision: null }
  $.ui.invalidate('ui.render')
  const root = $.plugin.root
  const win = await windowAddress($)
  await send($, notifyArgv({
    title: ASK_TITLE,
    body: cut(what, 200),
    urgency: 'critical',
    actions: [
      { label: 'Approve', argv: decideArgv(root, 'approve', win) },
      { label: 'Deny', argv: decideArgv(root, 'deny', win) },
      { label: 'Focus', argv: decideArgv(root, 'prompt', win) },
    ],
    withArgs: [file],
  }))
  const started = await $.clock.now()
  // Waiting inside $.process.run keeps the wait off the hook's 10 second budget
  while (!pending.decision && !signal.aborted && (await $.clock.now()) - started < waitMs) {
    await $.process.run(['sleep', '0.3'])
    if (await $.fs.exists(file)) pending.decision = (await $.fs.read(file)).trim()
  }
  const how = pending.decision || 'timeout'
  pending = null
  $.ui.invalidate('ui.render')
  await $.process.run(['rm', '-f', file])
  // A button on the card closes it; an answer in the terminal, a band digit or the timeout leaves it up
  await dismiss($, ASK_TITLE)
  return how
}

function answer(decision) {
  if (pending && !pending.decision) pending.decision = decision
}

export function registerNotify(on, options) {
  const waitMs = Number(options.approve_wait_seconds || 90) * 1000

  on('turn.complete', { isAborted: false }, async ($, e, next) => {
    if (e.agentId === undefined && !e.isAborted) {
      // Not awaited: the turn ends without waiting for the notification
      ;(async () => {
        const win = await windowAddress($)
        // One finished card at a time: the last turn's card goes before the new one shows
        await dismiss($, DONE_TITLE)
        await send($, notifyArgv({
          title: DONE_TITLE,
          body: cut(plain(e.answer), 160),
          urgency: 'normal',
          actions: [{ label: 'Focus', argv: decideArgv($.plugin.root, 'focus', win) }],
        }))
      })()
    }
    return next(e)
  })

  // The person is back at the prompt: the finished card has done its job
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) dismiss($, DONE_TITLE)
    return next(e)
  })

  // Fires only when a permission dialog is about to show: after the rules, tool.check hooks and auto mode's classifier
  on('classic.PermissionRequest', async ($, e, next) => {
    const what = summary(e.tool_name, e.tool_input)
    const how = await askByNotification($, what, waitMs, next.signal)
    // A transcript line; off by default, since it shows on camera (option debug_log)
    if (options.debug_log) $.ui.log('notify: ' + what + ' -> ' + how)
    if (how === 'approve') return { decision: { behavior: 'allow' } }
    if (how === 'deny') return { decision: { behavior: 'deny', message: 'The user denied this from a desktop notification. Ask before trying another way.' } }
    // Focus, no answer, or anything else: the normal permission prompt
    return next(e)
  }).catch(($, e, next) => next(e))

  // The person answered the dialog in the terminal: stop waiting on the notification
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (pending && !pending.decision) pending.decision = 'answered in the terminal'
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!pending) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const below = await next(e)
    return Box({
      flexDirection: 'column',
      children: [
        Box({
          flexDirection: 'row',
          columnGap: 2,
          children: [
            Text({ color: 'permission', children: ['Waiting for your OK (notification sent): ' + cut(pending.what, 60)] }),
            Button({ key: 'n-approve', label: 'Approve', hotkey: '4', plain: true, onPress: () => answer('approve') }),
            Button({ key: 'n-deny', label: 'Deny', hotkey: '5', plain: true, onPress: () => answer('deny') }),
            Button({ key: 'n-prompt', label: 'Show the prompt', hotkey: '6', plain: true, onPress: () => answer('prompt') }),
          ],
        }),
        ...(below ? [below] : []),
      ],
    })
  })
}
