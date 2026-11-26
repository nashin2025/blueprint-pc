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
        settings: {
          load: async () => ({}),
          save: async () => ({})
        },
        offers: {
          get: async () => ({ ok: true, data: [] })
        }
      }
    })
  })

  test('shows the NoKeyState screen when no API key is configured', async ({ page }) => {
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
        settings: {
          load: async () => ({}),
          save: async () => ({})
        },
        offers: {
          get: async () => ({ ok: true, data: [] })
        }
      }
    })
  })

  test('renders all major UI sections', async ({ page }) => {
    await page.goto('/')

    // Sidebar
    await expect(page.locator('text=Part library')).toBeVisible()

    // Main content
    await expect(page.getByText(/One step before you build/i)).toBeVisible()

    // Status bar at bottom
    await expect(page.getByText('Zoom 100%')).toBeVisible()
    await expect(page.getByText('OK')).toBeVisible()
  })
})
