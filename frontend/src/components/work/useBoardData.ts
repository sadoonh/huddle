import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, query } from '../../lib/api'
import type { Page, Task, TaskStatus } from '../../lib/types'

export const LANE_PAGE_SIZE = 20
export const LANE_LIMIT_CAP = 200
export const BOARD_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'done', 'canceled']

/** Backlog is grouped into the To Do lane without changing stored records. */
export function laneStatuses(status: TaskStatus): TaskStatus[] {
  return status === 'todo' ? ['todo', 'backlog'] : [status]
}

export interface BoardLane {
  status: TaskStatus
  items: Task[]
  total: number
  loaded: number
  loading: boolean
  refreshing: boolean
  error: string | null
  /** False when a status filter hides this lane's cards but keeps it droppable. */
  filteredOut: boolean
}

export interface UseBoardParams {
  projectId: string
  assigneeId: string
  priority: string
  blockedOnly: boolean
  search: string
  /** Lanes shown on the board (four by default, five with canceled). */
  statuses: TaskStatus[]
  /** Active status filter — empty means every status. */
  statusFilter: TaskStatus[]
}

interface LaneResult {
  items: Task[]
  total: number
  loading: boolean
  error: string | null
  queryKey: string
}

function emptyResults(): Record<TaskStatus, LaneResult> {
  return BOARD_STATUSES.reduce(
    (accumulator, status) => {
      accumulator[status] = { items: [], total: 0, loading: true, error: null, queryKey: '' }
      return accumulator
    },
    {} as Record<TaskStatus, LaneResult>,
  )
}

function initialPaging(): Record<TaskStatus, { pages: number; nonce: number }> {
  return BOARD_STATUSES.reduce(
    (accumulator, status) => {
      accumulator[status] = { pages: 1, nonce: 0 }
      return accumulator
    },
    {} as Record<TaskStatus, { pages: number; nonce: number }>,
  )
}

/** Most recently touched first, with a stable UUID tie-break. */
export function compareTasks(a: Task, b: Task): number {
  if (a.updated_at !== b.updated_at) return a.updated_at > b.updated_at ? -1 : 1
  return a.id < b.id ? -1 : 1
}

function mergeItems(items: Task[]): Task[] {
  const seen = new Map<string, Task>()
  for (const item of items) seen.set(item.id, item)
  return Array.from(seen.values()).sort(compareTasks)
}

/**
 * Per-lane board data. Each lane fetches its own status page range so one slow
 * or failing lane never blanks the rest of the board. Totals always come from
 * the server's filtered count.
 */
export function useBoardData(params: UseBoardParams) {
  const {
    projectId,
    assigneeId,
    priority,
    blockedOnly,
    search,
    statuses,
    statusFilter,
  } = params

  const [results, setResults] = useState<Record<TaskStatus, LaneResult>>(emptyResults)
  const [paging, setPaging] = useState(initialPaging)

  const queryKey = useMemo(
    () =>
      JSON.stringify({
        projectId,
        assigneeId,
        priority,
        blockedOnly,
        search: search.trim(),
        statusFilter,
      }),
    [projectId, assigneeId, priority, blockedOnly, search, statusFilter],
  )

  const visibleKey = statuses.slice().sort().join(',')
  const pagingKey = statuses.map((status) => `${status}:${paging[status].pages}:${paging[status].nonce}`).join(',')

  // A changed filter/scope starts every lane at page one.
  useEffect(() => {
    setPaging((current) => {
      let changed = false
      const next = { ...current }
      for (const status of BOARD_STATUSES) {
        if (current[status].pages !== 1) {
          next[status] = { ...current[status], pages: 1 }
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [queryKey])

  useEffect(() => {
    let alive = true

    setResults((current) => {
      const next = { ...current }
      for (const status of statuses) {
        const previous = current[status]
        next[status] =
          previous.queryKey === queryKey
            ? { ...previous, loading: true, error: null }
            : { ...previous, items: [], total: 0, loading: true, error: null, queryKey }
      }
      return next
    })

    for (const status of statuses) {
      if (statusFilter.length > 0 && !statusFilter.includes(status)) {
        setResults((current) => ({
          ...current,
          [status]: {
            items: [],
            total: 0,
            loading: false,
            error: null,
            queryKey,
          },
        }))
        continue
      }
      const pages = paging[status]?.pages ?? 1
      const limit = Math.min(pages * LANE_PAGE_SIZE, LANE_LIMIT_CAP)
      api
        .get<Page<Task>>(
          `/tasks${query({
            project_id: projectId || undefined,
            assignee_id: assigneeId || undefined,
            priority: priority || undefined,
            blocked: blockedOnly || undefined,
            q: search.trim() || undefined,
            status: laneStatuses(status),
            limit,
            offset: 0,
          })}`,
        )
        .then((page) => {
          if (!alive) return
          setResults((current) => ({
            ...current,
            [status]: {
              items: mergeItems(page.items),
              total: page.total,
              loading: false,
              error: null,
              queryKey,
            },
          }))
        })
        .catch((caught: Error) => {
          if (!alive) return
          setResults((current) => ({
            ...current,
            [status]: {
              items: current[status].queryKey === queryKey ? current[status].items : [],
              total: current[status].queryKey === queryKey ? current[status].total : 0,
              loading: false,
              error: caught.message || 'Could not load this column.',
              queryKey,
            },
          }))
        })
    }

    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, visibleKey, pagingKey])

  const loadMore = useCallback((status: TaskStatus) => {
    setPaging((current) => ({
      ...current,
      [status]: { ...current[status], pages: Math.min(current[status].pages + 1, LANE_LIMIT_CAP / LANE_PAGE_SIZE) },
    }))
  }, [])

  const refresh = useCallback((status?: TaskStatus) => {
    if (status) {
      setPaging((current) => ({
        ...current,
        [status]: { ...current[status], nonce: current[status].nonce + 1 },
      }))
      return
    }
    setPaging((current) => {
      const next = { ...current }
      for (const key of BOARD_STATUSES) next[key] = { ...current[key], nonce: current[key].nonce + 1 }
      return next
    })
  }, [])

  const patchLocal = useCallback((task: Task) => {
    setResults((current) => {
      const next = { ...current }
      for (const status of BOARD_STATUSES) {
        const lane = current[status]
        const index = lane.items.findIndex((item) => item.id === task.id)
        if (index === -1) continue
        const items = lane.items.slice()
        if (laneStatuses(status).includes(task.status)) {
          items[index] = task
        } else {
          items.splice(index, 1)
        }
        next[status] = { ...lane, items }
      }
      return next
    })
  }, [])

  const applyMove = useCallback(
    (task: Task, to: TaskStatus) => {
      if (task.status === to) return
      setResults((current) => {
        const next = { ...current }
        for (const status of BOARD_STATUSES) {
          const lane = current[status]
          const index = lane.items.findIndex((item) => item.id === task.id)
          if (index === -1) continue
          const items = lane.items.slice()
          items.splice(index, 1)
          next[status] = {
            ...lane,
            items,
            total: Math.max(lane.total - 1, 0),
          }
        }
        const target = next[to] ?? current[to]
        if (next[to]) {
          next[to] = {
            ...target,
            items: mergeItems([{ ...task, status: to }, ...target.items]),
            total: target.total + 1,
          }
        }
        return next
      })
    },
    [],
  )

  const removeLocal = useCallback((taskId: string) => {
    setResults((current) => {
      const next = { ...current }
      for (const status of BOARD_STATUSES) {
        const lane = current[status]
        if (!lane.items.some((item) => item.id === taskId)) continue
        next[status] = {
          ...lane,
          items: lane.items.filter((item) => item.id !== taskId),
          total: Math.max(lane.total - 1, 0),
        }
      }
      return next
    })
  }, [])

  const lanes = useMemo(() => {
    return BOARD_STATUSES.reduce(
      (accumulator, status) => {
        const result = results[status]
        const filteredOut = statusFilter.length > 0 && !statusFilter.includes(status)
        accumulator[status] = {
          status,
          items: result.items,
          total: result.total,
          loaded: result.items.length,
          loading: result.loading,
          refreshing: result.loading && result.items.length > 0,
          error: result.error,
          filteredOut,
        }
        return accumulator
      },
      {} as Record<TaskStatus, BoardLane>,
    )
  }, [results, statusFilter])

  return { lanes, loadMore, refresh, patchLocal, applyMove, removeLocal, queryKey }
}
