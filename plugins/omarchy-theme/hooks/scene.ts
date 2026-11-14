// Omarchy: Blueprint's sheet redrawn in Tokyo Night, with a Tokyo skyline in thin outlines along the foot.
// The skyline is low behind the reading column and rises toward both margins, Tokyo Tower on the left and the Skytree on the right.
// The square Omarchy logo stands as a rooftop sign on the left; the OMA logo runs sideways up the right margin.
// A few windows light up and go dark again, beacons breathe on the tall tops, a handful of stars twinkle. A dark-window scene.
// One 1600x1000 sheet, sliced to fill any window: no screen-size rules. Wide windows lose a little of the foot, narrow ones the margins.

const GROUND = '#1a1b26'
const INK = '#a9b1d6'
const CORAL = '#ec575d'
const PEACH = '#fc995a'
const AMBER = '#fdba56'
const LILAC = '#bb9af7'
const RED = '#f7768e'

const TOWER_X = 290
const SKYTREE_X = 1330
const SIGN_FROM = 70
const SIGN_TO = 150
const SIGN_TOP = 455

/** The two marks from omarchy.org/brand, as published; only their colors are changed. */
const LOGO_PATH =
  'm1200 1200h-480v-80h400v-1040h-479.996v160h-400v720h720v-720h-80v-80h159.996v880h-400v160h-640v-1200h1200zm-1120-80h480v-80h-400l.004-400h-80.004zm0-560h80.004v-400h400v-80h-480.004z'
const OMA_PATHS = [
  'M283 285.21A149 149 0 1 0 283 514.79Z',
  'M283 262H536V326L462 400L536 474V536H283V514.79A149 149 0 0 0 283 285.21Z',
  'M536 326L610.5 251.5L759 400L610.5 548.5L536 474Z',
]

type Building = { x: number; width: number; top: number; kind: number }

function round(value: number): number {
  return Math.round(value * 10) / 10
}

/** Deterministic stand-in for a random number, so every build is the same. */
function hash(seed: number): number {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return value - Math.floor(value)
}

/** How tall the city stands at `x`: low behind the reading column, rising toward both margins. */
function rise(x: number): number {
  const fromCentre = Math.abs(x - 800) / 800
  const outside = Math.max(0, (fromCentre - 0.3) / 0.7)
  return 44 + 500 * Math.pow(outside, 1.35)
}

/** One row of buildings across the sheet. Around the two landmarks the row is held low so they stand clear. */
function buildingRow(seed: number, scale: number, lift: number, tallest: number): Building[] {
  const row: Building[] = []
  let x = -12
  for (let index = 0; x < 1600; index += 1) {
    const width = round(30 + hash(seed + index * 3) * 46)
    const middle = x + width / 2
    let height = (rise(middle) * scale + lift) * (0.62 + hash(seed + index * 3 + 1) * 0.5)
    if (Math.abs(middle - TOWER_X) < 66) height = Math.min(height, 190)
    if (Math.abs(middle - SKYTREE_X) < 42) height = Math.min(height, 210)
    height = Math.min(height, tallest)
    const kind = height > 80 ? Math.floor(hash(seed + index * 3 + 2) * 5) : 0
    row.push({ x: round(x), width, top: round(1000 - height), kind })
    x += width + (hash(seed + index * 7 + 5) > 0.8 ? 7 : 0)
  }
  return row
}

/** One building's outline, open at the foot: flat, set back, with a mast, slanted or twin-topped. */
function outline(building: Building): string {
  const { x, width, top, kind } = building
  const right = round(x + width)
  if (kind === 1) {
    return `M${x} 1000V${top + 14}H${round(x + width * 0.2)}V${top}H${round(x + width * 0.8)}V${top + 14}H${right}V1000`
  }
  if (kind === 2) {
    return `M${x} 1000V${top}H${right}V1000M${round(x + width / 2)} ${top}v-22`
  }
  if (kind === 3) {
    return `M${x} 1000V${top + 12}L${right} ${top}V1000`
  }
  if (kind === 4 && width > 50) {
    return `M${x} 1000V${top}H${round(x + width * 0.36)}V${top + 26}H${round(x + width * 0.64)}V${top}H${right}V1000`
  }
  return `M${x} 1000V${top}H${right}V1000`
}

/** Dim window marks on the taller fronts, and the few that light up. */
function windows(row: readonly Building[]): string {
  let dim = ''
  let lit = ''
  const glow = [AMBER, PEACH, CORAL, AMBER, LILAC]
  row.forEach((building, index) => {
    const height = 1000 - building.top
    if (height < 96 || building.width < 32) return
    const columns = Math.floor((building.width - 10) / 9)
    const rows = Math.floor((height - 60) / 13)
    const cell = (column: number, line: number): [number, number] => [round(building.x + 6 + column * 9), round(building.top + 34 + line * 13)]
    for (let column = 0; column < columns; column += 1) {
      for (let line = 0; line < rows; line += 1) {
        if (hash(index * 977 + column * 31 + line * 7) > 0.9) {
          const [x, y] = cell(column, line)
          dim += `M${x} ${y}h4v6h-4z`
        }
      }
    }
    const count = Math.min(columns * rows, 2 + Math.floor(height / 70) + Math.floor(hash(index * 53 + 11) * 4))
    for (let nth = 0; nth < count; nth += 1) {
      const seed = index * 131 + nth * 17
      const [x, y] = cell(Math.floor(hash(seed) * columns), Math.floor(hash(seed + 1) * Math.min(rows, 22)))
      const period = Math.round(7 + hash(seed + 2) * 14)
      const delay = Math.round(hash(seed + 3) * period)
      const color = glow[Math.floor(hash(seed + 4) * glow.length)] ?? AMBER
      const rest = hash(seed + 5) > 0.5 ? 0.8 : 0.08
      lit += `<rect class="${hash(seed + 6) > 0.5 ? 'lit' : 'litLate'}" style="animation-duration:${period}s;animation-delay:-${delay}s" x="${x}" y="${y}" width="4" height="6" fill="${color}" opacity="${rest}"/>`
    }
  })
  return `<path d="${dim}" fill="${INK}" opacity=".13"/>${lit}`
}

/** Tokyo Tower: two flared legs, braces and crosses between them, two decks and the mast. Its foot stands behind the front row. */
function tokyoTower(): string {
  const x = TOWER_X
  const half = (y: number): number => round(5 + 62 * Math.pow((y - 560) / 440, 2.2))
  let left = ''
  let right = ''
  for (let y = 560; y <= 1000; y += 20) {
    left += `${left === '' ? 'M' : 'L'}${round(x - half(y))} ${y}`
    right += `${right === '' ? 'M' : 'L'}${round(x + half(y))} ${y}`
  }
  let braces = ''
  for (let y = 584; y < 980; y += 36) {
    const here = half(y)
    const next = half(y + 36)
    braces += `M${round(x - here)} ${y}H${round(x + here)}M${round(x - here)} ${y}L${round(x + next)} ${y + 36}M${round(x + here)} ${y}L${round(x - next)} ${y + 36}`
  }
  const upperDeck = `M${x - 9} 632h18v10h-18z`
  const mainDeck = `M${round(x - half(760) - 6)} 752h${round(half(760) * 2 + 12)}v16h-${round(half(760) * 2 + 12)}z`
  const mast = `M${x} 560V470M${x - 4} 536h8M${x - 3} 512h6M${x - 2} 490h4`
  return `<path d="${braces}" fill="none" stroke="${CORAL}" stroke-width=".8" opacity=".4"/><path d="${left}${right}${mast}" fill="none" stroke="${CORAL}" stroke-width="1.2" opacity=".8"/><path d="${upperDeck}${mainDeck}" fill="${GROUND}" stroke="${CORAL}" stroke-width="1.2" opacity=".8"/>`
}

/** The Skytree: a slender tapering shaft with a faint lattice, two deck pods and a long mast. */
function skytree(): string {
  const x = SKYTREE_X
  const half = (y: number): number => round(7 + 13 * ((y - 500) / 500))
  const shaft = `M${round(x - half(1000))} 1000L${x - 7} 500M${round(x + half(1000))} 1000L${x + 7} 500`
  let lattice = ''
  for (let y = 520; y < 980; y += 40) {
    lattice += `M${round(x - half(y))} ${y}L${round(x + half(y + 40))} ${y + 40}M${round(x + half(y))} ${y}L${round(x - half(y + 40))} ${y + 40}`
  }
  const pods = `M${x - 7} 500L${x - 17} 492V478L${x - 10} 470H${x + 10}L${x + 17} 478V492L${x + 7} 500zM${x - 10} 470L${x - 13} 464V456H${x + 13}V464L${x + 10} 470`
  const mast = `M${x - 3} 456V384H${x + 3}V456M${x} 384V318`
  return `<path d="${lattice}" fill="none" stroke="${LILAC}" stroke-width=".8" opacity=".32"/><path d="${shaft}${pods}${mast}" fill="none" stroke="${LILAC}" stroke-width="1.2" opacity=".8"/>`
}

/** A soft coral-to-violet glow behind a logo that swells and fades every few seconds. */
function halo(x: number, y: number, radiusX: number, radiusY: number, period: number, delay: number): string {
  return `<ellipse class="halo" style="transform-origin:${x}px ${y}px;animation-duration:${period}s;animation-delay:-${delay}s" cx="${x}" cy="${y}" rx="${radiusX}" ry="${radiusY}" fill="url(#halo)" opacity=".6"/>`
}

/** A breathing red light on a tall top. */
function beacon(x: number, y: number, delay: number): string {
  return `<circle class="beacon" style="animation-delay:-${delay}s" cx="${x}" cy="${y}" r="2.2" fill="${RED}" opacity=".8"/>`
}

/** The city: a fainter row behind, the two landmarks, then the front row with its windows, the rooftop sign and the beacons. */
function skyline(): string {
  const back = buildingRow(11, 1.1, 22, 560)
  const front = buildingRow(47, 1, 0, 540).filter(building => building.x + building.width < SIGN_FROM - 4 || building.x > SIGN_TO + 4)
  front.push({ x: SIGN_FROM, width: SIGN_TO - SIGN_FROM, top: SIGN_TOP, kind: 0 })

  let beacons = beacon(TOWER_X, 470, 0) + beacon(SKYTREE_X, 318, 2)
  front.forEach((building, index) => {
    if (building.kind === 2 && 1000 - building.top > 200) {
      beacons += beacon(round(building.x + building.width / 2), building.top - 22, index % 5)
    }
  })

  const sign = `${halo(SIGN_FROM + 40, SIGN_TOP - 42, 92, 92, 5, 0)}<path d="M${SIGN_FROM + 22} ${SIGN_TOP - 12}v12M${SIGN_TO - 22} ${SIGN_TOP - 12}v12" fill="none" stroke="${INK}" stroke-width="1.1" opacity=".5"/><g class="sign" transform="translate(${SIGN_FROM + 10} ${SIGN_TOP - 72}) scale(.05)"><path fill-rule="evenodd" clip-rule="evenodd" fill="${CORAL}" d="${LOGO_PATH}"/></g>`

  return `<g mask="url(#fainterInColumn)">
<path d="${back.map(outline).join('')}" fill="none" stroke="${LILAC}" stroke-width=".9" opacity=".28"/>
${tokyoTower()}${skytree()}
<path d="${front.map(outline).join('')}" fill="${GROUND}" fill-opacity=".82" stroke="${INK}" stroke-width="1.1" stroke-opacity=".62"/>
${windows(front)}${sign}${beacons}
</g>`
}

/** The OMA logo turned a quarter-turn, reading up the right margin, its five bands running from the wallpaper's light to its violet. */
function omaMark(): string {
  const shapes = OMA_PATHS.map(path => `<path d="${path}"/>`).join('')
  return `${halo(1490, 270, 128, 200, 6, 2)}<g transform="translate(1490 270) rotate(-90) scale(.347) translate(-399 -400)" fill="url(#bands)" opacity=".92">${shapes}</g>`
}

/** A few stars, kept to the upper margins; some of them twinkle. */
function stars(): string {
  let still = ''
  let twinkling = ''
  for (let index = 0; index < 46; index += 1) {
    const side = hash(index + 5) > 0.5
    const x = round(side ? 30 + hash(index + 17) * 400 : 1170 + hash(index + 17) * 400)
    const y = round(24 + hash(index + 29) * 380)
    if (x > 1420 && y > 120) continue
    const radius = hash(index + 41) > 0.8 ? 1.3 : 0.9
    if (index % 6 === 0) {
      twinkling += `<circle class="star" style="animation-duration:${7 + (index % 5) * 2}s;animation-delay:-${index % 7}s" cx="${x}" cy="${y}" r="${radius}" fill="#c0caf5" opacity=".5"/>`
    } else {
      still += `M${x - radius} ${y}a${radius} ${radius} 0 1 0 ${radius * 2} 0a${radius} ${radius} 0 1 0 ${-radius * 2} 0`
    }
  }
  return `<path d="${still}" fill="#c0caf5" opacity=".3"/>${twinkling}`
}

/** Specks of tooth for one 160-unit tile: they also keep the washes from banding under the app's blur. */
function toothSpecks(): string {
  let specks = ''
  for (let index = 0; index < 46; index += 1) {
    const x = round(hash(index + 3) * 160)
    const y = round(hash(index + 71) * 160)
    const light = hash(index + 131) > 0.45
    specks += `<rect x="${x}" y="${y}" width="${light ? 1.2 : 1.6}" height="1.2" fill="${light ? '#c0caf5' : '#0e0e14'}" opacity="${light ? 0.05 : 0.12}"/>`
  }
  return specks
}

/** The sheet: Tokyo Night's ground, violet washed into the upper corners and the wallpaper's coral glowing low at both sides, a ghost of Blueprint's grid outside the column. */
function sheet(): string {
  const wash = `<ellipse cx="-40" cy="-40" rx="720" ry="520" fill="url(#washViolet)"/><ellipse cx="1660" cy="-60" rx="640" ry="460" fill="url(#washViolet)"/><ellipse cx="-80" cy="1080" rx="640" ry="460" fill="url(#washCoral)"/><ellipse cx="1680" cy="1080" rx="640" ry="460" fill="url(#washCoral)"/>`
  const grid = `<rect width="1600" height="1000" fill="url(#minorGrid)" mask="url(#notInColumn)"/><rect width="1600" height="1000" fill="url(#majorGrid)" mask="url(#notInColumn)"/>`
  return `<rect width="1600" height="1000" fill="${GROUND}"/>${wash}<rect width="1600" height="1000" fill="url(#tooth)"/>${grid}`
}

/** Stops of a left-to-right ramp that is full at the margins and `inside` strong behind the reading column, eased so no seam shows. */
function columnRamp(inside: number): string {
  return `<stop offset="0" stop-color="#fff"/><stop offset=".1" stop-color="#fff"/><stop offset=".32" stop-color="#fff" stop-opacity="${inside}"/><stop offset=".7" stop-color="#fff" stop-opacity="${inside}"/><stop offset=".92" stop-color="#fff"/><stop offset="1" stop-color="#fff"/>`
}

function wash(id: string, color: string, strength: number): string {
  return `<radialGradient id="${id}"><stop offset="0" stop-color="${color}" stop-opacity="${strength}"/><stop offset=".4" stop-color="${color}" stop-opacity="${round(strength * 0.6)}"/><stop offset=".72" stop-color="${color}" stop-opacity="${round(strength * 0.2)}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`
}

export function omarchySvg(): string {
  const style = `
.lit{animation:lit 40s ease-in-out infinite}
.litLate{animation:litLate 40s ease-in-out infinite}
.beacon{animation:beacon 4s ease-in-out infinite}
.sign{animation:sign 9s ease-in-out infinite}
.star{animation:star 9s ease-in-out infinite}
.halo{animation:halo 5s ease-in-out infinite}
@keyframes lit{0%,54%,100%{opacity:.06}8%,46%{opacity:.9}}
@keyframes litLate{0%,30%,88%,100%{opacity:.9}38%,80%{opacity:.06}}
@keyframes beacon{0%,100%{opacity:.15}50%{opacity:.95}}
@keyframes sign{0%,100%{opacity:.72}50%{opacity:1}}
@keyframes halo{0%,100%{opacity:.22;transform:scale(.78)}50%{opacity:1;transform:scale(1.12)}}
@keyframes star{0%,100%{opacity:.15}50%{opacity:.75}}
@media (prefers-reduced-motion: reduce){*{animation:none!important}}`

  const bands = ['#fcdda2', '#fc995a', CORAL, '#9f356a', '#613388']
  const edges = [0, 26.316, 36.842, 57.895, 73.684, 100]
  const bandStops = bands.map((color, index) => `<stop offset="${edges[index]}%" stop-color="${color}"/><stop offset="${edges[index + 1]}%" stop-color="${color}"/>`).join('')

  const defs = `
${wash('washViolet', '#412e88', 0.5)}${wash('washCoral', '#cb3e58', 0.3)}
<radialGradient id="halo"><stop offset="0" stop-color="${CORAL}" stop-opacity=".62"/><stop offset=".4" stop-color="#c2477f" stop-opacity=".4"/><stop offset=".72" stop-color="#8a5cd6" stop-opacity=".22"/><stop offset="1" stop-color="#8a5cd6" stop-opacity="0"/></radialGradient>
<linearGradient id="bands" x1="0" y1="250" x2="0" y2="550" gradientUnits="userSpaceOnUse">${bandStops}</linearGradient>
<pattern id="tooth" width="160" height="160" patternUnits="userSpaceOnUse">${toothSpecks()}</pattern>
<pattern id="minorGrid" width="100" height="100" patternUnits="userSpaceOnUse"><path d="M20.5 0v100M40.5 0v100M60.5 0v100M80.5 0v100M0 20.5h100M0 40.5h100M0 60.5h100M0 80.5h100" stroke="${INK}" stroke-opacity=".04" fill="none"/></pattern>
<pattern id="majorGrid" width="100" height="100" patternUnits="userSpaceOnUse"><path d="M.5 0v100M0 .5h100" stroke="${INK}" stroke-opacity=".08" fill="none"/></pattern>
<linearGradient id="notInColumnRamp">${columnRamp(0)}</linearGradient>
<linearGradient id="fainterInColumnRamp">${columnRamp(0.38)}</linearGradient>
<mask id="notInColumn" maskUnits="userSpaceOnUse" x="0" y="0" width="1600" height="1000"><rect width="1600" height="1000" fill="url(#notInColumnRamp)"/></mask>
<mask id="fainterInColumn" maskUnits="userSpaceOnUse" x="0" y="0" width="1600" height="1000"><rect width="1600" height="1000" fill="url(#fainterInColumnRamp)"/></mask>`

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"><style>${style}</style><defs>${defs}</defs>
${sheet()}
${stars()}
${skyline()}
${omaMark()}
</svg>`
}
