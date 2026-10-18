import { expect, test, type Page } from '@playwright/test'

const THEME_KEY = 'dormtopology.home-theme'
const PROJECT_ID = 'demo-dorm-101'
const SHOT_DIR = 'F:/DormTopology/.task-artifacts/workspace-theme-fix/shots'

const ROUTES = [
  { name: 'workspace', path: `/projects/${PROJECT_ID}/workspace` },
  { name: 'result', path: `/projects/${PROJECT_ID}/result` },
] as const

const EXPECTED_SURFACE: Record<'light' | 'dark', string> = {
  light: '#ffffff',
  dark: '#1c2125',
}

/** Parse 'rgb(r, g, b)' or 'rgba(r, g, b, a)' into [r, g, b]. */
function parseRgb(value: string): [number, number, number] {
  const match = value.match(/rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/)
  if (!match) throw new Error(`Unparseable color: ${value}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function normalizeHexToRgb(hex: string): [number, number, number] {
  const clean = hex.trim().replace('#', '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ]
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

async function seedTheme(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript(
    ({ key, value }: { key: string; value: string }) => {
      window.localStorage.setItem(key, value)
    },
    { key: THEME_KEY, value: theme },
  )
}

type SurfaceReadings = {
  rootBg: string
  rootColor: string
  surfaceVar: string
  surfaces: { label: string; bg: string }[]
  headings: { label: string; text: string; color: string; background: string }[]
}

async function readSurfaces(page: Page): Promise<SurfaceReadings> {
  return page.evaluate(() => {
    const toRgb = (value: string) => {
      const match = value.match(/rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/)
      if (!match) return value
      return `rgb(${Number(match[1])}, ${Number(match[2])}, ${Number(match[3])})`
    }

    const resolvedBackground = (node: Element): string => {
      let current: Element | null = node
      while (current) {
        const bg = getComputedStyle(current).backgroundColor
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return toRgb(bg)
        current = current.parentElement
      }
      return toRgb(getComputedStyle(document.body).backgroundColor)
    }

    const surfaceTargets = Array.from(
      document.querySelectorAll<HTMLElement>(
        '.app-shell [data-surface], .workspace-toolbar, .workspace-header, .workspace-toolbar [class*="surface"], header[class*="surface"], footer.bg-surface, aside.bg-surface, [role="complementary"].bg-surface',
      ),
    )

    const headings = Array.from(
      document.querySelectorAll<HTMLElement>(
        '.app-shell h1, .app-shell h2, .app-shell h3, .app-shell aside button .truncate',
      ),
    )

    return {
      rootBg: toRgb(getComputedStyle(document.body).backgroundColor),
      rootColor: toRgb(getComputedStyle(document.body).color),
      surfaceVar: getComputedStyle(document.documentElement).getPropertyValue('--app-surface').trim(),
      surfaces: surfaceTargets.map((node, index) => ({
        label: node.className || node.tagName || `surface-${index}`,
        bg: toRgb(getComputedStyle(node).backgroundColor),
      })),
      headings: headings.map((node) => ({
        label: node.textContent?.trim().slice(0, 40) || node.className,
        text: node.textContent?.trim() || '',
        color: toRgb(getComputedStyle(node).color),
        background: resolvedBackground(node),
        // --app-surface must actually be applied on panels; the heading inherits the shell fg.
        surface: getComputedStyle(node).getPropertyValue('--app-surface').trim(),
      })),
    }
  })
}

test.describe('workspace and result direct entry theming', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.setViewportSize({ width: 1440, height: 1000 })
  })

  for (const theme of ['light', 'dark'] as const) {
    for (const route of ROUTES) {
      test(`${theme} ${route.name} direct entry keeps readable shell surfaces`, async ({ page }) => {
        await seedTheme(page, theme)
        await page.goto(route.path)

        // Fullscreen workspace/result must still render through .app-shell theming.
        const shell = page.locator('.app-shell')
        await expect(shell).toHaveAttribute('data-theme', theme)
        await expect(page.locator('html')).toHaveAttribute('data-app-theme', theme)

        // Canvas is rendered and visible.
        await expect(page.locator('canvas')).toBeVisible()

        const readings = await readSurfaces(page)

        // Root background and foreground must differ enough for readability.
        const bg = parseRgb(readings.rootBg)
        const fg = parseRgb(readings.rootColor)
        expect(bg).not.toEqual(fg)
        expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5)

        // Actually applied --app-surface resolves to the expected color token.
        const expectedSurface = normalizeHexToRgb(EXPECTED_SURFACE[theme])
        expect(readings.surfaceVar.toLowerCase()).toBe(EXPECTED_SURFACE[theme])
        expect(readings.surfaces.length).toBeGreaterThan(0)
        for (const surface of readings.surfaces) {
          expect(parseRgb(surface.bg), `${surface.label} background`).toEqual(expectedSurface)
        }

        // Both side panels and the workspace heading surfaces use the same surface token.
        expect(readings.surfaces.length).toBeGreaterThanOrEqual(route.name === 'workspace' ? 3 : 2)

        // Headings / object names inherit a readable foreground against the real background.
        expect(readings.headings.length).toBeGreaterThan(0)
        for (const heading of readings.headings) {
          expect(heading.text.length, 'heading has text').toBeGreaterThan(0)
          expect(contrastRatio(parseRgb(heading.color), parseRgb(heading.background)), `heading "${heading.label}" contrast`)
            .toBeGreaterThanOrEqual(4.5)
        }

        await page.screenshot({
          path: `${SHOT_DIR}/${route.name}-${theme}-direct-entry-1440x1000.png`,
          animations: 'disabled',
          fullPage: false,
        })
      })
    }
  }

  test('toggle on home persists into a direct workspace entry in both directions', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('data-app-theme', 'light')

    await page.getByRole('button', { name: '深夜模式' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-app-theme', 'dark')
    expect(await page.evaluate((key) => localStorage.getItem(key), THEME_KEY)).toBe('dark')

    await page.goto(`/projects/${PROJECT_ID}/workspace`)
    await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'dark')
    await expect(page.locator('html')).toHaveAttribute('data-app-theme', 'dark')
    await expect(page.getByRole('button', { name: '深夜模式' })).toHaveAttribute('aria-pressed', 'true')
    await page.screenshot({ path: `${SHOT_DIR}/workspace-toggled-dark-1440x1000.png`, animations: 'disabled' })

    await page.getByRole('button', { name: '日间模式' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-app-theme', 'light')
    expect(await page.evaluate((key) => localStorage.getItem(key), THEME_KEY)).toBe('light')

    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('data-app-theme', 'light')
    await page.getByRole('button', { name: '深夜模式' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-app-theme', 'dark')

    // Direct entry after home must agree without a reload of the app shell.
    await page.goto(`/projects/${PROJECT_ID}/workspace`)
    await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'dark')
    const readings = await readSurfaces(page)
    expect(contrastRatio(parseRgb(readings.rootColor), parseRgb(readings.rootBg))).toBeGreaterThanOrEqual(4.5)
    for (const surface of readings.surfaces) {
      expect(parseRgb(surface.bg), `${surface.label} background`).toEqual(normalizeHexToRgb(EXPECTED_SURFACE.dark))
    }
    await page.screenshot({ path: `${SHOT_DIR}/workspace-home-toggled-dark-1440x1000.png`, animations: 'disabled' })
  })
})
