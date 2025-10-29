import React, { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000'

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [isRegister, setIsRegister] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleAuth = async (e) => {
    e.preventDefault()
    setError('')
    if (!username.trim() || !password) return
    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/${isRegister ? 'register' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password })
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Authentication failed')
      }
      const data = await res.json()
      sessionStorage.setItem('token', data.token)
      sessionStorage.setItem('username', data.username || username.trim())
      const redirectTo = location.state?.from?.pathname || '/chat'
      navigate(redirectTo, { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="card">
        <h2 className="card-title">Welcome</h2>
        <p className="muted">Sign in to continue to the chat</p>

        <form className="form" onSubmit={handleAuth}>
          <label className="label">Username</label>
          <input
            className="input"
            placeholder="Enter username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />

          <label className="label">Password</label>
          <input
            className="input"
            type="password"
            placeholder="Enter password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <div className="row space-between" style={{ marginTop: 8 }}>
            <label className="checkbox">
              <input type="checkbox" checked={isRegister} onChange={(e) => setIsRegister(e.target.checked)} />
              <span>Register new account</span>
            </label>
            <button className="btn" type="submit" disabled={!username.trim() || !password || loading}>
              {loading ? 'Please wait…' : isRegister ? 'Register & Continue' : 'Sign In'}
            </button>
          </div>
        </form>

        {error && <div className="error">{error}</div>}

        <div className="muted small" style={{ marginTop: 16 }}>
          Tip: Open two windows and sign in with different users to test real-time chat.
        </div>
      </div>
    </div>
  )
}
