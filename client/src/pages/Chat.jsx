import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSocket } from '../socket/socket.js'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000'

export default function Chat() {
  const {
    isConnected,
    messages,
    users,
    typingUsers,
    connect,
    disconnect,
    sendMessage,
    sendPrivateMessage,
    setTyping,
    rooms,
    currentRoom,
    joinRoom,
    readMessage,
    reactMessage,
  } = useSocket()

  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [recipientId, setRecipientId] = useState('')
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [attachments, setAttachments] = useState([])
  const fileInputRef = useRef(null)
  const [unread, setUnread] = useState(0)
  const [roomUnread, setRoomUnread] = useState({})
  const [events, setEvents] = useState([])
  const [olderMessages, setOlderMessages] = useState([])
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [deliveredIds, setDeliveredIds] = useState(new Set())
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [showSidebar, setShowSidebar] = useState(true)
  const username = sessionStorage.getItem('username') || 'User'
  const token = sessionStorage.getItem('token') || ''
  const readSentRef = useRef(new Set())
  const eventCooldownRef = useRef(new Map())

  const selectedUser = useMemo(() => users.find(u => u.id === recipientId) || null, [users, recipientId])

  const displayedMessages = useMemo(() => {
    const all = [...olderMessages, ...messages]
    if (recipientId && selectedUser) {
      return all.filter(m => {
        if (m.system || !m.isPrivate) return false
        const senderName = m.sender
        const toName = m.toUsername
        // DM thread between me and selectedUser by username (works for persisted + live)
        const a = senderName === username && toName === selectedUser.username
        const b = senderName === selectedUser.username && toName === username
        return a || b
      })
    }
    return all.filter(m => !m.system && !m.isPrivate && ((m.room || 'global') === currentRoom))
  }, [olderMessages, messages, recipientId, currentRoom, selectedUser, username])

  // Play a short ping using Web Audio API
  const playPing = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = 880
      o.connect(g)
      g.connect(ctx.destination)
      g.gain.setValueAtTime(0.0001, ctx.currentTime)
      g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15)
      o.start()
      o.stop(ctx.currentTime + 0.16)
    } catch {}
  }

  useEffect(() => {
    if (!token) {
      navigate('/', { replace: true })
      return
    }
    connect(username, token)
    return () => {
      disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Request browser notification permission
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (!historyLoaded && isConnected) {
      if (!recipientId) {
        fetch(`${API_URL}/api/messages?room=${encodeURIComponent(currentRoom)}`)
          .then(r => r.json())
          .then(() => setHistoryLoaded(true))
          .catch(() => {})
      }
    }
  }, [isConnected, historyLoaded, currentRoom, recipientId])

  useEffect(() => {
    let timeout
    if (isConnected && text) {
      setTyping(true)
      timeout = setTimeout(() => setTyping(false), 1200)
    } else if (isConnected) {
      setTyping(false)
    }
    return () => clearTimeout(timeout)
  }, [text, isConnected, setTyping])

  // Notifications: increment unread, play sound, show browser notification
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (!last) return
    const isSelf = last.sender === username
    const isRelevantRoom = !last.room || last.room === currentRoom
    const hidden = document.hidden
    // Message notifications
    if (!last.system && !isSelf && (hidden || (!recipientId && !isRelevantRoom))) {
      setUnread((u) => u + 1)
      if (!recipientId && !isRelevantRoom) {
        const r = last.room || 'global'
        setRoomUnread((map) => ({ ...map, [r]: (map[r] || 0) + 1 }))
      }
      playPing()
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification(`${last.sender}`, { body: last.message || 'New message', tag: 'chat', silent: true })
        } catch {}
      }
    }
    // Join/Leave notifications as system messages (coalesce duplicates)
    if (last.system && typeof last.message === 'string') {
      const lower = last.message.toLowerCase()
      const isPresence = lower.includes('joined the chat') || lower.includes('left the chat')
      if (isPresence) {
        const key = last.message
        const now = Date.now()
        const prev = eventCooldownRef.current.get(key) || 0
        if (now - prev < 3000) {
          return // suppress duplicates within 3s
        }
        eventCooldownRef.current.set(key, now)

        if (hidden) {
          playPing()
          if ('Notification' in window && Notification.permission === 'granted') {
            try { new Notification('Presence update', { body: last.message, tag: 'presence', silent: true }) } catch {}
          }
        }
        // Add to events center (prepend, keep max 20)
        setEvents((ev) => [{ id: now, type: lower.includes('joined') ? 'join' : 'leave', text: last.message, time: new Date().toLocaleTimeString() }, ...ev].slice(0, 20))
      }
    }
  }, [messages, currentRoom, username])

  // Title badge for unread count
  useEffect(() => {
    const base = 'Socket.io Chat'
    document.title = unread > 0 ? `(${unread}) ${base}` : base
  }, [unread])

  // Reset unread count when focusing the window or switching room
  useEffect(() => {
    const onFocus = () => setUnread(0)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const canSend = useMemo(() => text.trim().length > 0, [text])

  const handleSend = (e) => {
    e.preventDefault()
    if (!canSend) return
    if (recipientId) {
      sendPrivateMessage(recipientId, text.trim(), { toUsername: selectedUser?.username, attachments })
    } else {
      sendMessage(text.trim(), { attachments }, (ack) => {
        if (ack?.ok && ack.id) {
          setDeliveredIds((prev) => new Set(prev).add(ack.id))
        }
      })
    }
    setText('')
    setAttachments([])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleLogout = () => {
    sessionStorage.removeItem('token')
    sessionStorage.removeItem('username')
    disconnect()
    navigate('/', { replace: true })
  }

  const handleAddRoom = () => {
    const name = prompt('Enter room name')
    if (name && name.trim()) {
      joinRoom(name.trim())
      setHistoryLoaded(false)
      setUnread(0)
      setRoomUnread((map) => ({ ...map, [name.trim()]: 0 }))
    }
  }

  const handleSwitchRoom = (e) => {
    const name = e.target.value
    joinRoom(name)
    setRecipientId('')
    setHistoryLoaded(false)
    setUnread(0)
    setRoomUnread((map) => ({ ...map, [name]: 0 }))
    setOlderMessages([])
  }

  useEffect(() => {
    // Reset history and older cache when entering/exiting DM
    setOlderMessages([])
    setHistoryLoaded(false)
  }, [recipientId])

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const form = new FormData()
    form.append('file', file)
    setUploading(true)
    try {
      const res = await fetch(`${API_URL}/api/upload`, { method: 'POST', body: form })
      if (!res.ok) throw new Error('Upload failed')
      const data = await res.json()
      setAttachments((prev) => [...prev, { url: data.url, type: data.type, name: data.name, size: data.size }])
    } catch (err) {
      // no-op minimal error display could be added
    } finally {
      setUploading(false)
    }
  }

  // Mark messages as read once per message for the current visible thread
  useEffect(() => {
    displayedMessages.forEach(m => {
      if (!m.system && m.sender !== username && m.id && !readSentRef.current.has(m.id)) {
        readSentRef.current.add(m.id)
        readMessage(m.id)
      }
    })
  }, [displayedMessages, readMessage, username])

  const handleLoadOlder = async () => {
    if (loadingOlder) return
    setLoadingOlder(true)
    try {
      const first = (olderMessages[0] || displayedMessages[0])
      const before = first ? first.timestamp : undefined
      let url
      if (recipientId && selectedUser) {
        url = new URL(`${API_URL}/api/pm`)
        url.searchParams.set('me', username)
        url.searchParams.set('peer', selectedUser.username)
      } else {
        url = new URL(`${API_URL}/api/messages`)
        url.searchParams.set('room', currentRoom)
      }
      if (before) url.searchParams.set('before', before)
      url.searchParams.set('limit', '30')
      const res = await fetch(url.toString())
      const data = await res.json()
      // de-duplicate by id
      const seen = new Set([...(olderMessages.map(m=>m.id)), ...(displayedMessages.map(m=>m.id))])
      const unique = data.filter(m => !seen.has(m.id))
      setOlderMessages(prev => [...unique, ...prev])
    } catch {}
    setLoadingOlder(false)
  }

  const handleSearch = async (e) => {
    e.preventDefault()
    try {
      const url = new URL(`${API_URL}/api/search`)
      url.searchParams.set('room', currentRoom)
      url.searchParams.set('q', q)
      const res = await fetch(url.toString())
      const data = await res.json()
      setResults(data)
    } catch {
      setResults([])
    }
  }

  return (
    <div className={`chat-grid ${showSidebar ? '' : 'hide-sidebar'}`}>
      <aside className="panel">
        <div className="panel-header">
          <div className="title">Channels</div>
        </div>
        <div className="panel-body">
          <div className="row" style={{ marginBottom: 8 }}>
            <select value={currentRoom} onChange={handleSwitchRoom} className="select">
              {rooms.map(r => (
                <option key={r} value={r}>#{r}{roomUnread[r] ? ` (${roomUnread[r]})` : ''}</option>
              ))}
            </select>
            <button className="btn subtle" onClick={handleAddRoom}>+ Room</button>
          </div>
          <select value={recipientId} onChange={(e) => setRecipientId(e.target.value)} className="select">
            <option value="">Global Room</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>{u.username} {u.id === recipientId ? '(PM)' : ''}</option>
            ))}
          </select>
          <ul className="user-list">
            {users.map(u => (
              <li key={u.id} className="user-item">
                <span className="dot online" />
                <span>{u.username}</span>
              </li>
            ))}
          </ul>
          <div className="muted small" style={{ marginTop: 8 }}>
            {typingUsers.length > 0 && (
              <div>{typingUsers.join(', ')} typing...</div>
            )}
          </div>
          <div className="muted small" style={{ marginTop: 12, borderTop:'1px solid var(--border)', paddingTop:8 }}>
            <div style={{ fontWeight:600, marginBottom:6 }}>Notifications</div>
            <ul style={{ listStyle:'none', margin:0, padding:0, maxHeight:120, overflow:'auto' }}>
              {events.length === 0 && <li className="muted small">No recent events</li>}
              {events.map(e => (
                <li key={e.id} style={{ padding:'4px 0', borderBottom:'1px solid var(--border)' }}>
                  <span className="pill" style={{ marginRight:6 }}>{e.type}</span>
                  <span>{e.text}</span>
                  <span className="time" style={{ marginLeft:6 }}>{e.time}</span>
                </li>
              ))}
            </ul>
            {events.length > 0 && (
              <div className="row" style={{ marginTop:6, justifyContent:'flex-end' }}>
                <button className="btn subtle" onClick={() => setEvents([])}>Clear</button>
              </div>
            )}
          </div>
        </div>
        <div className="panel-footer">
          <button className="btn subtle" onClick={handleLogout}>Logout</button>
          <span className={`status ${isConnected ? 'ok' : 'bad'}`}>{isConnected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </aside>

      <main className="panel">
        <div className="panel-header">
          <div className="title">{recipientId ? `@${selectedUser?.username || 'private'}` : `#${currentRoom}`}</div>
          <div className="row" style={{ gap:8, alignItems:'center' }}>
            {!recipientId && (
              <form onSubmit={handleSearch} className="row" style={{ gap:6 }}>
                <input className="input" placeholder="Search messages" value={q} onChange={(e)=>setQ(e.target.value)} style={{ width:180 }} />
                <button className="btn subtle" type="submit">Search</button>
              </form>
            )}
            <button className="btn subtle" onClick={()=>setShowSidebar(s=>!s)} title="Toggle sidebar">☰</button>
            <div className="muted small">Signed in as {username}</div>
          </div>
        </div>
        {!isConnected && (
          <div className="banner warn">Reconnecting… messages may be delayed</div>
        )}
        <div className="messages" id="messages">
          <div className="row" style={{ justifyContent:'center', marginBottom:8 }}>
            <button className="btn subtle" onClick={handleLoadOlder} disabled={loadingOlder}>{loadingOlder ? 'Loading…' : 'Load older'}</button>
          </div>
          {displayedMessages.map((msg, idx) => (
            <div key={(msg.id || msg.timestamp || idx) + '-' + idx} className={`msg ${msg.isPrivate ? 'pm' : ''}`}>
              {msg.system ? (
                <div className="sys">{msg.message}</div>
              ) : (
                <>
                  <div className="meta">
                    <strong>{msg.sender || 'Anonymous'}</strong>
                    <span className="time">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                    {msg.isPrivate && <span className="pill">private</span>}
                    {Array.isArray(msg.readBy) && msg.readBy.length > 0 && (
                      <span className="pill" style={{ background:'#0a3', opacity:.8 }}>read {msg.readBy.length}</span>
                    )}
                    {deliveredIds.has(msg.id) && <span className="pill" style={{ background:'#2563eb' }}>delivered</span>}
                  </div>
                  <div className="body">{msg.message}</div>
                  {Array.isArray(msg.attachments) && msg.attachments.length > 0 && (
                    <div className="body" style={{ marginTop: 6 }}>
                      {msg.attachments.map((a, i) => (
                        <div key={i} style={{ marginTop: 4 }}>
                          {a.type?.startsWith('image/') ? (
                            <img src={a.url} alt={a.name} style={{ maxWidth: '100%', borderRadius: 8, border:'1px solid var(--border)' }} />
                          ) : (
                            <a href={a.url} target="_blank" rel="noreferrer" className="muted">{a.name || 'attachment'}</a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="row" style={{ gap: 6, marginTop: 6 }}>
                    <button type="button" className="btn subtle" onClick={() => reactMessage(msg.id, 'like')}>👍</button>
                    <button type="button" className="btn subtle" onClick={() => reactMessage(msg.id, 'love')}>❤️</button>
                    <button type="button" className="btn subtle" onClick={() => reactMessage(msg.id, 'lol')}>😂</button>
                    {Array.isArray(msg.reactions) && msg.reactions.length > 0 && (
                      <span className="muted small">{msg.reactions.reduce((acc, r) => { acc[r.type] = (acc[r.type]||0)+1; return acc }, {})['like'] || 0}👍 {msg.reactions.reduce((acc, r) => { acc[r.type] = (acc[r.type]||0)+1; return acc }, {})['love'] || 0}❤️ {msg.reactions.reduce((acc, r) => { acc[r.type] = (acc[r.type]||0)+1; return acc }, {})['lol'] || 0}😂</span>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
        {results.length > 0 && (
          <div className="panel-footer" style={{ borderTop:'1px solid var(--border)' }}>
            <div className="muted small" style={{ marginBottom:6 }}>Search results</div>
            <div style={{ maxHeight:160, overflow:'auto', width:'100%' }}>
              {results.map((r) => (
                <div key={r.id} className="muted small" style={{ padding:'4px 0', borderBottom:'1px solid var(--border)' }}>
                  <strong>{r.sender}:</strong> {r.message}
                  <span className="time" style={{ marginLeft:6 }}>{new Date(r.timestamp).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <form className="composer" onSubmit={handleSend}>
          <input
            className="input"
            placeholder={recipientId ? 'Send a private message' : 'Type a message'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={!isConnected}
          />
          <input ref={fileInputRef} type="file" onChange={handleFileSelect} disabled={!isConnected || uploading} />
          <button className="btn" type="submit" disabled={!isConnected || !canSend}>Send</button>
        </form>
      </main>
    </div>
  )
}
