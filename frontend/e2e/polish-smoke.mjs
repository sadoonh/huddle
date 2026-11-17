import { chromium } from 'playwright'

// Browser regression smoke for the Tasks / Huddle / Projects product.
//
// Prerequisites:
//   1. backend seeded and running:  cd backend && python -m app.seed --reset
//                                   uvicorn app.main:app --port 8000
//   2. frontend running:            cd frontend && npm run dev
//   3. browser available:           npx playwright install chromium
//
// The script mutates the demo database (status, notes and a completed Huddle),
// so reseed before each run.
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

const users = (await api('manager@nex.local', '/users')).body
const priya = users.find((user) => user.email === 'priya@nex.local')
const projects = (await api('manager@nex.local', '/projects')).body
const revenueProject = projects.find((project) => project.name === 'Revenue Reporting')
const adHocProject = projects.find((project) => project.system_key === 'ad_hoc')
const tasks = (await api('manager@nex.local', '/tasks?limit=200')).body.items
const backlogTask = tasks.find((task) => task.status === 'backlog')
const todoTask = tasks.find((task) => task.status === 'todo')
const moveTask = tasks.find((task) => task.status === 'in_progress')
const blockedTask = tasks.find((task) => task.blocked_by)

if (!backlogTask || !todoTask) throw new Error('seed needs backlog and todo tasks')

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
const errors = []
page.on('console', (msg) => {
  if (msg.type() === 'error' && !msg.text().includes('409')) errors.push(`console: ${msg.text()}`)
})
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))

const step = async (name, fn) => {
  process.stdout.write(`• ${name} … `)
  await fn()
  console.log('ok')
}

await page.goto(`${WEB}/tasks`, { waitUntil: 'networkidle' })

await step('header has Tasks and a real account menu', async () => {
  await page.getByRole('heading', { name: 'Tasks' }).waitFor()
  const links = await page.locator('nav[aria-label="Primary"] > a').allTextContents()
  if (links.join(',') !== 'Tasks') throw new Error(`unexpected nav: ${links.join(',')}`)
  for (const label of ['Projects', 'Today', 'Past standups', 'Pilot tools']) {
    if (await page.getByText(label, { exact: true }).count()) throw new Error(`${label} is still present`)
  }
  const account = page.getByRole('button', { name: /Account menu for/ })
  await account.click()
  const menu = page.getByRole('menu', { name: 'Account' })
  await menu.waitFor()
  await menu.getByText('manager@nex.local').waitFor()
  await menu.getByText('Manager', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await menu.waitFor({ state: 'detached' })
  if (!(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')?.startsWith('Account menu')))) {
    throw new Error('focus did not return to the account trigger')
  }
})

await step('Tab from a neutral page focus toggles Board and Table only', async () => {
  await page.goto(`${WEB}/tasks?layout=board`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  await page.evaluate(() => document.body.focus())
  await page.keyboard.press('Tab')
  await page.waitForTimeout(500)
  if (!page.url().includes('layout=table')) throw new Error('Tab did not switch to Table')
  const tabFocus = await page.evaluate(() => ({
    role: document.activeElement?.getAttribute('role'),
    selected: document.activeElement?.getAttribute('aria-selected'),
  }))
  if (tabFocus.role !== 'tab' || tabFocus.selected !== 'true') {
    throw new Error(`Tab did not leave focus on the active presentation tab: ${JSON.stringify(tabFocus)}`)
  }

  // Once focus is inside a control, Tab is normal focus navigation and must
  // not keep toggling the presentation.
  await page.keyboard.press('Tab')
  await page.waitForTimeout(300)
  if (!page.url().includes('layout=table')) throw new Error('Tab toggled again from a control')
  if ((await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))) !== 'Search tasks') {
    throw new Error('Tab did not move from the presentation tab into the toolbar')
  }
  await page.getByRole('tab', { name: 'Board' }).click()
  await page.waitForTimeout(500)
})

await step('Ctrl+Enter invokes the active blue primary action', async () => {
  await page.keyboard.press('Control+Enter')
  const createDialog = page.getByRole('dialog')
  await createDialog.waitFor()
  await page.waitForTimeout(250)
  if ((await page.evaluate(() => document.activeElement?.id)) !== 'new-task-title') {
    throw new Error('New task did not focus the Title field')
  }
  const create = page.getByRole('button', { name: 'Create task' })
  if (!(await create.isDisabled())) throw new Error('Create task should be disabled with an empty title')
  await page.keyboard.press('Control+Enter')
  if (!(await createDialog.count())) throw new Error('shortcut submitted a disabled primary action')
  await page.getByLabel('Title').fill('Shortcut created task')
  await page.keyboard.press('Control+Enter')
  await page.waitForTimeout(1200)
  await page.getByText('Task created.').first().waitFor()
  const created = (await api('manager@nex.local', '/tasks?q=Shortcut%20created%20task&limit=5')).body.items[0]
  if (!created) throw new Error('shortcut did not create the task')

  await page.getByLabel('Search tasks').fill('Schema drift alerting')
  await page.waitForTimeout(700)
  await page.getByText('Schema drift alerting', { exact: true }).first().click()
  const updateDialog = page.getByRole('dialog')
  await updateDialog.waitFor()
  await page.waitForTimeout(250)
  if ((await page.evaluate(() => document.activeElement?.id)) !== 'task-update-text') {
    throw new Error('Update dialog did not focus the Add update field')
  }
  await page.getByLabel('Add update').fill('Shortcut saved update.')
  await page.keyboard.press('Control+Enter')
  await page.getByText('Update saved.').first().waitFor()
  await updateDialog.getByText('Shortcut saved update.').waitFor()
  await updateDialog.getByRole('button', { name: 'Close', exact: true }).last().click()
  await page.getByLabel('Search tasks').fill('')
  await page.waitForTimeout(700)
})

await step('To Do groups backlog and todo with one gray lane', async () => {
  const lanes = page.locator('[data-lane-status]')
  if ((await lanes.count()) !== 3) throw new Error(`expected 3 lanes, got ${await lanes.count()}`)
  const labels = await page.locator('[data-lane-status] h2').allTextContents()
  if (labels.join(',') !== 'To Do,In Progress,Done') throw new Error(`unexpected lanes: ${labels.join(',')}`)
  if (await page.getByRole('heading', { name: 'Backlog' }).count()) throw new Error('Backlog lane is still visible')

  const todoLane = page.locator('[data-lane-status="todo"]')
  await todoLane.getByText(backlogTask.title).waitFor()
  await todoLane.getByText(todoTask.title).waitFor()
  const dotColor = await todoLane.locator('header span.rounded-full').first().evaluate((node) => getComputedStyle(node).backgroundColor)
  if (dotColor !== 'rgb(165, 173, 181)') throw new Error(`To Do dot is not the backlog gray: ${dotColor}`)
})

await step('card owner avatar and name align with the title and public ID', async () => {
  const card = page.locator('article').filter({ hasText: todoTask.title }).first()
  const box = await card.evaluate((node) => {
    const title = node.querySelector('p')
    const avatar = node.querySelector('.rounded-full[title]')
    return {
      title: title?.getBoundingClientRect().left ?? -1,
      avatar: avatar?.getBoundingClientRect().left ?? -2,
    }
  })
  if (Math.abs(box.title - box.avatar) > 1) throw new Error(`owner is not aligned with task title: ${JSON.stringify(box)}`)

  const blockedCard = page.locator('article').filter({ hasText: blockedTask.title }).first()
  await blockedCard.getByText('Blocked', { exact: true }).waitFor()
  const padding = await blockedCard.evaluate((node) => {
    const card = node.getBoundingClientRect()
    const title = node.querySelector('p')?.getBoundingClientRect()
    const badge = [...node.querySelectorAll('span')].find(
      (element) => element.textContent?.trim() === 'Blocked',
    )?.getBoundingClientRect()
    const priority = [...node.querySelectorAll('span')]
      .find((element) => element.getAttribute('aria-label')?.startsWith('Priority:'))
      ?.getBoundingClientRect()
    return {
      left: title ? title.left - card.left : -1,
      right: badge ? card.right - badge.right : -2,
      priorityTop: priority ? priority.top - card.top : -3,
      priorityRight: priority ? card.right - priority.right : -4,
    }
  })
  if (Math.abs(padding.left - padding.right) > 1) {
    throw new Error(`Blocked badge padding is not symmetric with the owner: ${JSON.stringify(padding)}`)
  }
  if (padding.priorityTop > 20 || padding.priorityRight > 20) {
    throw new Error(`priority is not in the card's top-right corner: ${JSON.stringify(padding)}`)
  }
})

await step('filters expose To Do without Backlog and keep both presentations aligned', async () => {
  await page.getByRole('button', { name: /^Filters/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Task filters' })
  await dialog.waitFor()
  const statusLabels = await dialog.locator('label').filter({ has: page.locator('input[type="checkbox"]') }).allTextContents()
  if (statusLabels.some((label) => label.includes('Backlog'))) throw new Error('Backlog filter remains')
  if (!statusLabels.some((label) => label.trim() === 'To Do')) throw new Error('To Do filter is missing')

  await page.waitForTimeout(800)
  await dialog.getByRole('button', { name: /^Owner:/ }).click()
  const unassigned = page.getByRole('option', { name: 'Unassigned', exact: true })
  await unassigned.waitFor()
  await unassigned.click()
  await dialog.getByRole('button', { name: /^Project:/ }).click()
  await page.getByRole('option', { name: 'Revenue Reporting' }).click()
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  await page.waitForTimeout(700)
  await page.getByRole('button', { name: /Remove filter Unassigned/ }).waitFor()
  await page.getByRole('button', { name: /Remove filter Revenue Reporting/ }).waitFor()
  await page.getByRole('tab', { name: 'Table' }).click()
  await page.waitForTimeout(900)
  if (
    !page.url().includes('layout=table') ||
    !page.url().includes(`project=${revenueProject.id}`) ||
    !page.url().includes('assignee=unassigned')
  ) {
    throw new Error('layout switch lost the project or unassigned filter')
  }
})

await step('table status picker offers To Do, updates and undoes', async () => {
  const clear = page.getByRole('button', { name: 'Clear filters' })
  if (await clear.count()) {
    await clear.click()
    await page.waitForTimeout(500)
  }
  await page.getByLabel('Search tasks').fill(moveTask.title)
  await page.waitForTimeout(700)
  const row = page.locator('table[aria-label="Tasks table"] tbody tr').filter({ hasText: moveTask.title }).first()
  await row.getByRole('button', { name: new RegExp(`^Status for ${moveTask.title}`) }).click()
  if ((await page.getByRole('columnheader', { name: 'Priority', exact: true }).count()) !== 1) {
    throw new Error('Priority column is missing from the table')
  }
  const options = await page.getByRole('option').allTextContents()
  if (options.some((label) => label === 'Backlog')) throw new Error('Backlog remains a status option')
  if (!options.includes('To Do')) throw new Error('To Do is missing from the status options')
  await page.getByRole('option', { name: 'Done' }).click()
  await page.getByText('Moved to Done', { exact: true }).first().waitFor()
  await page.waitForTimeout(700)
  if ((await api('manager@nex.local', `/tasks/${moveTask.id}`)).body.status !== 'done') {
    throw new Error('table status did not persist')
  }
  await page.getByRole('button', { name: 'Undo' }).click()
  await page.getByText('Moved back to In Progress', { exact: true }).first().waitFor()
  await page.waitForTimeout(700)
})

await step('update composer label, status size and save button are compact', async () => {
  await page.getByLabel('Search tasks').fill('Schema drift alerting')
  await page.waitForTimeout(700)
  await page.getByText('Schema drift alerting', { exact: true }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  await dialog.getByText('Add update', { exact: true }).waitFor()
  if (await dialog.getByText('What changed?').count()) throw new Error('old What changed label remains')
  const statusTrigger = dialog.getByRole('button', { name: /^Update status/ })
  const font = await statusTrigger.evaluate((node) => getComputedStyle(node).fontSize)
  if (font !== '14px') throw new Error(`status picker font is ${font}, expected 14px`)
  const save = dialog.getByRole('button', { name: 'Save update' })
  const padding = await save.evaluate((node) => {
    const style = getComputedStyle(node)
    return { left: style.paddingLeft, right: style.paddingRight }
  })
  if (padding.left !== padding.right) throw new Error(`save button has asymmetrical padding: ${JSON.stringify(padding)}`)

  const blockedInput = dialog.getByLabel('Blocked by (optional)')
  await blockedInput.waitFor()

  // Blocked by is editable in the Task card but saved on the Task, not as an
  // update. It can be saved without adding progress text.
  if (await save.isEnabled()) throw new Error('Save update is enabled with no changes')
  await blockedInput.fill('Waiting on vendor confirmation')
  if (!(await save.isEnabled())) throw new Error('Blocked by change did not enable Save update')
  await save.click()
  await page.getByText('Task changes saved.').first().waitFor()
  await page.waitForTimeout(700)
  let savedTask = (await api('manager@nex.local', '/tasks?q=Schema%20drift&limit=5')).body.items[0]
  if (savedTask.blocked_by !== 'Waiting on vendor confirmation') {
    throw new Error(`task-level Blocked by did not persist: ${JSON.stringify(savedTask)}`)
  }

  // Status-only changes are still saveable without progress text.
  await dialog.getByRole('button', { name: /^Update status/ }).click()
  await page.getByRole('option', { name: 'In Progress' }).click()
  if (!(await save.isEnabled())) throw new Error('status-only change did not enable Save update')
  await save.click()
  await page.getByText('Task changes saved.').first().waitFor()
  await page.waitForTimeout(700)
  savedTask = (await api('manager@nex.local', '/tasks?q=Schema%20drift&limit=5')).body.items[0]
  if (savedTask.status !== 'in_progress' || savedTask.blocked_by !== 'Waiting on vendor confirmation') {
    throw new Error(`status-only save did not persist: ${JSON.stringify(savedTask)}`)
  }

  await dialog.getByLabel('Add update').fill('Smoke update from the live task view.')
  await save.click()
  await page.getByText('Update saved.').first().waitFor()
  await dialog.getByText('Smoke update from the live task view.').waitFor()
  await dialog.getByRole('button', { name: 'Close', exact: true }).last().click()
})

await step('one Huddle button starts, completes and returns directly to Tasks', async () => {
  await page.getByRole('button', { name: 'Huddle', exact: true }).click()
  await page.waitForURL(/\/standups\/[^/]+\/live/, { timeout: 15000 })
  await page.getByRole('heading', { name: 'In Progress', exact: true }).waitFor()
  if (await page.getByRole('heading', { name: 'Current work', exact: true }).count()) {
    throw new Error('Current work heading still renders in the Huddle')
  }
  const firstStandupRow = page.locator('[data-task-id]').first()
  if ((await firstStandupRow.innerText()).includes('Owner:')) {
    throw new Error('Huddle rows still repeat the task owner')
  }
  const doneDetails = page.locator('details').filter({
    has: page.getByRole('heading', { name: 'Done', exact: true }),
  })
  await doneDetails.waitFor()
  if (await doneDetails.evaluate((node) => node.open)) {
    throw new Error('Done section should start collapsed')
  }
  await doneDetails.locator('summary').click()
  if (!(await doneDetails.evaluate((node) => node.open))) {
    throw new Error('Done section did not expand')
  }
  await page.getByRole('button', { name: 'Mark reviewed & next' }).click()
  await page.getByRole('button', { name: 'Finish', exact: true }).click()
  await page.getByLabel('Finish anyway').check()
  await page.getByRole('button', { name: 'Finish Huddle' }).click()
  await page.waitForURL(/\/tasks/, { timeout: 15000 })
  await page.getByRole('heading', { name: 'Tasks' }).waitFor()

  // A completed Huddle remains available as a read-only layout through the
  // same button; it is not a past-standups archive.
  await page.getByRole('button', { name: 'Huddle', exact: true }).click()
  await page.waitForURL(/\/standups\/[^/]+\/live/, { timeout: 15000 })
  await page.getByText('Huddle complete').waitFor()
  if (await page.getByRole('button', { name: 'Finish', exact: true }).count()) {
    throw new Error('completed Huddle still offers Finish')
  }
  await page.getByRole('button', { name: /Back to Tasks|Tasks/ }).first().click()
  await page.waitForURL(/\/tasks/)
  if (await page.getByRole('button', { name: 'Leave', exact: true }).count()) {
    throw new Error('leaving the Huddle still asks for confirmation')
  }
})

await step('past standup routes and APIs are removed', async () => {
  await page.goto(`${WEB}/standups`, { waitUntil: 'networkidle' })
  await page.waitForURL(/\/tasks/)
  await page.goto(`${WEB}/standups/anything`, { waitUntil: 'networkidle' })
  await page.waitForURL(/\/tasks/)

  for (const path of [
    '/standups/sessions',
    '/standups/sessions/anything/outcomes',
    '/standups/sessions/anything/captures',
    '/standups/sessions/anything/timeline',
    '/standups/users/anything/history',
    '/standups/users/anything/carry-forward',
  ]) {
    const response = await api('manager@nex.local', path)
    if (response.status === 200) throw new Error(`removed endpoint still works: ${path}`)
  }
})

await step('New task defaults to Ad hoc and New project lives in Tasks', async () => {
  await page.goto(`${WEB}/tasks?layout=table`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'New task' }).first().click()
  await page.getByRole('button', { name: /^Project: Ad hoc/ }).waitFor()
  if (await page.getByRole('button', { name: /Add details/ }).count()) {
    throw new Error('new task still hides details behind a toggle')
  }
  const createDialog = page.getByRole('dialog')
  await createDialog.getByLabel('Description').waitFor()
  await createDialog.getByText("Saved as the task's first update.").waitFor()
  await createDialog.getByLabel('Priority').waitFor()
  await createDialog.getByLabel('Status').waitFor()
  await page.getByLabel('Title').fill('Smoke ad hoc task')
  await page.getByLabel('Description').fill('Kickoff context from the creator.')
  await page.getByLabel('Blocked by (optional)').fill('Waiting on vendor')
  await page.getByRole('button', { name: 'Create task' }).click()
  await page.waitForTimeout(1200)
  await page.getByText('Task created.').first().waitFor()
  const created = (await api('manager@nex.local', '/tasks?q=Smoke%20ad%20hoc&limit=5')).body.items[0]
  if (!created || created.project_id !== adHocProject.id) throw new Error('new task did not use Ad hoc')
  if (created.blocked_by !== 'Waiting on vendor') throw new Error('new task did not save task-level Blocked by')
  const firstUpdate = (await api('manager@nex.local', `/tasks/${created.id}/updates`)).body[0]
  if (firstUpdate?.progress !== 'Kickoff context from the creator.') {
    throw new Error('new task description did not become the first update')
  }

  // Owner column: an unassigned task shows a neutral label (not a fake "U"
  // avatar) and the inline owner control persists a reassignment.
  await page.getByLabel('Search tasks').fill('Smoke ad hoc task')
  await page.waitForTimeout(700)
  const ownerTrigger = page.locator('button[aria-label^="Owner for Smoke ad hoc task"]')
  if ((await ownerTrigger.innerText()).trim() !== 'Unassigned') {
    throw new Error(`unassigned owner label is wrong: ${await ownerTrigger.innerText()}`)
  }
  await ownerTrigger.click()
  await page.getByRole('option', { name: 'Priya Patel' }).click()
  await page.waitForTimeout(900)
  const reassigned = (await api('manager@nex.local', `/tasks/${created.id}`)).body
  if (reassigned.assignee?.id !== priya.id) throw new Error('table owner reassignment did not persist')
  await page.locator('button[aria-label^="Owner for Smoke ad hoc task"]').click()
  await page.getByRole('option', { name: 'Unassigned' }).click()
  await page.waitForTimeout(700)

  // The Projects destination is retired; its old URL returns to Tasks.
  await page.goto(`${WEB}/projects`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => location.pathname === '/tasks')
  if (await page.getByRole('heading', { name: 'Projects' }).count()) {
    throw new Error('Projects page still renders')
  }

  const projectName = `Smoke project ${Date.now()}`
  const actionSizes = await Promise.all(
    ['New project', 'Huddle', 'New task'].map(async (name) => {
      const box = await page.getByRole('button', { name, exact: true }).first().boundingBox()
      const font = await page
        .getByRole('button', { name, exact: true })
        .first()
        .evaluate((node) => getComputedStyle(node).fontSize)
      return { name, height: box?.height, font }
    }),
  )
  if (
    actionSizes.some((item) => item.height !== actionSizes[0].height || item.font !== actionSizes[0].font)
  ) {
    throw new Error(`New project button sizing differs: ${JSON.stringify(actionSizes)}`)
  }
  await page.getByRole('button', { name: 'New project' }).click()
  const projectDialog = page.getByRole('dialog')
  if (await projectDialog.getByLabel('Description').count()) {
    throw new Error('New project still asks for a description')
  }
  await projectDialog.getByLabel('Name').fill(projectName)
  await projectDialog.getByRole('button', { name: 'Create project' }).click()
  await page.getByText('Project created.').first().waitFor()
  const projects = (await api('manager@nex.local', '/projects')).body
  if (!projects.some((project) => project.name === projectName)) {
    throw new Error('New project button did not create a project')
  }
})

await step('narrow screens keep one lane and a bounded table', async () => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto(`${WEB}/tasks?layout=board`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  if ((await page.locator('[data-lane-status]').count()) !== 1) throw new Error('narrow board should show one lane')
  let overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  if (overflow > 0) throw new Error(`document overflow on tasks: ${overflow}px`)
  await page.goto(`${WEB}/tasks?layout=table`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  const tableScroll = await page.locator('table[aria-label="Tasks table"]').locator('..').evaluate((node) => ({
    scrollWidth: node.scrollWidth,
    clientWidth: node.clientWidth,
  }))
  if (tableScroll.scrollWidth <= tableScroll.clientWidth) throw new Error('table is not in a bounded scroll region')
  overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  if (overflow > 0) throw new Error(`document overflow on the table: ${overflow}px`)
})

console.log('\nConsole/page errors:', errors.length ? errors : 'none')
if (errors.length) process.exitCode = 1
await browser.close()
