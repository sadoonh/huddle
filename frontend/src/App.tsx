import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { Loading } from './components/ui'
import { useAuth } from './lib/auth'
import AIReviewPage from './pages/AIReview'
import BoardPage from './pages/Board'
import DashboardPage from './pages/Dashboard'
import IntakePage from './pages/Intake'
import LoginPage from './pages/Login'
import ProjectsPage from './pages/Projects'
import SessionPage from './pages/Session'
import StandupsPage from './pages/Standups'
import TodayStandupPage from './pages/TodayStandup'
import WorkspacePage from './pages/Workspace'

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
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="standup/today" element={<TodayStandupPage />} />
        <Route path="standups" element={<StandupsPage />} />
        <Route path="standups/:sessionId" element={<SessionPage />} />
        <Route path="standups/:sessionId/live" element={<WorkspacePage />} />
        <Route path="board" element={<BoardPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="intake" element={<IntakePage />} />
        <Route path="ai" element={<AIReviewPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
