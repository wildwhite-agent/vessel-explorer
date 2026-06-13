import { expect, test } from '@playwright/test'

function sameOriginApiPath(url: string) {
  try {
    const parsed = new URL(url)
    return parsed.pathname.startsWith('/api/') ? `${parsed.pathname}${parsed.search}` : null
  } catch {
    return null
  }
}

function hasApiParams(path: string, pathname: string, params: Record<string, string>) {
  const parsed = new URL(path, 'http://local.test')
  if (parsed.pathname !== pathname) return false
  return Object.entries(params).every(([key, value]) => parsed.searchParams.get(key) === value)
}

function mockActivityRows(action: string, pageNumber: number) {
  return Array.from({ length: 50 }, (_, index) => {
    const n = (pageNumber - 1) * 50 + index + 1
    return {
      hash: `0x${String(n).padStart(64, '0')}`,
      from: '0x1111111111111111111111111111111111111111',
      to: '0x2222222222222222222222222222222222222222',
      timeStamp: String(1_800_000_000 - n),
      blockNumber: String(30_000_000 - n),
      input: '0x',
      isError: '0',
      functionName: '',
      action,
      source: action === 'sequencemint' ? 'sequence' : 'vessel',
      subjectType: action === 'sequencemint' ? 'sequence' : 'craft',
      subjectId: action === 'sequencemint' ? '7' : null,
      amount: '1',
      vesselId: action === 'sequencemint' ? null : String(n),
      detail: action,
    }
  })
}

function traitToken(overrides: Record<string, unknown>) {
  return {
    id: 13,
    claimed: true,
    owner: '0xabc100000000000000000000000000000000def2',
    type: 'Capsule',
    filled: false,
    payloadBytes: 0,
    capacityBytes: 13,
    colorMode: 0,
    role: 0,
    roleLabel: 'Undefined',
    axiom: false,
    relic: false,
    relicKind: null,
    machineName: null,
    claimBlock: '24571088',
    entryCount: 0,
    chosenEntry: 0,
    delegate: null,
    machineAddress: null,
    chosenMachine: null,
    locked: false,
    lockBlock: null,
    isVault: false,
    isMachine: false,
    firstClaimedAt: '1780943435',
    lastPayloadAt: null,
    lastTransferAt: '1780943435',
    updatedAt: '1780943435',
    blockNumber: '25274501',
    payloadHex: '0x',
    ...overrides,
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

test('homepage activity filters can isolate one event', async ({ page }) => {
  const apiRequests: string[] = []

  await page.route(/\/api\/activity(\?.*)?$/, async (route) => {
    const url = new URL(route.request().url())
    apiRequests.push(`${url.pathname}${url.search}`)
    const pageNumber = Number(url.searchParams.get('page') || '1')
    const action = url.searchParams.get('type') === 'sequencemint' ? 'sequencemint' : 'claim'
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockActivityRows(action, pageNumber)),
    })
  })

  await page.goto('/')
  await expect(page.locator('.feed-row').first()).toBeVisible()

  const activeFilterCount = page.locator('.feed-filters button[aria-pressed="true"]')
  await expect(activeFilterCount).toHaveCount(9)

  const sequenceFilter = page.getByRole('button', { name: 'sequence mint' })
  await sequenceFilter.click()
  await expect(activeFilterCount).toHaveCount(1)
  await expect(sequenceFilter).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => apiRequests.some((path) => hasApiParams(path, '/api/activity', {
    page: '1',
    type: 'sequencemint',
    types: 'sequencemint',
  }))).toBe(true)

  await sequenceFilter.click()
  await expect(activeFilterCount).toHaveCount(9)
})

test('homepage filtered activity keeps paginating selected event', async ({ page }) => {
  const apiRequests: string[] = []

  await page.route(/\/api\/activity(\?.*)?$/, async (route) => {
    const url = new URL(route.request().url())
    apiRequests.push(`${url.pathname}${url.search}`)
    const pageNumber = Number(url.searchParams.get('page') || '1')
    const type = url.searchParams.get('type')
    const action = type === 'sequencemint' ? 'sequencemint' : 'claim'

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockActivityRows(action, pageNumber)),
    })
  })

  await page.goto('/')
  await expect(page.locator('.feed-row').first()).toBeVisible()

  await page.getByRole('button', { name: 'sequence mint' }).click()
  await expect(page.locator('.feed-row').first()).toContainText('sequencemint')

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect.poll(() => apiRequests.some((path) => hasApiParams(path, '/api/activity', {
    page: '2',
    type: 'sequencemint',
    types: 'sequencemint',
  }))).toBe(true)
})

test('homepage search accepts ENS names', async ({ page }) => {
  const address = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'

  await page.route(/\/api\/ens\/vitalik\.eth$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ name: 'vitalik.eth', address }),
    })
  })
  await page.route(/\/api\/tokens(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ rows: [], total: 0, page: 1, pageSize: 250, source: 'ponder' }),
    })
  })
  await page.route(/\/api\/sequences\/balances(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ rows: [], total: 0, page: 1, pageSize: 250, source: 'ponder' }),
    })
  })

  await page.goto('/')
  await page.locator('.search-input').fill('vitalik.eth')
  await page.getByRole('button', { name: '[go]' }).click()

  await expect(page).toHaveURL(/\/address\/vitalik\.eth$/)
  await expect(page.locator('.profile-address')).toHaveText(address)
})

test('all token search resolves ENS before querying tokens', async ({ page }) => {
  const address = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
  const tokenRequests: string[] = []

  await page.route(/\/api\/ens\/vitalik\.eth$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ name: 'vitalik.eth', address }),
    })
  })

  await page.route(/\/api\/tokens(\?.*)?$/, async (route) => {
    const url = new URL(route.request().url())
    tokenRequests.push(`${url.pathname}${url.search}`)
    const search = url.searchParams.get('search')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        rows: search?.toLowerCase() === address.toLowerCase()
          ? [{
              id: 13,
              claimed: true,
              owner: address,
              type: 'Capsule',
              filled: true,
              payloadBytes: 92,
              capacityBytes: 13,
              colorMode: 0,
              role: 1,
              claimBlock: '24500000',
              entryCount: 1,
              chosenEntry: 0,
              delegate: null,
              machineAddress: null,
              chosenMachine: null,
              isVault: false,
              isMachine: false,
            }]
          : [],
        total: search?.toLowerCase() === address.toLowerCase() ? 1 : 0,
        page: 1,
        pageSize: 50,
        source: 'ponder',
      }),
    })
  })

  await page.goto('/all')
  await page.getByPlaceholder('token id, owner address, or ens').fill('vitalik.eth')

  await expect.poll(() => tokenRequests.some((path) => hasApiParams(path, '/api/tokens', {
    page: '1',
    pageSize: '50',
    search: address,
  }))).toBe(true)
  await expect(page.getByRole('link', { name: '#13' })).toBeVisible()
})

test('vessel trait UI shows axiom and relic metadata without profile card noise', async ({ page }) => {
  const owner = '0xabc100000000000000000000000000000000def2'
  const tokens = [
    traitToken({
      id: 13,
      owner,
      role: 1,
      roleLabel: 'Navigator',
      axiom: true,
      machineAddress: '0xfeed00000000000000000000000000000000beef',
      machineName: 'Entropy',
    }),
    traitToken({
      id: 3,
      owner,
      role: 2,
      roleLabel: 'Steward',
      relic: true,
      relicKind: 'Insignia',
    }),
  ]
  const tokenRequests: string[] = []

  await page.route(/\/api\/tokens\/13$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...tokens[0], payloadHex: '0x' }),
    })
  })
  await page.route(/\/api\/tokens\/13\/entries$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [] }) })
  })
  await page.route(/\/api\/tokens\/13\/writes(\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [], total: 0, page: 1, limit: 25 }) })
  })
  await page.route(/\/api\/tokens(\?.*)?$/, async (route) => {
    const url = new URL(route.request().url())
    tokenRequests.push(`${url.pathname}${url.search}`)
    const trait = url.searchParams.get('trait')
    const rows = trait === 'axiom'
      ? tokens.filter((token) => token.axiom)
      : trait === 'relic'
        ? tokens.filter((token) => token.relic)
        : tokens
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ rows, total: rows.length, page: 1, pageSize: 50, source: 'ponder' }),
    })
  })
  await page.route(/\/api\/sequences\/balances(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ rows: [], total: 0, page: 1, pageSize: 250, source: 'ponder' }),
    })
  })

  await page.goto('/all')
  await page.locator('.filter-field').filter({ hasText: 'trait' }).locator('select').selectOption('axiom')
  await expect.poll(() => tokenRequests.some((path) => hasApiParams(path, '/api/tokens', { trait: 'axiom' }))).toBe(true)
  await expect(page.getByRole('link', { name: '#13' })).toBeVisible()
  await expect(page.locator('.vessel-table')).toContainText('[axiom]')
  await expect(page.locator('.vessel-table')).toContainText('Navigator')
  await expect(page.locator('.vessel-table')).toContainText('Entropy')

  await page.goto('/13')
  await expect(page.getByRole('heading', { name: /vessel #13/ })).toContainText('[axiom]')
  await expect(page.locator('.vessel-meta')).toContainText('Navigator')
  await expect(page.locator('.vessel-meta')).toContainText('Entropy')

  await page.goto(`/address/${owner}`)
  await expect(page.locator('.profile-stats')).toContainText('1 axiom')
  await expect(page.locator('.profile-stats')).toContainText('1 relic')
  await expect(page.locator('.vessel-card').first()).not.toContainText('Navigator')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/all')
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  expect(overflow).toBe(false)
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
  const sequenceFrame = page.locator('.sequence-art-wrap iframe.sequence-art')
  await expect(sequenceFrame).toBeVisible()
  await expect(sequenceFrame).toHaveAttribute('src', /\/api\/sequence-media\/7\/animation/)
  await expect(sequenceFrame).toHaveAttribute('src', /view=2/)
  await expect(sequenceFrame).toHaveAttribute('sandbox', /allow-scripts/)
  const playButtonOffset = await page
    .frameLocator('.sequence-art-wrap iframe.sequence-art')
    .locator('#audioPlay')
    .evaluate((button) => {
      const rect = button.getBoundingClientRect()
      return {
        x: Math.round((rect.left + rect.width / 2) - window.innerWidth / 2),
        y: Math.round((rect.top + rect.height / 2) - window.innerHeight / 2),
      }
    })
  expect(Math.abs(playButtonOffset.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(playButtonOffset.y)).toBeLessThanOrEqual(1)
  await expect(page.locator('.sequence-meta')).toContainText('artist')
  await expect(page.locator('.sequence-meta')).toContainText('minted')
  await expect(page.locator('.holder-row').nth(1)).toBeVisible()
  await expect(page.locator('.history-row').first()).toBeVisible()
})

test('sequence detail renders video media with native controls', async ({ page }) => {
  await page.goto('/sequences/1')
  await expect(page.getByRole('heading', { name: /Sequence #1/ })).toBeVisible()

  const video = page.locator('.sequence-art-wrap video.sequence-art')
  await expect(video).toBeVisible()
  await expect(video).toHaveAttribute('src', /\/api\/sequence-media\/1\/animation/)
  await expect(video).toHaveAttribute('src', /view=2/)
  await expect(video).toHaveAttribute('poster', /\/api\/sequence-media\/1\/image/)

  const controls = await video.evaluate((element) => (element as HTMLVideoElement).controls)
  expect(controls).toBe(true)
})

test('sequence #6 recovers its real HTML animation from the vault entry', async ({ page }) => {
  // Sequence #6's on-chain animation_url embeds the wrong vault payload (the raw RGB
  // carrier bytes), which renders as mojibake. The interactive piece lives in vessel
  // #3348 entry 5, so the media pipeline serves that bootstrap HTML instead.
  const media = await page.request.get('/api/sequences/tokens/6/media')
  expect(media.ok()).toBe(true)
  const body = await media.json()
  expect(body.animation?.kind).toBe('html')
  expect(body.preferred?.kind).toBe('html')
  expect(body.preferred?.url).toContain('/api/sequence-media/6/animation')

  const animation = await page.request.get('/api/sequence-media/6/animation')
  expect(animation.ok()).toBe(true)
  expect(animation.headers()['content-type']).toContain('text/html')
  const html = await animation.text()
  expect(html.trimStart().startsWith('<!DOCTYPE html>')).toBe(true)
  expect(html).toContain('RGB Carrier')
  expect(html).toContain('0x39c50f01') // vaultToEntry selector used by the bootstrap
  expect(html).toContain('publicnode.com') // public RPC fallback retained
  // The wallet branch must be neutralized: window.ethereum hangs in the sandboxed
  // cross-origin iframe, leaving the loader stuck on "reading entry 1/5...".
  expect(html).not.toContain('if(window.ethereum)')
  expect(html).not.toContain('vessel-sequence-7-play-fix')

  await page.goto('/sequences/6')
  await expect(page.getByRole('heading', { name: /Sequence #6/ })).toBeVisible()
  const frame = page.locator('.sequence-art-wrap iframe.sequence-art')
  await expect(frame).toBeVisible()
  await expect(frame).toHaveAttribute('src', /\/api\/sequence-media\/6\/animation/)
  await expect(frame).toHaveAttribute('sandbox', /allow-scripts/)
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

test('sequence og endpoint returns rendered png media', async ({ request }) => {
  for (const [id, minBytes] of [['2', 50_000], ['7', 5_000]] as const) {
    const response = await request.get(`/api/sequence-og/${id}?v=e2e`)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('image/png')

    const body = await response.body()
    expect(body.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(body.length).toBeGreaterThan(minBytes)
  }
})
