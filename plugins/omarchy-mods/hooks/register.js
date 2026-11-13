// omarchy-mods: four Claude Code mods, each with its own on/off option
import { registerPackageCards } from './package-cards.js'
import { registerRunButtons } from './run-buttons.js'
import { registerServices } from './services.js'
import { registerNotify } from './notify.js'

export function register(on, options) {
  if (options.package_cards !== false) registerPackageCards(on, options)
  if (options.run_buttons !== false) registerRunButtons(on, options)
  if (options.services !== false) registerServices(on, options)
  if (options.notify !== false) registerNotify(on, options)
}
