import type { Register, ThemeSetArgs } from 'claude-code'

import { makeColors } from './make-colors.js'
import { omarchySvg } from './scene'

const SCENE = 'omarchy-skyline'

// Omarchy's Tokyo Night for the surfaces and words; the coral and violet are the liftoff wallpaper's.
// Coral is the accent: the prompt box's ring, buttons, links and the keywords in code.
const { theme, problems } = makeColors({
  label: 'Omarchy',
  only: 'dark',
  roles: {
    accent: { seed: '#ec575d', stops: { 300: '#f58a8a', 400: '#f0696e', 450: '#ec575d' } },
    pro: '#613388',
    danger: '#f7768e',
    success: '#9ece6a',
    warning: '#e0af68',
  },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#1a1b26',
        'surface-1': '#1f2130',
        'surface-2': '#24283b',
        'surface-3': '#292e42',
        'text-primary': '#c0caf5',
        'text-secondary': '#a9b1d6',
        'text-muted': '#8990b8',
      },
    },
  },
})

const LOOK: ThemeSetArgs = {
  colors: theme,
  backdrop: { scene: SCENE, glass: { blur: 14, tint: '#1a1b26', opacity: 0.46 } },
}

let built: string | undefined

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const unpainted = problems.find(line => line.startsWith("Desktop won't paint"))

    if (unpainted !== undefined) {
      $.ui.toast(unpainted)
    }
    const set = await $.theme.set(LOOK)

    if (!set.isDrawn) {
      $.ui.status(set.reason)
    }

    return next(e)
  })

  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    if (e.surface !== 'desktop' && e.surface !== 'mobile') {
      return next(e)
    }

    const { Svg } = $.ui.resolve(e)
    built ??= omarchySvg()

    return <Svg source={built} alt="A Tokyo skyline in thin outlines, a few windows lighting up" isInteractive />
  })
}
