import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, ClipboardCopy } from 'lucide-react'
import { copyDiagnostics } from '@/lib/diagnostics'

type Props = { children: ReactNode }
type State = { error: Error | null; copied: boolean }

/**
 * Last line of defence. A render crash inside the PWA is otherwise a white
 * screen with no way out — no address bar, no reload button, nothing.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, copied: false }

  static getDerivedStateFromError(error: Error): State {
    return { error, copied: false }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[larder] render crash:', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="safe-top safe-bottom safe-x flex min-h-full flex-col items-center justify-center bg-larder-50 px-6 py-10 text-center dark:bg-larder-950">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
          <AlertTriangle className="h-6 w-6" aria-hidden />
        </div>

        <h1 className="text-lg font-semibold text-larder-950 dark:text-larder-50">
          Larder hit a snag
        </h1>

        <p className="mt-2 max-w-md text-sm text-larder-600 dark:text-larder-400">
          Something in the app crashed. Reloading usually clears it — your list is safe on the
          server.
        </p>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <button type="button" className="btn-primary" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => window.location.assign('/')}
          >
            Back to the list
          </button>
        </div>

        <button
          type="button"
          className="btn-ghost mt-3 gap-2 text-sm"
          onClick={() => {
            void copyDiagnostics(error).then((ok) => {
              this.setState({ copied: ok })
              setTimeout(() => this.setState({ copied: false }), 2500)
            })
          }}
        >
          <ClipboardCopy className="h-4 w-4" aria-hidden />
          {this.state.copied ? 'Copied' : 'Copy diagnostics'}
        </button>

        <details className="mt-6 max-w-md text-left">
          <summary className="cursor-pointer text-xs text-larder-500">Technical detail</summary>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-larder-100 p-3 text-left text-[11px] text-larder-700 dark:bg-larder-900 dark:text-larder-300">
            {error.message}
          </pre>
        </details>
      </div>
    )
  }
}
