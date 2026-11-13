# omarchy-mods

> **These mods are examples. They are not a maintained product.**
>
> - They show how you can build your own Claude Code mods for [Omarchy](https://omarchy.org/). Read them, copy from them, and change them.
> - They are not maintained. Expect no updates, no fixes, and no support. A new Claude Code or Omarchy release can break them.
> - Do not use them in production, at work, or on any system you depend on. Try them on a test system.
> - They were written for a Starry Hope video and tested once, on one machine (Omarchy 4.5.0-3, Claude Code 2.1.323).

A mod is a Claude Code plugin with JavaScript hooks that run inside Claude Code and can draw in
its interface. These four example mods connect Claude Code in a terminal to the Omarchy desktop.

## The four example mods

**Notifications.** When Claude finishes a turn, an Omarchy notification says so, with a Focus
button that brings Claude's terminal forward. When Claude is about to show a permission prompt,
a notification shows Approve, Deny and Focus first, so you can answer from another workspace.
The card goes away once the prompt is answered, from the card or in the terminal. If no one
answers within 90 seconds, the normal prompt stays in the terminal.

**Package cards and the AUR review hold.** A `pacman -S` or `yay -S` install that Claude runs
gets a card that says where each package comes from (the official repos, Omarchy's own repo, or
the AUR). An install that pulls a package from the AUR is held. The card shows the maintainer,
votes, last update, what the build downloads, whether checksums are set, and lines worth a second
look. Press 7 to open the review pane with the full PKGBUILD and any install script, then Install
or Cancel. An install that gets no answer within 3 minutes is refused. A package name that is in
neither the repos nor the AUR is refused, so Claude checks the name instead of running a failing
install.

**Run-it-for-me buttons.** When a reply tells you to run a command yourself (for example one that
needs your sudo password), a button under the reply opens an Omarchy floating terminal with the
command typed at the prompt and not run. Press Enter to run it, or Ctrl+C to drop it. Up to three
buttons show, with digit keys 1 to 3 typed into an empty prompt.

**Services pane.** When Claude starts a dev server in the background, a band above the prompt
shows how many servers run and on which ports. Press 0 to open the pane: each server has Open
(an Omarchy web app window) and Stop.

## Before you try them

- These are examples and are not maintained (see the note at the top). The safest use is to read
  the code and build your own mod from it.

- A mod is code that runs with your permissions, inside Claude Code. It is not sandboxed. It can
  read and write your files, start programs and make network requests. Read the code in
  `plugins/omarchy-mods/hooks/` first. `claude plugin validate ./plugins/omarchy-mods` lists the
  events the mods handle and the calls they make, without running them.
- Claude Code 2.1.287 or later in a terminal (`claude --version`).
- Omarchy 4.5 (tested on 4.5.0-3, Claude Code 2.1.323). The mods call `omarchy-notification-send`,
  `omarchy-notification-dismiss`, `omarchy-launch-floating-terminal-with-presentation`,
  `omarchy-launch-webapp`, `hyprctl`, `pacman` and `ss`. The package cards read the AUR web API.
- Permission notifications show only when Claude Code would show a permission prompt. In auto
  mode most tool calls run without a prompt, so most cards never show. Press Shift+Tab to switch
  modes.
- Tested in the terminal only. The Claude Desktop app has no Arch Linux build.

## Try them

On a test system, in a Claude Code session:

```text
/plugin marketplace add starryhope/omarchy-mods
/plugin install omarchy-mods@starryhope
```

Pick a scope (user scope gives you the mods in every project), then confirm the options.

Or from your shell, in one step:

```bash
claude plugin install omarchy-mods --marketplace starryhope/omarchy-mods
```

A session that is already open loads the mods after `/reload-plugins`.

## Options

Change the options with `/plugin configure omarchy-mods@starryhope`, or in `/config`, where each
option has its own row.

| Option | Default | What it does |
|---|---|---|
| `notify` | on | Notifications |
| `package_cards` | on | Package cards and the AUR review hold |
| `run_buttons` | on | Run-it-for-me buttons |
| `services` | on | Services pane |
| `aur_hold_minutes` | 3 | Minutes an AUR install waits for Install or Cancel before it is refused |
| `approve_wait_seconds` | 90 | Seconds a permission notification waits before only the terminal prompt is left |
| `adapter` | `omarchy` | `fake` is for working on the mods on another system; it needs stand-in commands on PATH |

To turn one mod off, set its option to off. To turn all four off, disable the plugin in the
Installed tab of `/plugin`, or run `claude plugin disable omarchy-mods@starryhope`.

## Build your own

Each mod is one file in `plugins/omarchy-mods/hooks/`, and `register.js` loads them. `adapter.js`
is the only file that names Omarchy commands. Copy the file closest to what you want, change it,
and load your copy with `claude --plugin-dir <your folder>`. The mods docs are at
https://code.claude.com/docs/en/plugins/mods/overview.

## Known limits

- Not maintained: these limits will not be fixed here.

- Notification cards are cleared by their title, so two Claude sessions on one desktop clear each
  other's cards.
- The "Claude finished" card follows Omarchy's normal notification time (8 seconds).
- In a terminal narrower than 144 columns the review pane does not open by itself; press 7.

## License

MIT. See `LICENSE`. The software comes as is, with no warranty.
