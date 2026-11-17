import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { TASK_STATUSES, type Task, type TaskStatus } from '../../lib/types'

interface DragState {
  task: Task
  x: number
  y: number
  offsetX: number
  offsetY: number
  width: number
}

/**
 * Pointer drag for the desktop board. A deliberate 6px threshold starts the
 * drag, so selecting text, clicking a title or opening a menu never moves a
 * task. Touch is intentionally excluded: native scrolling stays usable and
 * Move to… is the touch path.
 */
export function useBoardDrag({
  onCommit,
  enabled,
}: {
  onCommit: (task: Task, to: TaskStatus) => void
  enabled: boolean
}) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const [overStatus, setOverStatus] = useState<TaskStatus | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(
    () => () => {
      cleanupRef.current?.()
    },
    [],
  )

  const beginPointerDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>, task: Task) => {
      if (!enabled || event.button !== 0 || event.pointerType !== 'mouse' || !task.can_move) return
      const element = event.currentTarget
      const rect = element.getBoundingClientRect()
      const start = {
        task,
        x0: event.clientX,
        y0: event.clientY,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        width: rect.width,
        started: false,
      }

      function laneAt(x: number, y: number): TaskStatus | null {
        const node = document.elementFromPoint(x, y)
        const lane = node instanceof Element ? node.closest('[data-lane-status]') : null
        return (lane as HTMLElement | null)?.dataset.laneStatus as TaskStatus | null ?? null
      }

      function onMove(moveEvent: PointerEvent) {
        const dx = moveEvent.clientX - start.x0
        const dy = moveEvent.clientY - start.y0
        if (!start.started && Math.hypot(dx, dy) < 6) return
        if (!start.started) {
          start.started = true
          document.body.style.userSelect = 'none'
          window.getSelection()?.removeAllRanges()
        }
        setDrag({
          task,
          x: moveEvent.clientX,
          y: moveEvent.clientY,
          offsetX: start.offsetX,
          offsetY: start.offsetY,
          width: start.width,
        })
        setOverStatus(laneAt(moveEvent.clientX, moveEvent.clientY))
      }

      function onUp(upEvent: PointerEvent) {
        cleanupRef.current?.()
        if (!start.started) {
          setDrag(null)
          setOverStatus(null)
          return
        }
        // A drag that started on the title must not also open the detail sheet.
        const swallowClick = (clickEvent: MouseEvent) => {
          clickEvent.preventDefault()
          clickEvent.stopPropagation()
        }
        window.addEventListener('click', swallowClick, true)
        window.setTimeout(() => window.removeEventListener('click', swallowClick, true), 0)
        const to = laneAt(upEvent.clientX, upEvent.clientY)
        setDrag(null)
        setOverStatus(null)
        if (to && to !== start.task.status && start.task.can_move) onCommit(start.task, to)
      }

      function cleanup() {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        document.body.style.userSelect = ''
        cleanupRef.current = null
      }

      cleanupRef.current?.()
      cleanupRef.current = cleanup
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [enabled, onCommit],
  )

  return { drag, overStatus, beginPointerDrag }
}

export function DragOverlay({ drag, overStatus }: { drag: DragState | null; overStatus: TaskStatus | null }): ReactNode {
  if (!drag) return null
  return createPortal(
    <div
      aria-hidden="true"
      style={{
        left: drag.x - drag.offsetX,
        top: drag.y - drag.offsetY,
        width: drag.width,
      }}
      className="pointer-events-none fixed z-[60] origin-center scale-[1.015] rounded-card border border-accent/40 bg-raised p-3.5 shadow-drag"
    >
      <p className="line-clamp-3 text-[14px] font-medium leading-snug text-ink">{drag.task.title}</p>
      {drag.task.project_name && (
        <p className="mt-1 truncate text-xs text-ink-muted">{drag.task.project_name}</p>
      )}
      <p className="mt-1.5 text-[11px] font-medium text-accent">
        {overStatus && overStatus !== drag.task.status
          ? `Drop in ${TASK_STATUSES.find((status) => status.value === overStatus)?.label ?? overStatus}`
          : 'Move to another column'}
      </p>
    </div>,
    document.body,
  )
}
