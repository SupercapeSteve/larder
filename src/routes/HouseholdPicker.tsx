import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight, Plus, ShoppingBasket, Users } from 'lucide-react'
import { AppShell } from '@/components/AppShell'
import { FullPageSpinner } from '@/components/ui'
import { ErrorState } from '@/components/ErrorState'
import { useHouseholds } from '@/hooks/useHouseholds'
import { LAST_HOUSEHOLD_KEY, writeLocal } from '@/lib/storage'

export default function HouseholdPicker() {
  const navigate = useNavigate()
  const { data, isPending, isError, error, refetch } = useHouseholds()

  if (isPending) return <FullPageSpinner label="Loading households" />
  if (isError) {
    return (
      <ErrorState
        title="Couldn't load your households"
        message={error instanceof Error ? error.message : 'Something went wrong.'}
        onRetry={() => void refetch()}
      />
    )
  }

  const households = data ?? []

  return (
    <AppShell
      header={
        <div className="flex min-h-tap items-center gap-2 py-3">
          <ShoppingBasket className="h-6 w-6 text-larder-600 dark:text-larder-400" aria-hidden />
          <h1 className="text-lg font-semibold tracking-tight">Your households</h1>
        </div>
      }
    >
      <ul className="space-y-2 py-4">
        {households.map((household) => (
          <li key={household.id}>
            <button
              type="button"
              onClick={() => {
                writeLocal(LAST_HOUSEHOLD_KEY, household.id)
                navigate(`/h/${household.id}`)
              }}
              className="card flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-larder-100 dark:hover:bg-larder-800"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-semibold text-larder-950 dark:text-larder-50">
                  {household.name}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-xs text-larder-600 dark:text-larder-400">
                  <Users className="h-3.5 w-3.5" aria-hidden />
                  {household.memberCount} {household.memberCount === 1 ? 'member' : 'members'}
                  {household.role === 'owner' ? ' · owner' : ''}
                </span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-larder-400" aria-hidden />
            </button>
          </li>
        ))}
      </ul>

      <Link to="/setup" className="btn-secondary mb-8 w-full gap-2">
        <Plus className="h-4 w-4" aria-hidden />
        Create or join another
      </Link>
    </AppShell>
  )
}
