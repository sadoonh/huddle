import { useEffect } from 'react'

function isVisible(element: HTMLElement): boolean {
  if (element.getClientRects().length === 0) return false
  const style = window.getComputedStyle(element)
  return style.visibility !== 'hidden' && style.display !== 'none'
}

function enabledPrimaryButtons(root: ParentNode): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('button.btn-primary')).filter(
    (button) =>
      !button.disabled &&
      button.getAttribute('aria-busy') !== 'true' &&
      isVisible(button),
  )
}

/**
 * Ctrl/Cmd + Enter invokes the active blue (primary) button.
 *
 * - When a dialog/drawer/popover is open, only that topmost surface is eligible;
 *   its footer primary (last primary) wins over secondary in-body actions.
 * - Otherwise the first enabled primary button on the page is used.
 * - Disabled or busy primaries are skipped, so the shortcut never fakes an
 *   action the UI would not allow.
 */
export default function GlobalShortcuts(): null {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== 'Enter' ||
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.shiftKey ||
        event.repeat ||
        event.isComposing
      ) {
        return
      }

      // Let an open picker/menu own Enter first; submitting a dialog while a
      // tray is open is rarely what the user means.
      if (document.body.hasAttribute('data-popover-open')) return

      const dialogs = Array.from(
        document.querySelectorAll<HTMLElement>('[role="dialog"]'),
      ).filter(isVisible)

      const primary = dialogs.length
        ? enabledPrimaryButtons(dialogs[dialogs.length - 1]).at(-1)
        : enabledPrimaryButtons(document).at(0)

      if (!primary) return
      event.preventDefault()
      event.stopPropagation()
      primary.click()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  return null
}
