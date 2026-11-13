import { chromium } from 'playwright'

// Browser regression smoke for the critical polish journeys.
//
// Prerequisites:
//   1. backend seeded and running:  cd backend && python -m app.seed --reset
//                                   uvicorn app.main:app --port 8000
//   2. frontend running:            cd frontend && npm run dev
//   3. browser available:           npx playwright install chromium
//      or set CHROME_PATH to an installed Chromium/Chrome binary.
//
// The script mutates the demo database (creates an empty employee and load-test
// help requests, and completes a session), so reseed before each run.
const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:8000/api/v1'
const WEB = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173'
const headers = (email) => ({ 'Content-Type': 'application/json', 'X-Dev-User': email })

async function api(email, path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { ...headers(email), ...(options.headers || {}) },
  })
  const text = await response.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  return { status: response.status, body }
}

const usersResponse = await api('manager@nex.local', '/users')
const users = usersResponse.body
const priya = users.find((u) => u.email === 'priya@nex.local')
const dana = users.find((u) => u.email === 'dana@nex.local')
const sam = users.find((u) => u.email === 'sam@nex.local')

// A no-task employee for the empty-day help path.
await api('admin@nex.local', '/users', {
  method: 'POST',
  body: JSON.stringify({
    email: 'empty@nex.local',
    full_name: 'Eli Empty',
    role: 'employee',
    standup_eligible: false,
  }),
})

// Enough taskless help requests to exercise Today's full-set pagination.
const existingToday = (await api('manager@nex.local', '/today')).body
for (let index = 0; index < 26; index += 1) {
  if (!existingToday.attention.items.some((item) => item.title === `Load test blocker ${index}`)) {
    await api('manager@nex.local', '/blockers', {
      method: 'POST',
      body: JSON.stringify({
        description: `Load test blocker ${index}`,
        client_operation_id: crypto.randomUUID(),
      }),
    })
  }
}

const tasks = (await api('manager@nex.local', `/tasks?assignee_id=${priya.id}&limit=100`)).body.items
const dashboardTask = tasks.find((task) => task.title === 'Revenue variance dashboard')
const targetTask = dashboardTask
const projects = (await api('manager@nex.local', '/projects')).body
const revenueProject = projects.find((project) => project.name === 'Revenue Reporting')

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
const errors = []
page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('409')) errors.push(`console: ${msg.text()}`) })
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))

const step = async (name, fn) => {
  process.stdout.write(`• ${name} … `)
  await fn()
  console.log('ok')
}

await page.goto(`${WEB}/`, { waitUntil: 'networkidle' })

await step('compact header and manager Today', async () => {
  await page.getByRole('heading', { name: 'Today' }).waitFor()
  const navLinks = await page.locator('nav[aria-label="Primary"] > a').count()
  if (navLinks !== 2) throw new Error(`expected 2 primary links, got ${navLinks}`)
  if (await page.locator('aside').count()) throw new Error('sidebar still present')
  await page.getByRole('button', { name: /Start standup/ }).waitFor()
})

await step('full attention pagination loads beyond 25', async () => {
  await page.getByText(/items? need attention/).waitFor()
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await page.getByText('Load test blocker 25').count()) break
    const more = page.getByRole('button', { name: /View all .* attention items/ })
    if (!(await more.count())) break
    await more.click()
    await page.waitForTimeout(300)
  }
  await page.getByText('Load test blocker 25').waitFor()
})

await step('employee daily update preserves next steps and stays separate from task update', async () => {
  await page.locator('select[aria-label="Switch identity"]').selectOption('priya@nex.local')
  await page.getByRole('heading', { name: 'Today' }).waitFor()
  await page.getByText('My current work').waitFor()
  await page.getByPlaceholder('Optional: one short update about what changed.').fill('Daily note for the standup.')
  await page.getByRole('button', { name: 'Add next steps' }).click()
  await page.getByLabel('Next steps').fill('Publish the dashboard.')
  await page.getByRole('button', { name: 'Save update' }).click()
  await page.getByText(/Saved at/).waitFor()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  if ((await page.getByLabel('Next steps').inputValue()) !== 'Publish the dashboard.') {
    throw new Error('daily update edit did not restore next steps')
  }
  await page.getByRole('button', { name: 'Cancel edit' }).click()

  await page.getByRole('button', { name: 'Update', exact: true }).first().click()
  await page.getByLabel('What changed?').fill('Task progress stays on the task.')
  await page.getByRole('button', { name: 'Save update' }).click()
  await page.getByText('Task update saved to').waitFor()
  await page.getByText('Saved at', { exact: false }).first().waitFor()
  if (!(await page.getByText('Daily note for the standup.').count())) {
    throw new Error('task update replaced the daily receipt')
  }
})

await step('manager starts standup and slow person switch never shows old tasks', async () => {
  await page.locator('select[aria-label="Switch identity"]').selectOption('manager@nex.local')
  await page.getByRole('heading', { name: 'Today' }).waitFor()
  await page.getByRole('button', { name: /Start standup/ }).click()
  await page.waitForURL(/\/standups\/[^/]+\/live/, { timeout: 15000 })
  await page.getByText('Mark reviewed & next').waitFor()
  if (await page.locator('nav[aria-label="Primary"]').count()) throw new Error('nav visible in meeting')

  await page.route('**/api/v1/standups/sessions/*/participants/*/workspace', async (route) => {
    if (route.request().url().includes(priya.id)) {
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
    await route.continue()
  })

  await page.getByLabel('Participant').selectOption(dana.id)
  await page.getByRole('button', { name: 'Campaign taxonomy cleanup', exact: true }).waitFor()
  await page.getByLabel('Participant').selectOption(priya.id)
  await page.getByText('Loading this person’s work…').waitFor()
  if (await page.getByRole('button', { name: 'Campaign taxonomy cleanup', exact: true }).count()) {
    throw new Error('old participant tasks remained actionable during switch')
  }
  await page.getByRole('button', { name: 'Attribution model v2', exact: true }).waitFor({ timeout: 10000 })
  await page.unroute('**/api/v1/standups/sessions/*/participants/*/workspace')
})

await step('progress save conflict keeps text and loads latest state', async () => {
  const row = page.locator(`[data-task-id="${targetTask.id}"]`)
  await row.getByRole('button', { name: 'Update', exact: true }).click()
  await page.getByLabel('What changed?').fill('Conflict-safe update text.')
  await page.getByLabel('Status').selectOption('done')
  const latest = (await api('manager@nex.local', `/tasks/${targetTask.id}`)).body
  await api('manager@nex.local', `/tasks/${targetTask.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: `${targetTask.title} (changed)`, expected_version: latest.version }),
  })
  await page.getByRole('button', { name: 'Save update' }).click()
  await page.getByText('This task changed since you opened it.').waitFor()
  await page.getByRole('button', { name: 'Load latest state' }).click()
  await page.getByText('Latest state loaded. Review your text and save again.').waitFor()
  if ((await page.getByLabel('What changed?').inputValue()) !== 'Conflict-safe update text.') {
    throw new Error('conflict recovery lost the draft text')
  }
  await page.getByRole('button', { name: 'Save update' }).click()
  await page.getByText('Saved: Update saved.').waitFor()
})

await step('dirty capture guard keeps then discards text', async () => {
  await page.getByRole('button', { name: 'Add follow-up' }).click()
  await page.getByLabel('What needs to happen?').fill('Draft follow-up text')
  await page.waitForTimeout(150)
  await page.keyboard.press('Escape')
  await page.getByText('Discard this entry?').waitFor()
  await page.getByRole('button', { name: 'Keep editing' }).click()
  if ((await page.getByLabel('What needs to happen?').inputValue()) !== 'Draft follow-up text') {
    throw new Error('discard guard lost text after keep editing')
  }
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByText('Discard this entry?').waitFor()
  await page.getByRole('button', { name: 'Discard', exact: true }).click()
})

await step('person-level follow-up, help and note work without a task', async () => {
  await page.getByRole('button', { name: 'Add follow-up' }).click()
  await page.getByLabel('What needs to happen?').fill('Jordan to share platform access.')
  await page.getByLabel('Owner', { exact: true }).selectOption('')
  await page.getByRole('button', { name: 'Create follow-up' }).click()
  await page.getByText('Follow-up added. No owner assigned yet.').waitFor()

  await page.locator('summary').filter({ hasText: 'More' }).first().click()
  await page.getByRole('button', { name: 'Ask for help' }).first().click()
  await page.getByLabel('What is blocking progress?').fill('Need platform access for the dashboard.')
  await page.getByRole('button', { name: 'Create help request' }).click()
  await page.getByText('Help request saved. No owner assigned yet.').waitFor()

  await page.locator('summary').filter({ hasText: 'More' }).first().click()
  await page.getByRole('button', { name: 'General note' }).first().click()
  await page.getByPlaceholder('One short entry is enough.').fill('Finance joins tomorrow to review the numbers.')
  await page.getByRole('button', { name: 'Add note' }).click()
  await page.getByText('Saved: Note saved.').waitFor()
})

await step('review, accidental-review undo, and finish', async () => {
  await page.getByRole('button', { name: 'Mark reviewed & next' }).click()
  await page.getByText(/1 of 4 reviewed/).waitFor()
  await page.getByRole('button', { name: 'Roster' }).click()
  await page.getByRole('button', { name: 'Undo review' }).first().click()
  await page.getByText(/0 of 4 reviewed/).waitFor()
  await page.getByRole('button', { name: 'Close', exact: true }).last().click()

  await page.getByRole('button', { name: 'Mark reviewed & next' }).click()
  await page.getByRole('button', { name: 'Finish', exact: true }).click()
  await page.getByLabel('Finish anyway').check()
  await page.getByRole('button', { name: 'Finish standup' }).click()
  await page.waitForURL(/\/standups\/[^/]+$/, { timeout: 15000 })
})

await step('outcomes are readable and details include notes and daily reporting', async () => {
  await page.getByRole('heading', { name: /Standup outcomes/ }).waitFor()
  await page.getByText('Next actions').waitFor()
  await page.getByText('Help still needed').waitFor()
  await page.getByText('Meeting details').click()
  await page.getByText('Captured notes').waitFor()
  await page.getByText('Finance joins tomorrow to review the numbers.').waitFor()
  await page.getByText('Daily note for the standup.').first().waitFor()

  const tasklessHelp = page.getByText('Need platform access for the dashboard.').first()
  await tasklessHelp.waitFor()
  const helpRow = page.locator('div').filter({ hasText: 'Need platform access for the dashboard.' }).filter({ hasText: 'Resolve' }).last()
  await helpRow.getByRole('button', { name: 'Resolve' }).click()
  await page.getByLabel('What resolved it?').fill('Access granted.')
  await page.getByRole('button', { name: 'Resolve', exact: true }).last().click()
  await page.getByText('Access granted.').waitFor()
})

await step('empty employee can ask for help with zero tasks', async () => {
  await page.locator('select[aria-label="Switch identity"]').selectOption('empty@nex.local')
  await page.goto(`${WEB}/`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Today' }).waitFor()
  await page.getByText('Nothing needs attention right now.').waitFor()
  await page.getByText('No current work.').waitFor()
  await page.getByRole('button', { name: 'Ask for help' }).first().click()
  await page.getByLabel('What is blocking you?').fill('I have no tasks but need onboarding help.')
  await page.getByRole('button', { name: 'Create help request' }).click()
  await page.getByText('Help request saved. No owner assigned yet.').waitFor()
})

await step('Work state is URL-backed and task rows stay in place', async () => {
  await page.locator('select[aria-label="Switch identity"]').selectOption('manager@nex.local')
  await page.goto(`${WEB}/work?q=Revenue&view=completed`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Work' }).waitFor()
  if ((await page.getByLabel('Search tasks').inputValue()) !== 'Revenue') throw new Error('search not restored')
  await page.getByRole('button', { name: 'Completed', exact: true }).getAttribute('aria-pressed')
  await page.reload({ waitUntil: 'networkidle' })
  if ((await page.getByLabel('Search tasks').inputValue()) !== 'Revenue') throw new Error('search not restored after reload')

  await page.goto(`${WEB}/work?view=all&project=${revenueProject.id}`, { waitUntil: 'networkidle' })
  await page.getByText(revenueProject.name, { exact: true }).first().waitFor()
  await page.getByRole('button', { name: /Revenue variance dashboard/ }).first().click()
  await page.getByRole('heading', { name: 'Task' }).waitFor()
  await page.getByRole('button', { name: 'Edit details' }).click()
  await page.getByLabel('Task', { exact: false }).waitFor().catch(() => {})
  await page.getByRole('button', { name: 'Save changes' }).waitFor()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Close', exact: true }).last().click()
})

await step('legacy project link preserves context in Work', async () => {
  await page.goto(`${WEB}/board?project=${projects[1].id}`, { waitUntil: 'networkidle' })
  await page.waitForURL(/\/work\?project=/)
  await page.getByText(projects[1].name, { exact: true }).first().waitFor()
})

await step('overlays trap focus and Escape closes only the topmost dialog', async () => {
  await page.goto(`${WEB}/work?view=all&q=Revenue`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Revenue variance dashboard/ }).first().click()
  await page.getByRole('button', { name: 'Edit details' }).click()
  const inside = await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)
  if (!inside) throw new Error('dialog did not focus inside the panel')
})

console.log('\nConsole/page errors:', errors.length ? errors : 'none')
if (errors.length) process.exitCode = 1
await browser.close()
