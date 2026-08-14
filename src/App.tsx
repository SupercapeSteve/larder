import { Route, Routes } from 'react-router-dom'
import { AuthProvider } from '@/hooks/useAuth'
import { PreferencesProvider } from '@/hooks/usePreferences'
import { ToastProvider } from '@/components/Toast'
import { ProtectedRoute, PublicOnlyRoute } from '@/components/ProtectedRoute'
import { InstallHint } from '@/components/InstallHint'
import { OfflineBanner } from '@/components/OfflineBanner'
import SignIn from '@/routes/SignIn'
import SignUp from '@/routes/SignUp'
import ForgotPassword from '@/routes/ForgotPassword'
import UpdatePassword from '@/routes/UpdatePassword'
import Confirm from '@/routes/Confirm'
import HouseholdGate from '@/routes/HouseholdGate'
import Setup from '@/routes/Setup'
import HouseholdPicker from '@/routes/HouseholdPicker'
import HouseholdDetail from '@/routes/HouseholdDetail'
import ListScreen from '@/routes/ListScreen'
import Aisles from '@/routes/Aisles'
import SiriSettings from '@/routes/SiriSettings'
import Account from '@/routes/Account'
import NotFound from '@/routes/NotFound'

export default function App() {
  return (
    // PreferencesProvider is nested inside AuthProvider on purpose: preferences
    // are stored against the account, so it has to know who is signed in.
    <AuthProvider>
      <PreferencesProvider>
        <ToastProvider>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-xl focus:bg-larder-600 focus:px-4 focus:py-2 focus:text-white"
          >
            Skip to content
          </a>

          <OfflineBanner />

          <Routes>
            {/* Reachable signed out or signed in: these links establish a
                session themselves, so gating them either way locks someone out. */}
            <Route path="/update-password" element={<UpdatePassword />} />
            <Route path="/confirm" element={<Confirm />} />

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
              <Route path="/h/:householdId/aisles" element={<Aisles />} />
              <Route path="/h/:householdId/siri" element={<SiriSettings />} />
              <Route path="/account" element={<Account />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>

          <InstallHint />
        </ToastProvider>
      </PreferencesProvider>
    </AuthProvider>
  )
}
