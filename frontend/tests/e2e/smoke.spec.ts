import { expect, test } from '@playwright/test'

function sameOriginApiPath(url: string) {
  try {
    const parsed = new URL(url)
    return parsed.pathname.startsWith('/api/') ? `${parsed.pathname}${parsed.search}` : null
  } catch {
    return null
  }
}

test('homepage defers secondary tab data and reuses header stats', async ({ page }) => {
  const apiRequests: string[] = []
  page.on('request', (request) => {
    const path = sameOriginApiPath(request.url())
    if (path) apiRequests.push(path)
  })

  await page.goto('/')
  await expect(page.locator('.feed-row').first()).toBeVisible()

  expect(apiRequests.some((path) => path === '/api/holders?limit=500')).toBe(false)

  await page.getByText('holders', { exact: true }).click()
  await expect(page.locator('.holder-row').nth(1)).toBeVisible()
  expect(apiRequests.some((path) => path === '/api/holders?limit=500')).toBe(true)

  await page.getByRole('link', { name: '[all]' }).click()
  await expect(page.getByRole('heading', { name: 'all vessel tokens' })).toBeVisible()
  await page.waitForLoadState('networkidle')

  expect(apiRequests.filter((path) => path === '/api/stats').length).toBeLessThanOrEqual(1)
  expect(apiRequests.filter((path) => path === '/api/holders?limit=1').length).toBeLessThanOrEqual(1)
})

test('heatmap renders useful contrast without the old date range caption', async ({ page }) => {
  await page.goto('/')
  await page.getByText('heatmap', { exact: true }).click()
  await expect(page.locator('.heatmap-day').first()).toBeVisible()

  const heatmap = await page.evaluate(() => {
    const text = document.querySelector('.activity-heatmap')?.textContent?.replace(/\s+/g, ' ').trim() || ''
    const backgrounds = [...document.querySelectorAll('.heatmap-day')]
      .map((el) => getComputedStyle(el).backgroundColor)

    return {
      hasDateRangeArrow: text.includes('->'),
      uniqueBackgrounds: new Set(backgrounds).size,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }
  })

  expect(heatmap.hasDateRangeArrow).toBe(false)
  expect(heatmap.uniqueBackgrounds).toBeGreaterThanOrEqual(6)
  expect(heatmap.overflow).toBe(false)

  await page.locator('.heatmap-day').first().hover()
  await expect(page.locator('.heatmap-tooltip')).toBeVisible()
  await expect(page.locator('.heatmap-tooltip-date')).toContainText(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/)
  await expect(page.locator('.heatmap-tooltip-count')).toContainText(/interaction/)
})

test('mobile heatmap opens day details on tap', async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  })
  const page = await context.newPage()

  await page.goto('/')
  await page.getByText('heatmap', { exact: true }).click()
  await expect(page.locator('.heatmap-day').first()).toBeVisible()

  await page.locator('.heatmap-day').first().tap()
  await expect(page.locator('.heatmap-tooltip')).toBeVisible()
  await expect(page.locator('.heatmap-tooltip-count')).toContainText(/interaction/)

  await context.close()
})

test('vessel write rows keep click-to-copy and aligned dates', async ({ page }) => {
  for (const path of ['/3600', '/2623']) {
    await page.goto(path)
    await expect(page.locator('.write-row .write-hex').first()).toBeVisible()
    await expect(page.locator('.copy-write-btn')).toHaveCount(0)

    const layout = await page.evaluate(() => {
      const row = document.querySelector('.write-row')
      const content = row?.querySelector('.history-content')
      const time = row?.querySelector('.history-time')
      const contentRect = content?.getBoundingClientRect()
      const timeRect = time?.getBoundingClientRect()

      return {
        hasTime: Boolean(time),
        rightGap: contentRect && timeRect ? Math.round(contentRect.right - timeRect.right) : null,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      }
    })

    expect(layout.hasTime).toBe(true)
    expect(layout.rightGap).not.toBeNull()
    expect(layout.rightGap!).toBeLessThanOrEqual(16)
    expect(layout.overflow).toBe(false)

    await page.locator('.write-row .write-hex').first().click()
    const clipboard = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboard.startsWith('0x')).toBe(true)
  }
})

test('grid and all-token table load from the indexer proxy', async ({ page }) => {
  await page.goto('/grid')
  await expect(page.locator('.grid-cell').first()).toBeVisible()

  await page.getByText('[view all]', { exact: true }).click()
  await expect(page.locator('.overview-canvas')).toBeVisible()
  const overview = await page.locator('.overview-canvas').evaluate((canvas) => ({
    width: (canvas as HTMLCanvasElement).width,
    height: (canvas as HTMLCanvasElement).height,
  }))
  expect(overview.width).toBeGreaterThan(0)
  expect(overview.height).toBeGreaterThan(0)

  await page.goto('/all')
  await expect(page.getByRole('heading', { name: 'all vessel tokens' })).toBeVisible()
  await expect(page.locator('.vessel-table tbody tr').first()).toBeVisible()
})

test('sequence list and detail pages expose artwork, holders, and history', async ({ page }) => {
  await page.goto('/sequences')
  await expect(page.getByRole('heading', { name: 'sequences' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Sequence #7/ })).toBeVisible()

  await page.getByRole('link', { name: /Sequence #7/ }).click()
  await expect(page).toHaveURL(/\/sequences\/7$/)
  await expect(page.getByRole('heading', { name: /Sequence #7/ })).toBeVisible()
  await expect(page.locator('.sequence-art')).toBeVisible()
  await expect(page.locator('.sequence-meta')).toContainText('artist')
  await expect(page.locator('.sequence-meta')).toContainText('minted')
  await expect(page.locator('.holder-row').nth(1)).toBeVisible()
  await expect(page.locator('.history-row').first()).toBeVisible()
})

test('sequence links from activity and address pages navigate to detail pages', async ({ page }) => {
  await page.goto('/')
  const sequenceActivityLink = page.locator('a.subject-preview-trigger').first()

  for (let attempt = 0; attempt < 8; attempt++) {
    if (await sequenceActivityLink.count()) break
    await page.mouse.wheel(0, 1800)
    await page.waitForTimeout(400)
  }

  await expect(sequenceActivityLink).toBeVisible()
  await sequenceActivityLink.click()
  await expect(page).toHaveURL(/\/sequences\/\d+$/)
  await expect(page.locator('.sequence-art')).toBeVisible()

  await page.goto('/address/0xfab22550fcd520a7eced27414cd74bc70a6ac1a9')
  const sequenceCard = page.locator('a.sequence-card').first()
  await expect(sequenceCard).toBeVisible()
  await sequenceCard.click()
  await expect(page).toHaveURL(/\/sequences\/7$/)
})

test('sequence detail fits mobile viewport', async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  })
  const page = await context.newPage()

  await page.goto('/sequences/7')
  await expect(page.getByRole('heading', { name: /Sequence #7/ })).toBeVisible()
  await expect(page.locator('.sequence-art')).toBeVisible()

  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  expect(overflow).toBe(false)

  await context.close()
})
