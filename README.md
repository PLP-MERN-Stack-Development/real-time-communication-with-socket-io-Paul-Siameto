# Real-Time Chat Application (Socket.io + React + MongoDB)

A full-stack real-time chat app featuring authentication, public rooms, private DMs, typing indicators, read receipts, reactions, file uploads, notifications, pagination, delivery acks, and search.

## Features
- Authentication with JWT (login/register)
- Real-time messaging via Socket.io
- Public channels (rooms) and private direct messages (DMs)
- Typing indicators (per-room)
- Read receipts (Mongo-backed, per message)
- Message reactions
- File/image uploads (serving from /uploads)
- Sound and browser notifications
- Sidebar Notifications center (join/leave events only, coalesced)
- Per-room unread counts and page title badge
- Message delivery acknowledgment (server acks, client pill)
- Message pagination (public rooms and DMs)
- Message search (public rooms)
- Mobile-friendly sidebar toggle

## Tech Stack
- Client: React 18, Vite, react-router-dom, socket.io-client
- Server: Node.js, Express, Socket.io, Multer (uploads), Mongoose (MongoDB)
- DB: MongoDB (Atlas or local)

## Project Structure
```
real-time-communication-with-socket-io-Paul-Siameto/
├── client/               # React front-end
│   ├── public/
│   └── src/
│       ├── pages/        # Login, Chat
│       ├── socket/       # Socket hooks and client wiring
│       └── styles.css
└── server/               # Node/Express/Socket.io backend
    ├── server.js
    ├── models/           # (Message/User schemas – inline or separate)
    ├── uploads/          # Uploaded files
    └── .env              # Environment config
```

## Architecture Overview
- Client (Vite + React): pages/Login, pages/Chat, socket/socket.js for Socket.io client, simple styles.
- Server (Express + Socket.io): REST APIs for auth, messages, search, uploads; Socket.io for realtime events; MongoDB for persistence.
- Auth: JWT on REST; token passed on socket connection. Client stores token in sessionStorage to allow different users per tab.

## Data Model (Mongo)
- User: { username, passwordHash, createdAt }
- Message (public): { _id, message, sender, senderSocketId, senderUserId, room, isPrivate:false, timestamp, attachments:[url], readBy:[userId], reactions:[{ userId, type }] }
- Message (DM): { _id, message, sender, senderSocketId, senderUserId, toUsername, toSocketId, toUserId, isPrivate:true, timestamp, attachments:[url], readBy:[userId], reactions:[] }

Attachments are stored as URL strings; API maps them to objects `{ url }` for the client.

## Environment Variables (server/.env)
- PORT: server port (default 5000)
- CLIENT_URL: allowed origin for CORS (default http://localhost:5173)
- JWT_SECRET: secret for signing JWTs
- MONGODB_URI: MongoDB connection string (e.g., mongodb://localhost:27017/socketdb)
- SERVER_PUBLIC_URL: optional, base URL for generating absolute upload URLs

## Setup & Run (step-by-step)
1) Install
   - Server: `cd server && npm install`
   - Client: `cd ../client && npm install`
2) Configure `server/.env` (see above)
3) Start
   - Server: `cd server && npm run dev`
   - Client: `cd ../client && npm run dev`
4) Open http://localhost:5173

## REST API — Detailed
- Auth
  - POST /api/register
    - Body: `{ "username": "alice", "password": "secret" }`
    - 200: `{ token, username }`
  - POST /api/login
    - Body: `{ "username": "alice", "password": "secret" }`
    - 200: `{ token, username }`

- Messages (Public)
  - GET /api/messages?room=general&before=2025-01-01T12:00:00.000Z&limit=30
    - Returns most recent messages before `before` (ISO), ascending order, each:
      `{ id, message, sender, senderId, timestamp, room, attachments:[{url}], readBy:[userId], reactions:[] }`

- Messages (Private/DM)
  - GET /api/pm?me=alice&peer=bob&before=ISO&limit=30
    - Returns recent DMs between `me` and `peer`, ascending order, each:
      `{ id, message, sender, senderId, toUsername, isPrivate:true, timestamp, attachments:[{url}], readBy:[userId] }`

- Search (Public)
  - GET /api/search?room=general&q=hello
    - Returns up to 50 recent matches in the room by message text or sender.

- Upload
  - POST /api/upload (multipart/form-data, field `file`)
    - 200: `{ url, name, size, type }`

## Socket Events — Detailed
- Client → Server
  - `user_join` (username)
  - `join_room` (room)
  - `send_message` ({ message, room, attachments }, ack)
    - ack: `{ ok, id, timestamp }`
  - `private_message` ({ to, message, toUsername, attachments })
  - `typing` (boolean)
  - `read_message` ({ messageId })
  - `react_message` ({ messageId, type })

- Server → Client
  - `receive_message` (message)
  - `private_message` (message)
  - `message_read` ({ messageId, userId })
  - `message_reaction` ({ messageId, reactions })
  - `rooms_list` (rooms[])
  - `user_list` (users[])
  - `typing_users` (usernames[])
  - `user_joined` / `user_left` (system presence)

## Workflows
- Rooms (Public)
  - Join/Switch room with selector. Messages displayed are only non-system messages for the current room.
  - Load older pulls from `/api/messages` with `before` cursor.

- DMs (Private)
  - Choose a user in the dropdown to enter a DM thread. Only messages between you and that user are shown.
  - Load older pulls from `/api/pm?me=<you>&peer=<them>`.
  - DMs are persisted even if the recipient is offline.

- Uploads
  - Select a file before sending. Attachment uploaded to `/api/upload`; resulting URL included with the message.

- Read Receipts
  - Client sends `read_message` once per visible message in the current thread; server updates Mongo with `$addToSet` to prevent duplicates; broadcasts `message_read` only when actually modified.

- Notifications
  - Sound + browser notifications for new messages when hidden or in another room. Presence (join/leave) events shown only in the sidebar Notifications panel and coalesced to avoid spam.

- Delivery Acknowledgments
  - Server acknowledges `send_message`; client marks messages with a “delivered” pill when acked.

## Pagination Semantics
- Public: `/api/messages` returns ascending order; use `before` as the timestamp of the first currently shown item to fetch older batches.
- DMs: `/api/pm` same semantics with usernames.
- Client de-duplicates by `id` when prepending.

## Running in Multiple Tabs
- This app uses sessionStorage for auth so every tab can log in as a different user (useful for testing).

## Troubleshooting & FAQ
- 401 on socket connect
  - Ensure you logged in (sessionStorage has `token`) before visiting `/chat`.
  - Check `CLIENT_URL` matches `http://localhost:5173` in `.env`.
- DM history doesn’t load
  - Ensure existing DM documents have `sender` and `toUsername`. The loader filters by usernames.
  - Click “Load older” in the DM view to fetch older batches.
- Presence spam
  - Presence notifications are coalesced within 3 seconds and shown only in the sidebar, not in the timeline.
- Attachments casting error
  - Server stores attachments as URL strings. Client sends objects but server maps to URLs on save.
- Duplicate React keys
  - Handled with composite keys; hard refresh if warnings persist.

## Development Tips
- Use two browsers/tabs and two accounts to verify realtime and receipts.
- Allow browser notifications to test background alerts.
- Optional: add `client/public/favicon.ico` to remove 404 warnings.

## Roadmap (optional)
- Infinite scroll for pagination
- Namespaces for stricter isolation (e.g., `/chat`)
- Delivery “sent/failed” states with retry
- Server-side search for DMs