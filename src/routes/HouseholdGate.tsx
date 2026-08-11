import { Navigate } from 'react-router-dom'
import { FullPageSpinner } from '@/components/ui'
import { useHouseholds } from '@/hooks/useHouseholds'
import { LAST_HOUSEHOLD_KEY, readLocal } from '@/lib/storage'
import { ErrorState } from '@/components/ErrorState'

/**
 * Post-auth routing, per the spec:
 *   no household  → create/join
 *   one household → straight to the list
 *   several       → picker, unless we remember which one they were last in
 */
export default function HouseholdGate() {
  const { data, isPending, isError, error, refetch } = useHouseholds()

  if (isPending) return <FullPageSpinner label="Finding your household" />

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
  if (households.length === 0) return <Navigate to="/setup" replace />

  const remembered = readLocal(LAST_HOUSEHOLD_KEY)
  if (remembered && households.some((h) => h.id === remembered)) {
    return <Navigate to={`/h/${remembered}`} replace />
  }

  if (households.length === 1) return <Navigate to={`/h/${households[0].id}`} replace />

  return <Navigate to="/households" replace />
}
