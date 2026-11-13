import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import { Loading } from './components/ui'
import { useAuth } from './lib/auth'
import { PILOT_ENABLED } from './lib/config'
import AIReviewPage from './pages/AIReview'
import BoardPage from './pages/Board'
import IntakePage from './pages/Intake'
import LoginPage from './pages/Login'
import NotFoundPage from './pages/NotFound'
import ProjectsPage from './pages/Projects'
import SessionPage from './pages/Session'
import StandupsPage from './pages/Standups'
import TodayPage from './pages/Today'
import WorkPage from './pages/Work'
import WorkspacePage from './pages/Workspace'

function LegacyBoardRedirect() {
  const location = useLocation()
  return <Navigate to={`/work${location.search}`} replace />
}

export default function App() {
  const { me, loading } = useAuth()

  if (loading && !me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <Loading label="Connecting to the standup workspace…" />
      </div>
    )
  }

  if (!me) return <LoginPage />

  return (
    <Routes key={me.id}>
      {/* Focused meeting mode intentionally has no global navigation. */}
      <Route path="standups/:sessionId/live" element={<WorkspacePage />} />

      <Route element={<Layout />}>
        <Route index element={<TodayPage />} />
        <Route path="work" element={<WorkPage />} />
        <Route path="standups" element={<StandupsPage />} />
        <Route path="standups/:sessionId" element={<SessionPage />} />
        <Route path="settings/projects" element={<ProjectsPage />} />
        {PILOT_ENABLED ? (
          <>
            <Route path="intake" element={<IntakePage />} />
            <Route path="ai" element={<AIReviewPage />} />
            <Route path="legacy/board" element={<BoardPage />} />
          </>
        ) : (
          <>
            <Route path="intake" element={<Navigate to="/" replace />} />
            <Route path="ai" element={<Navigate to="/" replace />} />
            <Route path="legacy/board" element={<Navigate to="/work" replace />} />
          </>
        )}

        {/* Preserve old URLs without keeping old destinations. */}
        <Route path="standup/today" element={<Navigate to="/" replace />} />
        <Route path="board" element={<LegacyBoardRedirect />} />
        <Route path="projects" element={<Navigate to="/settings/projects" replace />} />
        <Route path="dashboard" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
