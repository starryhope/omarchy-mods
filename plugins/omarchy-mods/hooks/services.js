// Services pane: background servers Claude started, with Open and Stop
import { listeningArgv, modeOf, webappArgv } from './adapter.js'

const PANE = 'services'
const SERVER = /\b(http\.server|serve|server|runserver|dev|start|preview|vite|next|uvicorn|gunicorn|flask\s+run|rails\s+s|php\s+-S|hugo|jekyll|astro|wrangler)\b/

// taskId -> { taskId, command, port, url, startedAt, state, outputPath }
const services = new Map()
let now = 0

// Guesses a port from the command text
export function portOf(command) {
  const m =
    command.match(/http\.server\s+(\d{2,5})/) ||
    command.match(/--port[ =](\d{2,5})/) ||
    command.match(/(?:^|\s)-p\s+(\d{2,5})/) ||
    command.match(/\bPORT=(\d{2,5})/) ||
    command.match(/localhost:(\d{2,5})/) ||
    command.match(/127\.0\.0\.1:(\d{2,5})/)
  if (m) return Number(m[1])
  return /http\.server/.test(command) ? 8000 : null
}

function urlIn(text) {
  const m = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::\])(?::\d+)?[^\s'")]*/)
  return m ? m[0].replace('0.0.0.0', 'localhost').replace('[::]', 'localhost') : null
}

function age(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? s + 's' : s < 3600 ? Math.floor(s / 60) + 'm ' + (s % 60) + 's' : Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm'
}

// Keeps the list in $.store for this session, so a reload of the mod does not forget running servers
async function save($) {
  await $.store.set('services-' + (await $.session.id()), [...services.values()])
}

async function load($) {
  const saved = await $.store.get('services-' + (await $.session.id()))
  if (Array.isArray(saved)) for (const s of saved) services.set(s.taskId, s)
}

function running() {
  return [...services.values()].filter(s => s.state === 'running')
}

async function refresh($, mode) {
  now = await $.clock.now()
  const live = running()
  if (!live.length) return
  for (const s of live) {
    if (!s.url && s.outputPath) {
      try {
        const found = urlIn(await $.fs.read(s.outputPath))
        if (found) {
          s.url = found
          s.port = s.port || Number((found.match(/:(\d+)/) || [])[1]) || null
        }
      } catch {}
    }
  }
  try {
    const r = await $.process.run(listeningArgv(mode), { timeoutMs: 5000 })
    for (const s of live) if (s.port) s.listening = new RegExp('[:.]' + s.port + '\\b').test(r.stdout)
  } catch {}
  $.ui.invalidate('ui.render')
}

async function stop($, s) {
  s.state = 'stopping'
  $.ui.invalidate('ui.render')
  try {
    const r = await $.tool.call({ tool: 'TaskStop', task_id: s.taskId, consent: 'The user pressed Stop on ' + s.command + ' in the services pane' })
    if (!r.deny && !r.isError) {
      s.state = 'stopped'
      $.ui.invalidate('ui.render')
      await save($)
      return
    }
    $.ui.log('services: TaskStop did not stop ' + s.taskId + ': ' + (r.deny || r.text))
  } catch (err) {
    $.ui.log('services: TaskStop failed: ' + String(err && err.message ? err.message : err))
  }
  // Fallback: ask Claude to stop it
  s.state = 'running'
  $.ui.invalidate('ui.render')
  await $.prompt.submit({ text: 'Stop the background task ' + s.taskId + ' (' + s.command + ') with TaskStop. The user pressed Stop in the services pane.' })
}

async function openUrl($, s) {
  const url = s.url || 'http://localhost:' + s.port + '/'
  try {
    const r = await $.process.run(webappArgv(url), { timeoutMs: 15000 })
    $.ui.toast(r.exitCode === 0 ? 'Opened ' + url : 'Could not open ' + url + ': ' + r.stderr)
  } catch (err) {
    $.ui.toast('Could not open ' + url + ': ' + String(err && err.message ? err.message : err))
  }
}

export function registerServices(on, options) {
  const mode = modeOf(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'services', description: 'Show the servers Claude started in the background', immediate: true })
    await load($)
    $.clock.every(5000, () => refresh($, mode))
    return next(e)
  })

  on('command.run', { command: 'services' }, async ($) => {
    await refresh($, mode)
    await $.ui.open({ id: PANE, title: 'Services', focus: true, closeOnEscape: true })
    return {}
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e)
    const taskId = result && result.result && result.result.backgroundTaskId
    if (!taskId) return result
    const port = portOf(e.command)
    const text = (result.text || '') + '\n' + (result.result.stdout || '')
    if (!port && !SERVER.test(e.command) && !urlIn(text)) return result
    const path = (text.match(/(\/[^\s'"]+\.output)\b/) || [])[1] || null
    services.set(taskId, { taskId, command: e.command, port, url: urlIn(text), startedAt: await $.clock.now(), state: 'running', outputPath: path })
    await save($)
    await refresh($, mode)
    $.ui.toast('Server started in the background: ' + e.command + ' (run /services)')
    return result
  })

  // Claude stopped one itself
  on('tool.call', { tool: ['TaskStop', 'KillShell'] }, async ($, e, next) => {
    const result = await next(e)
    const s = services.get(e.task_id || e.shell_id)
    if (s && !result.deny && !result.isError) s.state = 'stopped'
    await save($)
    $.ui.invalidate('ui.render')
    return result
  })

  // A background task that ended on its own
  on('session.receive', async ($, e, next) => {
    for (const s of running()) {
      if (e.text && e.text.includes(s.taskId) && /(completed|failed|exited|killed|stopped)/i.test(e.text)) s.state = 'stopped'
    }
    await save($)
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const all = [...services.values()]
    if (!all.length) return Text({ dimColor: true, children: ['No servers started in this session.'] })
    return Box({
      flexDirection: 'column',
      rowGap: 1,
      children: all.map((s, i) =>
        Box({
          key: 'svc-' + s.taskId,
          flexDirection: 'column',
          children: [
            Box({
              flexDirection: 'row',
              columnGap: 1,
              children: [
                Text({ color: s.state === 'running' ? (s.listening === false ? 'warning' : 'success') : 'subtle', children: [s.state === 'running' && s.listening === false ? 'not listening' : s.state] }),
                Text({ weight: 'semibold', children: [s.command] }),
              ],
            }),
            Text({ dimColor: true, children: [(s.url || (s.port ? 'port ' + s.port : 'no port seen')) + ' · up ' + age(now - s.startedAt) + ' · task ' + s.taskId] }),
            s.state === 'running'
              ? Box({
                  flexDirection: 'row',
                  columnGap: 2,
                  children: [
                    ...(s.url || s.port ? [Button({ key: 'open-' + s.taskId, label: i === 0 ? 'o: Open' : 'Open', ...(i === 0 ? { hotkey: 'o', autoFocus: true } : {}), onPress: () => openUrl($, s) })] : []),
                    Button({ key: 'stop-' + s.taskId, label: i === 0 ? 's: Stop' : 'Stop', ...(i === 0 ? { hotkey: 's' } : {}), onPress: () => stop($, s) }),
                  ],
                })
              : Text({ dimColor: true, children: [''] }),
          ],
        }),
      ),
    })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const live = running()
    if (!live.length) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const below = await next(e)
    return Box({
      flexDirection: 'column',
      children: [
        Box({
          flexDirection: 'row',
          columnGap: 2,
          children: [
            Text({ color: 'success', children: [live.length + (live.length === 1 ? ' server' : ' servers') + ' running: ' + live.map(s => s.url || s.port || s.taskId).join(', ')] }),
            Button({ key: 'svc-open-pane', label: 'Services', hotkey: '0', plain: true, onPress: () => $.ui.open({ id: PANE, title: 'Services', focus: true, closeOnEscape: true }) }),
          ],
        }),
        ...(below ? [below] : []),
      ],
    })
  })
}
