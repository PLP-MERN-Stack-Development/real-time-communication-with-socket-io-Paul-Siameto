// server.js - Main server file for Socket.io chat application

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const Message = require('./models/Message');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Private messages pagination between two users (by usernames)
app.get('/api/pm', async (req, res) => {
  try {
    const me = (req.query.me || '').trim();
    const peer = (req.query.peer || '').trim();
    const before = req.query.before ? new Date(req.query.before) : null;
    const limit = Math.min(parseInt(req.query.limit || '30', 10), 100);
    if (!me || !peer) return res.json([]);

    if (!MONGODB_URI) {
      // Fallback: filter in-memory list
      const base = messages.filter(m => m.isPrivate && (
        (m.sender === me && m.toUsername === peer) ||
        (m.sender === peer && m.toUsername === me)
      ));
      const filtered = before ? base.filter(m => new Date(m.timestamp) < before) : base;
      const slice = filtered.slice(-limit);
      return res.json(slice);
    }

    const q = {
      isPrivate: true,
      $or: [
        { sender: me, toUsername: peer },
        { sender: peer, toUsername: me },
      ],
    };
    if (before && !isNaN(before.getTime())) q.timestamp = { $lt: before };

    const docs = await Message.find(q)
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    const ordered = docs.reverse().map(d => ({
      id: d._id.toString(),
      message: d.message,
      sender: d.sender,
      senderId: d.senderSocketId,
      toUsername: d.toUsername || null,
      toSocketId: d.toSocketId || null,
      isPrivate: true,
      timestamp: new Date(d.timestamp).toISOString(),
      attachments: Array.isArray(d.attachments) ? d.attachments.map(u => ({ url: u })) : [],
      readBy: (d.readBy || []).map(String),
      reactions: d.reactions || [],
    }));

    res.json(ordered);
  } catch (err) {
    console.error('PM fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch private messages' });
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// JWT secret
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || '';
if (!MONGODB_URI) {
  console.warn('Warning: MONGODB_URI is not set. MongoDB features will not work.');
}
mongoose
  .connect(MONGODB_URI, { dbName: process.env.DB_NAME || 'socketdb' })
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection error:', err.message));

// Store connected users and messages
const users = {};
const messages = [];
const typingUsers = {};
const rooms = new Set(['global']);

// Multer setup for uploads
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, `${uuidv4()}${ext}`);
  },
});
const upload = multer({ storage });

// Auth: register new user
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    const existing = await User.findOne({ username: username.trim() });
    if (existing) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ username: username.trim(), passwordHash });
    const token = jwt.sign({ userId: user._id.toString(), username: user.username }, JWT_SECRET, { expiresIn: '12h' });
    res.json({ token, username: user.username });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Auth: login user with password
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    const user = await User.findOne({ username: username.trim() });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ userId: user._id.toString(), username: user.username }, JWT_SECRET, { expiresIn: '12h' });
    res.json({ token, username: user.username });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Socket.io auth middleware using JWT
io.use((socket, next) => {
  try {
    const token = socket.handshake?.auth?.token;
    if (!token) {
      return next(new Error('unauthorized'));
    }
    const payload = jwt.verify(token, JWT_SECRET);
    socket.user = { username: payload.username, userId: payload.userId };
    next();
  } catch (err) {
    next(err);
  }
});

// Socket.io connection handler
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Register user from JWT on connect
  if (socket.user?.username) {
    const { username, userId } = socket.user;
    users[socket.id] = { username, id: socket.id, userId };
    io.emit('user_list', Object.values(users));
    io.emit('user_joined', { username, id: socket.id });
    console.log(`${username} joined the chat`);
  }

  // Join default room
  socket.join('global');
  socket.currentRoom = 'global';
  io.to(socket.currentRoom).emit('rooms_list', Array.from(rooms));

  // Backward compatibility: allow legacy join event
  socket.on('user_join', (username) => {
    users[socket.id] = { username, id: socket.id };
    io.emit('user_list', Object.values(users));
    io.emit('user_joined', { username, id: socket.id });
    console.log(`${username} joined the chat`);
  });

  // Read receipts
  socket.on('read_message', async ({ messageId }) => {
    try {
      const u = users[socket.id];
      if (!u || !MONGODB_URI) return;
      if (!mongoose.Types.ObjectId.isValid(messageId)) return;
      const result = await Message.updateOne(
        { _id: messageId },
        { $addToSet: { readBy: u.userId } }
      );
      if (result && (result.modifiedCount > 0 || result.nModified > 0)) {
        io.emit('message_read', { messageId, userId: u.userId });
      }
    } catch (err) {
      console.error('Read receipt error:', err.message);
    }
  });

  // Reactions
  socket.on('react_message', async ({ messageId, type }) => {
    try {
      const u = users[socket.id];
      if (!u || !MONGODB_URI) return;
      // Toggle reaction for user
      const msg = await Message.findById(messageId);
      if (!msg) return;
      const existing = msg.reactions.find(r => r.userId?.toString() === (u.userId || '').toString() && r.type === type);
      if (existing) {
        msg.reactions = msg.reactions.filter(r => !(r.userId?.toString() === (u.userId || '').toString() && r.type === type));
      } else {
        msg.reactions.push({ type, userId: u.userId });
      }
      await msg.save();
      io.emit('message_reaction', { messageId, reactions: msg.reactions });
    } catch (err) {
      console.error('Reaction error:', err.message);
    }
  });

  // Handle room join
  socket.on('join_room', (room) => {
    const name = (room || 'global').trim() || 'global';
    rooms.add(name);
    if (socket.currentRoom) socket.leave(socket.currentRoom);
    socket.join(name);
    socket.currentRoom = name;
    io.to(name).emit('rooms_list', Array.from(rooms));
  });

  // Handle chat messages (supports rooms and attachments) with delivery ack
  socket.on('send_message', async (messageData, ack) => {
    const room = messageData?.room || socket.currentRoom || 'global';
    const u = users[socket.id];
    let idVal = Date.now().toString();
    let ts = new Date();

    // Persist first if DB available to get Mongo _id for read receipts
    if (u && MONGODB_URI) {
      try {
        const doc = await Message.create({
          message: messageData.message,
          senderUserId: u.userId || null,
          sender: u.username,
          senderSocketId: socket.id,
          isPrivate: false,
          timestamp: ts,
          room,
          // Persist attachments as array of URL strings for schema compatibility
          attachments: Array.isArray(messageData.attachments) ? (messageData.attachments.map(a => (a && a.url) || '').filter(Boolean)) : [],
        });
        idVal = doc._id.toString();
      } catch (err) {
        console.error('Save message error:', err.message);
      }
    }

    const message = {
      ...messageData,
      id: idVal,
      sender: u?.username || 'Anonymous',
      senderId: socket.id,
      timestamp: ts.toISOString(),
      room,
    };

    messages.push(message);
    if (messages.length > 100) messages.shift();

    io.to(room).emit('receive_message', message);
    if (typeof ack === 'function') {
      try { ack({ ok: true, id: idVal, timestamp: message.timestamp }); } catch {}
    }
  });

  // Handle typing indicator (per room)
  socket.on('typing', (isTyping) => {
    if (users[socket.id]) {
      const username = users[socket.id].username;
      
      if (isTyping) {
        typingUsers[socket.id] = username;
      } else {
        delete typingUsers[socket.id];
      }
      
      const room = socket.currentRoom || 'global';
      io.to(room).emit('typing_users', Object.values(typingUsers));
    }
  });

  // Handle private messages
  socket.on('private_message', async ({ to, message, toUsername, attachments }) => {
    const u = users[socket.id];
    const recipient = users[to];
    let idVal = Date.now().toString();
    const ts = new Date();

    if (u && MONGODB_URI) {
      try {
        const doc = await Message.create({
          message,
          senderUserId: u.userId || null,
          sender: u.username,
          senderSocketId: socket.id,
          isPrivate: true,
          toUserId: recipient?.userId || null,
          toUsername: (recipient?.username || toUsername || null),
          toSocketId: recipient ? to : null,
          timestamp: ts,
          attachments: Array.isArray(attachments) ? (attachments.map(a => (a && a.url) || '').filter(Boolean)) : [],
        });
        idVal = doc._id.toString();
      } catch (err) {
        console.error('Save private message error:', err.message);
      }
    }

    const messageData = {
      id: idVal,
      sender: u?.username || 'Anonymous',
      senderId: socket.id,
      message,
      timestamp: ts.toISOString(),
      isPrivate: true,
      toSocketId: recipient ? to : null,
      toUsername: recipient?.username || toUsername || null,
    };

    if (recipient) {
      io.to(to).emit('private_message', messageData);
    }
    io.to(socket.id).emit('private_message', messageData);
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    if (users[socket.id]) {
      const { username } = users[socket.id];
      io.emit('user_left', { username, id: socket.id });
      console.log(`${username} left the chat`);
    }
    
    delete users[socket.id];
    delete typingUsers[socket.id];
    
    io.emit('user_list', Object.values(users));
    io.emit('typing_users', Object.values(typingUsers));
  });
});

// API routes
app.get('/api/messages', async (req, res) => {
  try {
    const room = (req.query.room || 'global').trim() || 'global';
    const before = req.query.before ? new Date(req.query.before) : null;
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 100);
    if (!MONGODB_URI) {
      const base = messages.filter(m => (m.room || 'global') === room);
      const filtered = before ? base.filter(m => new Date(m.timestamp) < before) : base;
      const slice = filtered.slice(-limit);
      return res.json(slice);
    }
    const query = { isPrivate: false, room };
    if (before && !isNaN(before.getTime())) query.timestamp = { $lt: before };
    const docs = await Message.find(query)
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();
    const ordered = docs.reverse().map((d) => ({
      id: d._id.toString(),
      message: d.message,
      sender: d.sender,
      senderId: d.senderSocketId,
      timestamp: new Date(d.timestamp).toISOString(),
      room: d.room || 'global',
      attachments: Array.isArray(d.attachments) ? d.attachments.map(u => ({ url: u })) : [],
      readBy: (d.readBy || []).map(String),
      reactions: d.reactions || [],
    }));
    res.json(ordered);
  } catch (err) {
    console.error('Fetch messages error:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Search messages
app.get('/api/search', async (req, res) => {
  try {
    const room = (req.query.room || 'global').trim() || 'global';
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);
    if (!MONGODB_URI) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const base = messages.filter(m => (m.room || 'global') === room && ((m.message && rx.test(m.message)) || (m.sender && rx.test(m.sender))));
      return res.json(base.slice(-50));
    }
    const docs = await Message.find({
      isPrivate: false,
      room,
      $or: [
        { message: { $regex: q, $options: 'i' } },
        { sender: { $regex: q, $options: 'i' } },
      ],
    })
      .sort({ timestamp: -1 })
      .limit(50)
      .lean();
    const mapped = docs.map(d => ({
      id: d._id.toString(),
      message: d.message,
      sender: d.sender,
      timestamp: new Date(d.timestamp).toISOString(),
      room: d.room || 'global',
    }));
    res.json(mapped);
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Failed to search messages' });
  }
});

// Upload endpoint
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const file = req.file;
  const base = process.env.SERVER_PUBLIC_URL || `http://localhost:${process.env.PORT || 5000}`;
  const url = `${base}/uploads/${file.filename}`;
  res.json({
    url,
    name: file.originalname,
    size: file.size,
    type: file.mimetype,
  });
});

app.get('/api/users', (req, res) => {
  res.json(Object.values(users));
});

// Root route
app.get('/', (req, res) => {
  res.send('Socket.io Chat Server is running');
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = { app, server, io }; 