import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ClientPage } from './pages/ClientPage'
import { DevPage } from './pages/DevPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/dev" element={<DevPage />} />
        <Route path="/client" element={<ClientPage />} />
        <Route path="*" element={<Navigate to="/client" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
