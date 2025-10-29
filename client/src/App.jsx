import React from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Login from './pages/Login.jsx'
import Chat from './pages/Chat.jsx'
import './styles.css'

function RequireAuth({ children }) {
  const token = sessionStorage.getItem('token')
  const location = useLocation()
  if (!token) {
    return <Navigate to="/" state={{ from: location }} replace />
  }
  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-shell">
        <header className="app-header">
          <div className="brand">Socket.io Chat</div>
        </header>
        <main className="app-main">
          <Routes>
            <Route path="/" element={<Login />} />
            <Route
              path="/chat"
              element={
                <RequireAuth>
                  <Chat />
                </RequireAuth>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
