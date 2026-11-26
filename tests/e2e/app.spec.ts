import { test, expect } from '@playwright/test'

/**
 * E2E tests for Blueprint PC critical flows.
 *
 * These tests run against the Vite dev server (localhost:5173).
 * They mock window.api (normally provided by Electron's preload) so the
 * renderer can be tested without a full Electron instance.
 *
 * Run with:  npm run test:e2e
 */

const settingsWithKey = {
  provider: 'gemini',
  geminiApiKey: 'test-key',
  geminiModel: 'gemini-3.8-flash',
  openaiApiKey: '',
  openaiModel: 'gpt-4o-mini',
  nvidiaApiKey: '',
  nvidiaModel: 'meta/llama-3.3-70b-instruct',
  imageModel: 'black-forest-labs/flux.1-schnell',
  enableImages: false
}

test.describe('App loads', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      ;(window as any).api = {
        listProjects: async () => [],
        getProject: async () => null,
        saveProject: async () => ({}),
        deleteProject: async () => true,
        archiveProject: async () => true,
        purgeProject: async () => true,
        duplicateProject: async () => ({ id: 'new-id' }),
        exportProject: async () => 'data/exports/test.bpzip',
        importProject: async () => 'new-id',
        refreshPart: async () => ({}),
        staleParts: async () => [],
        showDataFolder: async () => true,
        openFilePicker: async () => ({ canceled: true }),
        listNvidiaModels: async () => [],
        summariseInfo: async () => ({ ok: true, data: '' }),
        generate: async () => ({ ok: true, data: {} }),
        normaliseDesign: async () => ({ ok: true, data: {} }),
        loadSettings: async () => settingsWithKey,
        saveSettings: async () => settingsWithKey,
        settings: {
          load: async () => settingsWithKey,
          save: async () => settingsWithKey
        },
        offers: {
          get: async () => ({ ok: true, data: [] })
        },
        catalogue: {
          status: async () => ({ ok: true, data: { progress: { stage: 'idle', processed: 0, total: 0 }, lastSyncAt: null, count: 0 } }),
          search: async () => ({ ok: true, data: [] }),
          get: async () => ({ ok: true, data: null }),
          sync: async () => ({ ok: true, data: { stage: 'idle', processed: 0, total: 0 } }),
          refreshPart: async () => ({ ok: true, data: { slug: 'test', name: 'Test', fetchedAt: Date.now() } }),
          staleParts: async () => ({ ok: true, data: [] }),
          findModelUrl: async () => ({ ok: true, data: null }),
          cadDiscoveryStatus: async () => ({ ok: true, data: { stage: 'idle', processed: 0, total: 0 } }),
          runCadDiscovery: async () => ({ ok: true, data: { stage: 'idle', processed: 0, total: 0 } }),
          lookupModel: async () => ({ ok: true, data: null }),
          downloadModelByUrl: async () => ({ ok: true, data: null }),
          modelDownloadStatus: async () => ({ ok: true, data: { stage: 'idle', processed: 0, total: 0 } }),
          runModelDownload: async () => ({ ok: true, data: { stage: 'idle', processed: 0, total: 0 } }),
          grabcad: {
            status: async () => ({ ok: true, data: { authenticated: false } }),
            login: async () => ({ ok: true, data: { cookie: '' } }),
            logout: async () => ({ ok: true, data: null }),
            search: async () => ({ ok: true, data: [] }),
            download: async () => ({ ok: true, data: { slug: '', archiveUrl: '', files: [], extractDir: '', localFile: null } })
          }
        },
        cartGetOrCreate: async () => ({ ok: true, data: { id: 'cart-1', createdAt: Date.now(), updatedAt: Date.now() } }),
        cartAdd: async () => ({ ok: true }),
        cartRemove: async () => ({ ok: true, data: { removed: true } }),
        cartList: async () => ({ ok: true, data: [] }),
        cartClear: async () => ({ ok: true }),
        cartExport: async () => ({ ok: true, data: 'Component,Part Name,Quantity,Unit Price,Currency,Retailer URL,Added At\n' }),
        designRunDrc: async () => ({ ok: true, data: { violations: [], summary: { total: 0, errors: 0, warnings: 0, infos: 0, clean: true } } }),
        designSaveVersion: async () => ({ ok: true, data: { id: 'ver-new', createdAt: Date.now() } }),
        designListVersions: async () => ({ ok: true, data: [] }),
        designRestoreVersion: async () => ({ ok: true, data: null }),
        designDiffVersions: async () => ({ ok: true, data: { diff: {}, v1: null, v2: null } })
      }
      ;(window as any).prompt = () => 'E2E test version'
    })
  })

  test('shows the NoKeyState screen when no API key is configured', async ({ page }) => {
    await page.addInitScript(() => {
      ;(window as any).api.loadSettings = async () => ({ ...settingsWithKey, geminiApiKey: '' })
    })
    await page.goto('/')

    await expect(page.getByRole('heading', { name: /One step before you build/i })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open settings' })).toBeVisible()
  })

  test('renders the sidebar with navigation options', async ({ page }) => {
    await page.goto('/')

    await expect(page.locator('text=Part library')).toBeVisible()
    await expect(page.locator('text=Settings').nth(0)).toBeVisible()
  })
})

test.describe('App does not crash', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      ;(window as any).api = {
        listProjects: async () => [],
        getProject: async () => null,
        saveProject: async () => ({}),
        deleteProject: async () => true,
        archiveProject: async () => true,
        purgeProject: async () => true,
        duplicateProject: async () => ({ id: 'new-id' }),
        exportProject: async () => 'data/exports/test.bpzip',
        importProject: async () => 'new-id',
        refreshPart: async () => ({}),
        staleParts: async () => [],
        showDataFolder: async () => true,
        openFilePicker: async () => ({ canceled: true }),
        listNvidiaModels: async () => [],
        summariseInfo: async () => ({ ok: true, data: '' }),
        generate: async () => ({ ok: true, data: {} }),
        normaliseDesign: async () => ({ ok: true, data: {} }),
        loadSettings: async () => settingsWithKey,
        saveSettings: async () => settingsWithKey,
        settings: {
          load: async () => settingsWithKey,
          save: async () => settingsWithKey
        },
        offers: {
          get: async () => ({ ok: true, data: [] })
        },
        catalogue: {
          status: async () => ({ ok: true, data: { progress: { stage: 'idle', processed: 0, total: 0 }, lastSyncAt: null, count: 0 } }),
          search: async () => ({ ok: true, data: [] }),
          get: async () => ({ ok: true, data: null }),
          sync: async () => ({ ok: true, data: { stage: 'idle', processed: 0, total: 0 } }),
          refreshPart: async () => ({ ok: true, data: { slug: 'test', name: 'Test', fetchedAt: Date.now() } }),
          staleParts: async () => ({ ok: true, data: [] }),
          findModelUrl: async () => ({ ok: true, data: null }),
          cadDiscoveryStatus: async () => ({ ok: true, data: { stage: 'idle', processed: 0, total: 0 } }),
          runCadDiscovery: async () => ({ ok: true, data: { stage: 'idle', processed: 0, total: 0 } }),
          lookupModel: async () => ({ ok: true, data: null }),
          downloadModelByUrl: async () => ({ ok: true, data: null }),
          modelDownloadStatus: async () => ({ ok: true, data: { stage: 'idle', processed: 0, total: 0 } }),
          runModelDownload: async () => ({ ok: true, data: { stage: 'idle', processed: 0, total: 0 } }),
          grabcad: {
            status: async () => ({ ok: true, data: { authenticated: false } }),
            login: async () => ({ ok: true, data: { cookie: '' } }),
            logout: async () => ({ ok: true, data: null }),
            search: async () => ({ ok: true, data: [] }),
            download: async () => ({ ok: true, data: { slug: '', archiveUrl: '', files: [], extractDir: '', localFile: null } })
          }
        },
        cartGetOrCreate: async () => ({ ok: true, data: { id: 'cart-1', createdAt: Date.now(), updatedAt: Date.now() } }),
        cartAdd: async () => ({ ok: true }),
        cartRemove: async () => ({ ok: true, data: { removed: true } }),
        cartList: async () => ({ ok: true, data: [] }),
        cartClear: async () => ({ ok: true }),
        cartExport: async () => ({ ok: true, data: 'Component,Part Name,Quantity,Unit Price,Currency,Retailer URL,Added At\n' }),
        designRunDrc: async () => ({ ok: true, data: { violations: [], summary: { total: 0, errors: 0, warnings: 0, infos: 0, clean: true } } }),
        designSaveVersion: async () => ({ ok: true, data: { id: 'ver-new', createdAt: Date.now() } }),
        designListVersions: async () => ({ ok: true, data: [] }),
        designRestoreVersion: async () => ({ ok: true, data: null }),
        designDiffVersions: async () => ({ ok: true, data: { diff: {}, v1: null, v2: null } })
      }
      ;(window as any).prompt = () => 'E2E test version'
    })
  })

  test('renders all major UI sections', async ({ page }) => {
    await page.goto('/')

    await expect(page.locator('text=Part library')).toBeVisible()
    await expect(page.getByText(/One step before you build/i)).toBeVisible()
    await expect(page.getByText('Zoom 100%')).toBeVisible()
    await expect(page.getByText('OK')).toBeVisible()
  })
})

test.describe('Cart flows', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      ;(window as any).api = {
        listProjects: async () => [],
        getProject: async () => null,
        saveProject: async () => ({}),
        deleteProject: async () => true,
        archiveProject: async () => true,
        purgeProject: async () => true,
        duplicateProject: async () => ({ id: 'new-id' }),
        exportProject: async () => 'data/exports/test.bpzip',
        importProject: async () => 'new-id',
        refreshPart: async () => ({}),
        staleParts: async () => [],
        showDataFolder: async () => true,
        openFilePicker: async () => ({ canceled: true }),
        listNvidiaModels: async () => [],
        summariseInfo: async () => ({ ok: true, data: '' }),
        generate: async () => ({ ok: true, data: {} }),
        normaliseDesign: async () => ({ ok: true, data: {} }),
        loadSettings: async () => settingsWithKey,
        saveSettings: async () => settingsWithKey,
        settings: {
          load: async () => settingsWithKey,
          save: async () => settingsWithKey
        },
        offers: {
          get: async () => ({ ok: true, data: [] })
        },
        catalogue: {
          status: async () => ({ ok: true, data: { progress: { stage: 'idle', processed: 0, total: 0 }, lastSyncAt: null, count: 0 } }),
          search: async () => ({ ok: true, data: [] }),
          get: async () => ({ ok: true, data: null }),
          sync: async () => ({ ok: true, data: { stage: 'idle', processed: 0, total: 0 } }),
          refreshPart: async () => ({ ok: true, data: { slug: 'test', name: 'Test', fetchedAt: Date.now() } }),
          staleParts: async () => ({ ok: true, data: [] }),
          findModelUrl: async () => ({ ok: true, data: null }),
          cadDiscoveryStatus: async () => ({ ok: true, data: { stage: 'idle', processed: 0, total: 0 } }),
          runCadDiscovery: async () => ({ ok: true, data: { stage: 'idle', processed: 0, total: 0 } }),
          lookupModel: async () => ({ ok: true, data: null }),
          downloadModelByUrl: async () => ({ ok: true, data: null }),
          modelDownloadStatus: async () => ({ ok: true, data: { stage: 'idle', processed: 0, total: 0 } }),
          runModelDownload: async () => ({ ok: true, data: { stage: 'idle', processed: 0, total: 0 } }),
          grabcad: {
            status: async () => ({ ok: true, data: { authenticated: false } }),
            login: async () => ({ ok: true, data: { cookie: '' } }),
            logout: async () => ({ ok: true, data: null }),
            search: async () => ({ ok: true, data: [] }),
            download: async () => ({ ok: true, data: { slug: '', archiveUrl: '', files: [], extractDir: '', localFile: null } })
          }
        },
        cartGetOrCreate: async () => ({ ok: true, data: { id: 'cart-1', createdAt: Date.now(), updatedAt: Date.now() } }),
        cartAdd: async () => ({ ok: true }),
        cartRemove: async () => ({ ok: true, data: { removed: true } }),
        cartList: async () => ({ ok: true, data: [] }),
        cartClear: async () => ({ ok: true }),
        cartExport: async () => ({ ok: true, data: 'Component,Part Name,Quantity,Unit Price,Currency,Retailer URL,Added At\n' }),
        designRunDrc: async () => ({ ok: true, data: { violations: [], summary: { total: 0, errors: 0, warnings: 0, infos: 0, clean: true } } }),
        designSaveVersion: async () => ({ ok: true, data: { id: 'ver-new', createdAt: Date.now() } }),
        designListVersions: async () => ({ ok: true, data: [] }),
        designRestoreVersion: async () => ({ ok: true, data: null }),
        designDiffVersions: async () => ({ ok: true, data: { diff: {}, v1: null, v2: null } })
      }
      ;(window as any).prompt = () => 'E2E test version'
    })
  })

  test('opens the cart drawer and shows empty state', async ({ page }) => {
    await page.goto('/')
    await page.locator('text=Cart').click()
    await expect(page.getByRole('heading', { name: 'Shopping Cart' })).toBeVisible()
    await expect(page.getByText('Your cart is empty')).toBeVisible()
  })
})
