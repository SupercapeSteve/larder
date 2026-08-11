import { Route, Routes } from 'react-router-dom'
import { AuthProvider } from '@/hooks/useAuth'
import { ToastProvider } from '@/components/Toast'
import { ProtectedRoute, PublicOnlyRoute } from '@/components/ProtectedRoute'
import { InstallHint } from '@/components/InstallHint'
import { OfflineBanner } from '@/components/OfflineBanner'
import SignIn from '@/routes/SignIn'
import SignUp from '@/routes/SignUp'
import ForgotPassword from '@/routes/ForgotPassword'
import UpdatePassword from '@/routes/UpdatePassword'
import HouseholdGate from '@/routes/HouseholdGate'
import Setup from '@/routes/Setup'
import HouseholdPicker from '@/routes/HouseholdPicker'
import HouseholdDetail from '@/routes/HouseholdDetail'
import ListScreen from '@/routes/ListScreen'
import SiriSettings from '@/routes/SiriSettings'
import Account from '@/routes/Account'
import NotFound from '@/routes/NotFound'

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <OfflineBanner />

        <Routes>
          {/* Reachable signed out or signed in: a recovery link establishes a
              session, so gating this either way locks somebody out. */}
          <Route path="/update-password" element={<UpdatePassword />} />

          <Route element={<PublicOnlyRoute />}>
            <Route path="/signin" element={<SignIn />} />
            <Route path="/signup" element={<SignUp />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
          </Route>

          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<HouseholdGate />} />
            <Route path="/setup" element={<Setup />} />
            <Route path="/households" element={<HouseholdPicker />} />
            <Route path="/h/:householdId" element={<ListScreen />} />
            <Route path="/h/:householdId/household" element={<HouseholdDetail />} />
            <Route path="/h/:householdId/siri" element={<SiriSettings />} />
            <Route path="/account" element={<Account />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>

        <InstallHint />
      </ToastProvider>
    </AuthProvider>
  )
}
