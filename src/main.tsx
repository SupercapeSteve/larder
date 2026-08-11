import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ConfigError } from '@/components/ConfigError'
import { envError } from '@/lib/env'
import '@/index.css'

const container = document.getElementById('root')
if (!container) throw new Error('Larder could not start: #root element is missing from index.html')

const root = createRoot(container)

if (envError) {
  // Stop here. Importing the app would construct a Supabase client from empty
  // strings and fail with something far less useful than this screen.
  root.render(
    <StrictMode>
      <ConfigError error={envError} />
    </StrictMode>,
  )
} else {
  // Deliberately a promise chain rather than top-level await: TLA would force
  // the build target above Safari 14, and iOS Safari is the primary client.
  void Promise.all([
    import('@/App'),
    import('@tanstack/react-query'),
    import('react-router-dom'),
    import('@/lib/queryClient'),
  ]).then(([{ default: App }, { QueryClientProvider }, { BrowserRouter }, { queryClient }]) => {
    root.render(
      <StrictMode>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            {/* Opting into the v7 behaviours now keeps the console clean and
                makes the eventual upgrade a version bump, not a project. */}
            <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
              <App />
            </BrowserRouter>
          </QueryClientProvider>
        </ErrorBoundary>
      </StrictMode>,
    )
  })
}
