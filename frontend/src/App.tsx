import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { ClientPage } from './pages/ClientPage'
import { DevPage } from './pages/DevPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/dev" element={<DevPage />} />
          <Route path="/client" element={<ClientPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/client" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
