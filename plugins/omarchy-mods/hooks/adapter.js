// The one place that names Omarchy commands; fake mode resolves the same names to stand-ins on PATH

export const COMMANDS = {
  notify: 'omarchy-notification-send',
  dismiss: 'omarchy-notification-dismiss',
  terminal: 'omarchy-launch-floating-terminal-with-presentation',
  webapp: 'omarchy-launch-webapp',
}

// 'omarchy' on the real box; 'fake' on any other machine (the default)
export function modeOf(options) {
  return options.adapter === 'omarchy' ? 'omarchy' : 'fake'
}

// Omarchy's own repo test: exit 0 means the package is in a sync repo
export function repoCheckArgv(pkg) {
  return ['pacman', '-Si', '--', pkg]
}

// Fake mode's stand-in for pacman -Si: the official package search
export function officialSearchUrl(pkg, host = 'archlinux.org') {
  return 'https://' + host + '/packages/search/json/?name=' + encodeURIComponent(pkg)
}

export function aurInfoUrl(pkgs, host = 'aur.archlinux.org') {
  return 'https://' + host + '/rpc/v5/info?' + pkgs.map(p => 'arg[]=' + encodeURIComponent(p)).join('&')
}

// The PKGBUILD, or another file of the package's AUR repo (its .install script)
export function pkgbuildUrl(pkgbase, host = 'aur.archlinux.org', file = 'PKGBUILD') {
  return 'https://' + (host || 'aur.archlinux.org') + '/cgit/aur.git/plain/' + encodeURIComponent(file) + '?h=' + encodeURIComponent(pkgbase)
}

// Opens a floating terminal with the command typed at a prompt, not run
export function terminalArgv(root, cmd) {
  return detached([COMMANDS.terminal, root + '/bin/omarchy-mods-prefill', toBase64(cmd)])
}

export function webappArgv(url) {
  return detached([COMMANDS.webapp, url])
}

// Lists listening TCP ports; Linux has ss, macOS has lsof
export function listeningArgv(mode) {
  return mode === 'omarchy' ? ['ss', '-Hltn'] : ['lsof', '-nP', '-iTCP', '-sTCP:LISTEN']
}

// A desktop notification with up to three buttons; each button runs argv plus withArgs.
// `click` names the action a click on the card body runs. omarchy-notification-send always gives the
// body click to the first action, so a stray click on a permission card pressed Approve (found on the
// capture box, 2026-11-13). In omarchy mode the card goes out as the same D-Bus call that command makes,
// with the same hints (omarchy-actions for the buttons, omarchy-exec-argv for the body click), but with
// the body click set to `click`. Fake mode keeps the stand-in command.
export function notifyArgv({ title, body, urgency, actions, withArgs, click }, mode = 'fake') {
  const list = actions || []
  const extra = withArgs || []
  const chosen = list.find(a => a.label === click) || list[0]
  if (mode === 'omarchy' && chosen) {
    const urgencyByte = { low: 0, normal: 1, critical: 2 }[urgency] ?? 1
    const buttons = list.map(a => ({ label: a.label, argv: [...a.argv, ...extra] }))
    const hints = [
      'urgency', 'y', String(urgencyByte),
      'omarchy-actions', 's', JSON.stringify(buttons),
      'omarchy-exec-argv', 's', JSON.stringify([...chosen.argv, ...extra]),
    ]
    // busctl takes each value as one typed parameter, so the title and body stay text;
    // the leading `--` keeps a dash-leading value positional (as in omarchy-notification-send)
    return [
      'busctl', '--user', '--', 'call',
      'org.freedesktop.Notifications', '/org/freedesktop/Notifications',
      'org.freedesktop.Notifications', 'Notify', 'susssasa{sv}i',
      'Claude Code', '0', '', title, body || '',
      '0',
      String(hints.length / 3), ...hints,
      '-1',
    ]
  }
  const argv = [COMMANDS.notify, '-u', urgency || 'normal', '--app-name', 'Claude Code', title, body || '']
  for (const a of list) argv.push('--action', a.label, ...a.argv)
  if (extra.length) argv.push('--with', ...extra)
  return argv
}

// A button's program: the verb, then the Hyprland window to bring forward ('none' when unknown)
export function decideArgv(root, verb, windowAddress) {
  return [root + '/bin/omarchy-mods-decide', verb, windowAddress || 'none']
}

// Takes every card whose summary contains the text off the screen (Omarchy's own command)
export function dismissArgv(summary) {
  return [COMMANDS.dismiss, summary]
}

// Prints `address:0x...` of the terminal window Claude runs in (through tmux too), or nothing
export function windowArgv(root) {
  return [root + '/bin/omarchy-mods-window']
}

function toBase64(text) {
  return new TextEncoder().encode(text).toBase64()
}

// The Omarchy launchers exec the app in the foreground (setsid uwsm-app), so they run as long as the window is open.
// A hook that awaits them runs past its 10 second budget and the window is killed with it: start them in the
// background and return at once (found on the capture box, 2026-11-13)
function detached(argv) {
  return ['sh', '-c', '"$@" </dev/null >/dev/null 2>&1 &', 'sh', ...argv]
}
