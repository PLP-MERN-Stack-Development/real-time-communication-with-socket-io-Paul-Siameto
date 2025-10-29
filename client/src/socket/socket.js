// socket.js - Socket.io client setup

import { io } from 'socket.io-client';
import { useEffect, useState } from 'react';

// Socket.io connection URL
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

// Create socket instance
export const socket = io(SOCKET_URL, {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
});

// Custom hook for using socket.io
export const useSocket = () => {
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [lastMessage, setLastMessage] = useState(null);
  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);
  const [rooms, setRooms] = useState(['global']);
  const [currentRoom, setCurrentRoom] = useState('global');

  // Connect to socket server
  const connect = (username, token) => {
    if (token) {
      socket.auth = { ...(socket.auth || {}), token };
    }
    socket.connect();
    // Backward compatibility for non-JWT flows
    if (username) {
      socket.emit('user_join', username);
    }
  };

  // Disconnect from socket server
  const disconnect = () => {
    socket.disconnect();
  };

  // Send a message
  const sendMessage = (message, opts = {}, ack) => {
    socket.emit('send_message', { message, room: currentRoom, attachments: opts.attachments || [] }, ack);
  };

  // Send a private message
  const sendPrivateMessage = (to, message, opts = {}) => {
    const payload = { to, message };
    if (opts.toUsername) payload.toUsername = opts.toUsername;
    if (Array.isArray(opts.attachments)) payload.attachments = opts.attachments;
    socket.emit('private_message', payload);
  };

  // Set typing status
  const setTyping = (isTyping) => {
    socket.emit('typing', isTyping);
  };

  // Join a room
  const joinRoom = (room) => {
    setCurrentRoom(room);
    socket.emit('join_room', room);
  };

  // Read receipts
  const readMessage = (messageId) => {
    socket.emit('read_message', { messageId });
  };

  // Reactions
  const reactMessage = (messageId, type) => {
    socket.emit('react_message', { messageId, type });
  };

  // Socket event listeners
  useEffect(() => {
    // Connection events
    const onConnect = () => {
      setIsConnected(true);
    };

    const onDisconnect = () => {
      setIsConnected(false);
    };

    // Message events
    const onReceiveMessage = (message) => {
      setLastMessage(message);
      setMessages((prev) => [...prev, message]);
    };

    const onPrivateMessage = (message) => {
      setLastMessage(message);
      setMessages((prev) => [...prev, message]);
    };

    // User events
    const onUserList = (userList) => {
      setUsers(userList);
    };

    const onUserJoined = (user) => {
      // You could add a system message here
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          system: true,
          message: `${user.username} joined the chat`,
          timestamp: new Date().toISOString(),
        },
      ]);
    };

    const onUserLeft = (user) => {
      // You could add a system message here
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          system: true,
          message: `${user.username} left the chat`,
          timestamp: new Date().toISOString(),
        },
      ]);
    };

    // Typing events
    const onTypingUsers = (users) => {
      setTypingUsers(users);
    };

    // Rooms list
    const onRoomsList = (r) => {
      setRooms(r);
    };

    // Read receipts (de-duplicate entries)
    const onMessageRead = ({ messageId, userId }) => {
      setMessages((prev) => prev.map(m => {
        if (m.id !== messageId) return m;
        const already = (m.readBy || []).some(id => String(id) === String(userId));
        return already ? m : { ...m, readBy: [ ...(m.readBy || []), userId ] };
      }));
    };

    // Reactions updates
    const onMessageReaction = ({ messageId, reactions }) => {
      setMessages((prev) => prev.map(m => (m.id === messageId ? { ...m, reactions } : m)));
    };

    // Register event listeners
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('receive_message', onReceiveMessage);
    socket.on('private_message', onPrivateMessage);
    socket.on('user_list', onUserList);
    socket.on('user_joined', onUserJoined);
    socket.on('user_left', onUserLeft);
    socket.on('typing_users', onTypingUsers);
    socket.on('rooms_list', onRoomsList);
    socket.on('message_read', onMessageRead);
    socket.on('message_reaction', onMessageReaction);

    // Clean up event listeners
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('receive_message', onReceiveMessage);
      socket.off('private_message', onPrivateMessage);
      socket.off('user_list', onUserList);
      socket.off('user_joined', onUserJoined);
      socket.off('user_left', onUserLeft);
      socket.off('typing_users', onTypingUsers);
      socket.off('rooms_list', onRoomsList);
      socket.off('message_read', onMessageRead);
      socket.off('message_reaction', onMessageReaction);
    };
  }, []);

  return {
    socket,
    isConnected,
    lastMessage,
    messages,
    users,
    typingUsers,
    rooms,
    currentRoom,
    connect,
    disconnect,
    sendMessage,
    sendPrivateMessage,
    setTyping,
    joinRoom,
    readMessage,
    reactMessage,
  };
};

export default socket; 