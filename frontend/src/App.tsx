import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import { Loading } from './components/ui'
import { useAuth } from './lib/auth'
import LoginPage from './pages/Login'
import NotFoundPage from './pages/NotFound'
import RetiredPage from './pages/Retired'
import TasksPage from './pages/Tasks'
import WorkspacePage from './pages/Workspace'

function preserveQuery(pathname: string, search: string): string {
  return search ? `${pathname}${search}` : pathname
}

function LegacyBoardRedirect() {
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  params.set('layout', 'board')
  return <Navigate to={`/tasks?${params.toString()}`} replace />
}

function WorkRedirect() {
  const location = useLocation()
  return <Navigate to={preserveQuery('/tasks', location.search)} replace />
}

export default function App() {
  const { me, loading } = useAuth()

  if (loading && !me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <Loading label="Connecting to the Huddle workspace…" />
      </div>
    )
  }

  if (!me) return <LoginPage />

  return (
    <Routes key={me.id}>
      {/* Focused meeting mode intentionally has no global navigation. */}
      <Route path="standups/:sessionId/live" element={<WorkspacePage />} />

      <Route element={<Layout />}>
        <Route index element={<Navigate to="/tasks" replace />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="projects" element={<Navigate to="/tasks" replace />} />
        <Route path="standups" element={<Navigate to="/tasks" replace />} />
        <Route path="standups/:sessionId" element={<Navigate to="/tasks" replace />} />

        {/* Preserve old URLs without keeping old destinations. */}
        <Route path="work" element={<WorkRedirect />} />
        <Route path="board" element={<LegacyBoardRedirect />} />
        <Route path="legacy/board" element={<LegacyBoardRedirect />} />
        <Route path="settings/projects" element={<Navigate to="/tasks" replace />} />
        <Route path="standup/today" element={<Navigate to="/" replace />} />
        <Route path="dashboard" element={<Navigate to="/" replace />} />
        <Route path="ai" element={<RetiredPage name="Transcript review" />} />
        <Route path="intake" element={<RetiredPage name="Work intake" />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
