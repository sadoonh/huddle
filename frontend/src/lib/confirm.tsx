import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { Modal } from '../components/ui'

export interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<{
    options: ConfirmOptions
    resolve: (value: boolean) => void
  } | null>(null)

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        setPending({ options, resolve })
      }),
    [],
  )

  function finish(value: boolean) {
    pending?.resolve(value)
    setPending(null)
  }

  const value = useMemo(() => confirm, [confirm])

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Modal
        open={Boolean(pending)}
        onClose={() => finish(false)}
        title={pending?.options.title ?? 'Confirm'}
        description={pending?.options.description}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => finish(false)} autoFocus>
              {pending?.options.cancelLabel ?? 'Cancel'}
            </button>
            <button
              type="button"
              className={`btn ${pending?.options.tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
              onClick={() => finish(true)}
            >
              {pending?.options.confirmLabel ?? 'Continue'}
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          This action cannot be completed until you choose whether to continue.
        </p>
      </Modal>
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const context = useContext(ConfirmContext)
  if (!context) throw new Error('useConfirm must be used inside ConfirmProvider')
  return context
}
