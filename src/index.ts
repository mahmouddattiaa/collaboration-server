// Load environment variables from .env file
import dotenv from 'dotenv';
dotenv.config();

// Set environment variables explicitly if not provided
process.env.JWT_SECRET = process.env.JWT_SECRET || 'your_secure_jwt_secret_key';
process.env.PORT = process.env.PORT || '4001';
process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/moneyyy';
process.env.BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:5001/api';

import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import multer from 'multer';
import mongoose from 'mongoose';
import connectDB from './config/db';
import auth from './middleware/auth';
import CollaborationRoom from './models/CollaborationRoom';
import { uploadFile, getFile } from './utils/fileStorage';
import { upload as fileUpload, handleFileUpload, handleFileDownload } from './utils/fileHandlers';
import { Request } from 'express';
import { handleWhiteboardDraw, handleWhiteboardClear, handleWhiteboardSync } from './utils/whiteboardHandlers';

// Extend Express Request type
interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    [key: string]: any;
  };
}

// Types
interface Participant {
  id: string;
  name: string;
  avatar?: string;
  status: 'online' | 'away' | 'offline';
  isTyping?: boolean;
}

interface Message {
  id: string;
  userId: string;
  content: string;
  timestamp: Date;
  type: 'text' | 'file' | 'system';
}

interface Task {
  id: string;
  title: string;
  description?: string;
  assigneeId?: string;
  status: 'todo' | 'in-progress' | 'completed';
  priority: 'low' | 'medium' | 'high';
  dueDate?: Date;
  createdAt: Date;
}

interface RoomFile {
  id: string;
  name: string;
  size: number;
  type: string;
  uploadedBy: string;
  uploadedAt: Date;
  url: string;
}

interface Room {
  _id: string;
  id: string;
  name: string;
  participants: Participant[];
  messages: Message[];
  tasks: Task[];
  files: RoomFile[];
  isRecording: boolean;
  sessionTimer: number;
  createdAt: Date;
  whiteboard: {
    elements: any[];
  };
  whiteboardSaveTimeout?: NodeJS.Timeout;
}

// Configuration
const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:5001/api';

// In-memory data store
const rooms: Map<string, Room> = new Map();
const userRooms: Map<string, string> = new Map(); // userId -> roomId

// Create Express app
const app = express();
const router = express.Router();
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(express.json());

// Register routes explicitly
app.use('/', router);

// Create HTTP server
const server = http.createServer(app);

// Create Socket.IO server
const io = new Server(server, {
  cors: {
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
  }
});

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB file size limit
  }
});

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Serve static files from uploads directory
app.use('/uploads', express.static(uploadsDir));

// Connect to MongoDB
connectDB();

// Helper function to save room to backend
const saveRoomToBackend = async (room: Room, authToken?: string) => {
  try {
    if (!authToken) {
      console.warn(`No auth token provided for room ${room.id}, cannot persist to backend`);
      return;
    }

    // Find if the room exists in the backend by roomId
    const existingRoom = await axios.get(`${BACKEND_API_URL}/collaboration/room/${room.id}`, {
      headers: {
        Authorization: `Bearer ${authToken}`
      }
    }).catch(() => null);

    if (existingRoom?.data) {
      // Update existing room
      await axios.put(`${BACKEND_API_URL}/collaboration/room/${room.id}`, {
        participants: room.participants,
        messages: room.messages,
        tasks: room.tasks,
        isRecording: room.isRecording,
        sessionTimer: room.sessionTimer,
        whiteboard: room.whiteboard
      }, {
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });
      console.log(`Room ${room.id} updated in backend`);
    } else {
      // Create new room
      const response = await axios.post(`${BACKEND_API_URL}/collaboration/room`, {
        name: room.name,
        description: 'Created from collaboration server',
        type: 'private',
        participants: room.participants.map(p => ({
          id: p.id,
          name: p.name,
          avatar: p.avatar
        }))
      }, {
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });
      console.log(`Room ${room.id} created in backend with ID ${response.data.roomId}`);
    }
  } catch (error) {
    console.error('Error saving room to backend:', error);
  }
};

// Helper function to upload file to backend
const uploadFileToBackend = async (roomId: string, file: any, userId: string, authToken?: string) => {
  try {
    if (!authToken) {
      console.warn(`No auth token provided for file upload in room ${roomId}, cannot persist to backend`);
      return null;
    }

    const formData = new FormData();
    formData.append('file', new Blob([file.buffer], { type: file.mimetype }), file.originalname);

    const response = await axios.post(`${BACKEND_API_URL}/collaboration/room/${roomId}/file`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
        Authorization: `Bearer ${authToken}`
      }
    });

    return response.data;
  } catch (error) {
    console.error('Error uploading file to backend:', error);
    return null;
  }
};

// API Routes
// Create a new room
router.post('/api/rooms', auth, async (req: any, res) => {
  console.log('POST /api/rooms request received:', req.body);
  try {
    const { name, description, type, members } = req.body;
    const userId = req.user.id;
    const userName = req.user.firstName && req.user.lastName ? 
      `${req.user.firstName} ${req.user.lastName}` : 
      req.body.userName || 'Anonymous User';
    
    if (!name || !userId) {
      console.error('Missing required fields:', { name, userId });
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
    // Create room in MongoDB
    const room = new CollaborationRoom({
    name,
      description: description || 'Created from collaboration server',
      type: type || 'private',
    participants: [{
        userId: new mongoose.Types.ObjectId(userId),
      name: userName,
        avatar: req.user.profilePicture,
      status: 'online'
      },
      ...(members || []).map((participant: any) => ({
        userId: new mongoose.Types.ObjectId(participant.id),
        name: participant.name,
        avatar: participant.avatar,
        status: 'offline'
      }))],
      createdBy: new mongoose.Types.ObjectId(userId)
    });
    
    await room.save();
    
    // Create in-memory room for Socket.IO
    const memoryRoom: Room = {
      _id: room._id.toString(),
      id: room._id.toString(),
      name: room.name,
      participants: room.participants.map(p => ({
        id: p.userId.toString(),
        name: p.name,
        avatar: p.avatar,
        status: p.status,
        isTyping: p.isTyping
      })),
      messages: room.messages.map(m => ({
        id: m._id?.toString() || uuidv4(),
        userId: m.userId.toString(),
        content: m.content,
        timestamp: m.timestamp,
        type: m.type
      })),
      tasks: room.tasks.map(t => ({
        id: t._id?.toString() || uuidv4(),
        title: t.title,
        description: t.description,
        assigneeId: t.assigneeId?.toString(),
        status: t.status,
        priority: t.priority,
        dueDate: t.dueDate,
        createdAt: t.createdAt
      })),
      files: room.files.map(f => ({
        id: f._id?.toString() || uuidv4(),
        name: f.name,
        size: f.size,
        type: f.type,
        uploadedBy: f.uploadedBy.toString(),
        uploadedAt: f.uploadedAt,
        url: f.url
      })),
      isRecording: room.isRecording,
      sessionTimer: room.sessionTimer,
      createdAt: room.createdAt,
      whiteboard: room.whiteboard
    };
    
    rooms.set(memoryRoom.id, memoryRoom);
    
    console.log(`Room created: ${memoryRoom.id}`);
    return res.status(201).json({ 
      roomId: memoryRoom.id,
      _id: memoryRoom._id,
      room: memoryRoom 
    });
  } catch (error) {
    console.error('Error creating room:', error);
    return res.status(500).json({ error: 'Failed to create room' });
    }
});
  
// Get all rooms for a user
router.get('/api/rooms', auth, async (req: any, res) => {
  try {
    const userId = req.user.id;
    
    // Find rooms where the user is a participant
    const dbRooms = await CollaborationRoom.find({
      'participants.userId': new mongoose.Types.ObjectId(userId)
    }).select('_id name description type participants createdAt updatedAt');
  
    // Map to the format expected by the frontend
    const mappedRooms = dbRooms.map(room => ({
      _id: room._id.toString(),
      id: room._id.toString(),
      name: room.name,
      description: room.description,
      type: room.type,
      participants: room.participants.map(p => ({
        id: p.userId.toString(),
        name: p.name,
        avatar: p.avatar,
        status: p.status
      })),
      createdAt: room.createdAt,
      updatedAt: room.updatedAt
    }));
    
    return res.json(mappedRooms);
  } catch (error) {
    console.error('Error getting rooms:', error);
    return res.status(500).json({ error: 'Failed to get rooms' });
  }
});

// Get a specific room
router.get('/api/rooms/:roomId', auth, async (req: any, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;
    
    // Find room in MongoDB
    const dbRoom = await CollaborationRoom.findById(roomId);
    
    if (!dbRoom) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    // Check if user is a participant
    const isParticipant = dbRoom.participants.some(p => 
      p.userId.toString() === userId
    );
    
    if (!isParticipant) {
      return res.status(403).json({ error: 'Not authorized to access this room' });
    }
    
    // Map to the format expected by the frontend
    const room = {
      _id: dbRoom._id.toString(),
      id: dbRoom._id.toString(),
      name: dbRoom.name,
      description: dbRoom.description,
      type: dbRoom.type,
      participants: dbRoom.participants.map(p => ({
        id: p.userId.toString(),
        name: p.name,
        avatar: p.avatar,
        status: p.status,
        isTyping: p.isTyping
      })),
      messages: dbRoom.messages.map(m => ({
        id: m._id?.toString() || uuidv4(),
        userId: m.userId.toString(),
        content: m.content,
        timestamp: m.timestamp,
        type: m.type
      })),
      tasks: dbRoom.tasks.map(t => ({
        id: t._id?.toString() || uuidv4(),
        title: t.title,
        description: t.description,
        assigneeId: t.assigneeId?.toString(),
        status: t.status,
        priority: t.priority,
        dueDate: t.dueDate,
        createdAt: t.createdAt
      })),
      files: dbRoom.files.map(f => ({
        id: f._id?.toString() || uuidv4(),
        name: f.name,
        size: f.size,
        type: f.type,
        uploadedBy: f.uploadedBy.toString(),
        uploadedAt: f.uploadedAt,
        url: f.url
      })),
      isRecording: dbRoom.isRecording,
      sessionTimer: dbRoom.sessionTimer,
      createdAt: dbRoom.createdAt,
      whiteboard: dbRoom.whiteboard
    };
    
    // Store in memory if not already there
    if (!rooms.has(roomId)) {
      rooms.set(roomId, room as Room);
    }
    
    return res.json(room);
  } catch (error) {
    console.error('Error getting room:', error);
    return res.status(500).json({ error: 'Failed to get room' });
  }
});

// Update room details
router.put('/api/rooms/:roomId', auth, async (req: any, res) => {
  try {
    const { roomId } = req.params;
    const { name, description, type } = req.body;
    const userId = req.user.id;
    
    // Find room in MongoDB
    const dbRoom = await CollaborationRoom.findById(roomId);
    
    if (!dbRoom) {
      return res.status(404).json({ error: 'Room not found' });
  }
  
    // Check if user is the creator
    if (dbRoom.createdBy.toString() !== userId) {
      return res.status(403).json({ error: 'Not authorized to update this room' });
    }
    
    // Update fields
    if (name) dbRoom.name = name;
    if (description !== undefined) dbRoom.description = description;
    if (type) dbRoom.type = type;
    
    await dbRoom.save();
    
    // Update in-memory room
    const memoryRoom = rooms.get(roomId);
    if (memoryRoom) {
      if (name) memoryRoom.name = name;
      // Other fields not needed in memory
    }
    
    // Map to the format expected by the frontend
    const room = {
      _id: dbRoom._id.toString(),
      id: dbRoom._id.toString(),
      name: dbRoom.name,
      description: dbRoom.description,
      type: dbRoom.type,
      participants: dbRoom.participants.map(p => ({
        id: p.userId.toString(),
        name: p.name,
        avatar: p.avatar,
        status: p.status
      })),
      createdAt: dbRoom.createdAt,
      updatedAt: dbRoom.updatedAt
    };
    
    return res.json(room);
  } catch (error) {
    console.error('Error updating room:', error);
    return res.status(500).json({ error: 'Failed to update room' });
  }
});

// Add a participant to a room
router.post('/api/rooms/:roomId/participant', auth, async (req: any, res) => {
  try {
  const { roomId } = req.params;
    const { userId, name, avatar } = req.body;
    const currentUserId = req.user.id;
  
    // Find room in MongoDB
    const dbRoom = await CollaborationRoom.findById(roomId);
    
    if (!dbRoom) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
    // Check if user is the creator or already a participant
    const isAuthorized = dbRoom.createdBy.toString() === currentUserId ||
      dbRoom.participants.some(p => p.userId.toString() === currentUserId);
    
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Not authorized to add participants' });
    }
    
    // Check if user is already a participant
    const existingParticipant = dbRoom.participants.find(p => 
      p.userId.toString() === userId
    );
    
    if (existingParticipant) {
      return res.status(400).json({ error: 'User is already a participant' });
    }
    
    // Add participant
    dbRoom.participants.push({
      userId: new mongoose.Types.ObjectId(userId),
      name,
      avatar,
      status: 'offline'
    });
    
    await dbRoom.save();

    // Update in-memory room
    const memoryRoom = rooms.get(roomId);
    if (memoryRoom) {
      memoryRoom.participants.push({
        id: userId,
        name,
        avatar,
        status: 'offline'
      });
    }
    
    // Emit event to room
    io.to(roomId).emit('participant-joined', {
      userId,
      name,
      avatar,
      room: memoryRoom
    });
    
    return res.json({
      id: dbRoom._id.toString(),
      participants: dbRoom.participants.map(p => ({
        id: p.userId.toString(),
        name: p.name,
        avatar: p.avatar,
        status: p.status
      }))
    });
  } catch (error) {
    console.error('Error adding participant:', error);
    return res.status(500).json({ error: 'Failed to add participant' });
  }
});

// Upload a file to a room
router.post('/api/rooms/:roomId/file', auth, upload.single('file'), async (req: any, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Find room in MongoDB
    const dbRoom = await CollaborationRoom.findById(roomId);
    
    if (!dbRoom) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    // Check if user is a participant
    const isParticipant = dbRoom.participants.some(p => 
      p.userId.toString() === userId
    );
    
    if (!isParticipant) {
      return res.status(403).json({ error: 'Not authorized to upload files to this room' });
    }
    
    // Upload file
    const result = await uploadFile(req.file, {
      metadata: {
        roomId,
        userId
      }
    });
    
    // Add file to room
    const newFile = {
      name: req.file.originalname,
      size: req.file.size,
      type: req.file.mimetype,
      uploadedBy: new mongoose.Types.ObjectId(userId),
      uploadedAt: new Date(),
      url: result.url,
      gcsMetadata: {
        bucket: result.bucket,
        filename: result.filename,
        contentType: result.contentType,
        size: result.size
      }
    };
    
    dbRoom.files.push(newFile);
    
    // Add a system message about the file upload
    const message = {
      userId: new mongoose.Types.ObjectId(userId),
      content: `Uploaded file: ${req.file.originalname}`,
      timestamp: new Date(),
      type: 'system' as 'system'
    };
    
    dbRoom.messages.push(message);
    
    await dbRoom.save();
    
    // Update in-memory room
    const memoryRoom = rooms.get(roomId);
    if (memoryRoom) {
      const fileId = dbRoom.files[dbRoom.files.length - 1]._id?.toString() || uuidv4();
      const messageId = dbRoom.messages[dbRoom.messages.length - 1]._id?.toString() || uuidv4();
      
      const memoryFile = {
        id: fileId,
        name: newFile.name,
        size: newFile.size,
        type: newFile.type,
        uploadedBy: userId,
        uploadedAt: newFile.uploadedAt,
        url: newFile.url
      };
      
      const memoryMessage = {
        id: messageId,
        userId,
        content: message.content,
        timestamp: message.timestamp,
        type: message.type
      };
      
      memoryRoom.files.push(memoryFile);
      memoryRoom.messages.push(memoryMessage);
      
      // Emit event to room
      io.to(roomId).emit('file-uploaded', {
        file: memoryFile,
        message: memoryMessage,
        room: memoryRoom
      });
    }
    
    return res.status(201).json({
      id: dbRoom.files[dbRoom.files.length - 1]._id?.toString() || uuidv4(),
      name: newFile.name,
      size: newFile.size,
      type: newFile.type,
      uploadedBy: userId,
      uploadedAt: newFile.uploadedAt,
      url: newFile.url
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    return res.status(500).json({ error: 'Failed to upload file' });
  }
});

// Get all files in a room
router.get('/api/rooms/:roomId/files', auth, async (req: any, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;
    
    // Find room in MongoDB
    const dbRoom = await CollaborationRoom.findById(roomId);
    
    if (!dbRoom) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    // Check if user is a participant
    const isParticipant = dbRoom.participants.some(p => 
      p.userId.toString() === userId
    );
    
    if (!isParticipant) {
      return res.status(403).json({ error: 'Not authorized to access files in this room' });
    }
    
    // Map files to the format expected by the frontend
    const files = dbRoom.files.map(f => ({
      id: f._id?.toString() || uuidv4(),
      name: f.name,
      size: f.size,
      type: f.type,
      uploadedBy: f.uploadedBy.toString(),
      uploadedAt: f.uploadedAt,
      url: f.url
    }));
    
    return res.json(files);
  } catch (error) {
    console.error('Error getting files:', error);
    return res.status(500).json({ error: 'Failed to get files' });
  }
});

// Delete a room
router.delete('/api/rooms/:roomId', auth, async (req: any, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;
    
    // Find room in MongoDB
    const dbRoom = await CollaborationRoom.findById(roomId);
    
    if (!dbRoom) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    // Check if user is the creator
    if (dbRoom.createdBy.toString() !== userId) {
      return res.status(403).json({ error: 'Not authorized to delete this room' });
    }
    
    // Delete room
    await CollaborationRoom.findByIdAndDelete(roomId);
    
    // Remove from in-memory store
    rooms.delete(roomId);
    
    // Disconnect all sockets in the room
    const socketsInRoom = await io.in(roomId).fetchSockets();
    socketsInRoom.forEach(socket => {
      socket.leave(roomId);
      socket.emit('room-deleted', { roomId });
    });
    
    return res.json({ message: 'Room deleted successfully' });
  } catch (error) {
    console.error('Error deleting room:', error);
    return res.status(500).json({ error: 'Failed to delete room' });
  }
});

// File upload route
app.post('/upload/:roomId', auth, upload.single('file'), async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const roomId = req.params.roomId;
    const room = await CollaborationRoom.findById(roomId);
    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }

    // Create a fake socket for file upload handling
    const fakeSocket = {
      data: { userId: req.user.id },
      to: () => ({ emit: () => {} })
    };

    const message = await handleFileUpload(fakeSocket as any, roomId, req.file);
    if (!message) {
      return res.status(500).json({ message: 'Failed to upload file' });
    }

    res.json({
      message: 'File uploaded successfully',
      fileUrl: message.metadata.fileUrl,
      messageId: message._id
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ message: 'Failed to upload file' });
  }
});

// File download route
app.get('/download/:fileId', auth, async (req: AuthenticatedRequest, res) => {
  try {
    const fileId = req.params.fileId;
    
    // Create a fake socket for file download handling
    const fakeSocket = {
      data: { userId: req.user.id },
      emit: () => {}
    };

    const filePath = await handleFileDownload(fakeSocket as any, fileId);
    if (!filePath) {
      return res.status(404).json({ message: 'File not found' });
    }

    res.download(filePath);
  } catch (error) {
    console.error('Error downloading file:', error);
    res.status(500).json({ message: 'Failed to download file' });
  }
});

// Socket.IO connection handler
io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);
  
  // Join a room
  socket.on('join-room', async ({ roomId, userId, userName, userAvatar }) => {
    try {
      // Leave previous room if any
      const previousRoomId = userRooms.get(userId);
      if (previousRoomId && previousRoomId !== roomId) {
        socket.leave(previousRoomId);
        
        // Update participant status in previous room
        const previousRoom = rooms.get(previousRoomId);
        if (previousRoom) {
          const participant = previousRoom.participants.find(p => p.id === userId);
          if (participant) {
            participant.status = 'offline';
            
            // Emit to previous room
            io.to(previousRoomId).emit('participant-left', {
              userId,
              room: previousRoom
            });
          }
        }
  }
  
      // Join new room
      socket.join(roomId);
      userRooms.set(userId, roomId);
      
      // Get room from memory or database
      let room = rooms.get(roomId);
    
    if (!room) {
        // Try to get from database
        const dbRoom = await CollaborationRoom.findById(roomId);
        
        if (!dbRoom) {
          socket.emit('error', { message: 'Room not found' });
      return;
    }
    
        // Create in-memory room
        room = {
          _id: dbRoom._id.toString(),
          id: dbRoom._id.toString(),
          name: dbRoom.name,
          participants: dbRoom.participants.map(p => ({
            id: p.userId.toString(),
            name: p.name,
            avatar: p.avatar,
            status: p.status,
            isTyping: p.isTyping
          })),
          messages: dbRoom.messages.map(m => ({
            id: m._id?.toString() || uuidv4(),
            userId: m.userId.toString(),
            content: m.content,
            timestamp: m.timestamp,
            type: m.type
          })),
          tasks: dbRoom.tasks.map(t => ({
            id: t._id?.toString() || uuidv4(),
            title: t.title,
            description: t.description,
            assigneeId: t.assigneeId?.toString(),
            status: t.status,
            priority: t.priority,
            dueDate: t.dueDate,
            createdAt: t.createdAt
          })),
          files: dbRoom.files.map(f => ({
            id: f._id?.toString() || uuidv4(),
            name: f.name,
            size: f.size,
            type: f.type,
            uploadedBy: f.uploadedBy.toString(),
            uploadedAt: f.uploadedAt,
            url: f.url
          })),
          isRecording: dbRoom.isRecording,
          sessionTimer: dbRoom.sessionTimer,
          createdAt: dbRoom.createdAt,
          whiteboard: dbRoom.whiteboard
        };
        
        rooms.set(roomId, room);
      }
      
      // Update participant status
      const participant = room.participants.find(p => p.id === userId);
      
      if (participant) {
        participant.status = 'online';
    } else {
        // Add participant if not exists
      room.participants.push({
          id: userId,
          name: userName,
          avatar: userAvatar,
        status: 'online'
      });
        
        // Update in database
        await CollaborationRoom.findByIdAndUpdate(roomId, {
          $addToSet: {
            participants: {
              userId: new mongoose.Types.ObjectId(userId),
              name: userName,
              avatar: userAvatar,
              status: 'online'
            }
          }
        });
      }
      
      // Emit room data to the user
      socket.emit('room-data', { room });
    
      // Emit to other participants
      socket.to(roomId).emit('participant-joined', {
        userId,
        name: userName,
        avatar: userAvatar,
        room
    });
    
      console.log(`User ${userId} joined room ${roomId}`);
    } catch (error) {
      console.error('Error joining room:', error);
      socket.emit('error', { message: 'Failed to join room' });
    }
  });
  
  // Leave room
  socket.on('leave-room', ({ roomId, userId }) => {
    const room = rooms.get(roomId);
    
    if (room) {
      // Update participant status
      const participant = room.participants.find(p => p.id === userId);
      if (participant) {
        participant.status = 'offline';
      }
      
      // Remove user-room association
      userRooms.delete(userId);
      
      // Leave socket room
      socket.leave(roomId);
      
      // Notify room
      io.to(roomId).emit('participant-left', {
        userId,
        room
      });
      
      console.log(`User ${userId} left room ${roomId}`);

      // Persist room state to backend
      const authToken = socket.handshake.auth.token || 
                      socket.handshake.headers.authorization;
      if (authToken) {
        saveRoomToBackend(room, authToken.split(' ')[1]).catch(err => {
          console.error('Failed to save room state to backend on leave:', err);
        });
      }
    }
  });
  
  // Send message
  socket.on('send-message', ({ roomId, message }) => {
    const room = rooms.get(roomId);
    
    if (!room) {
      socket.emit('error', 'Room not found');
      return;
    }
    
    // Add message ID if not provided
    if (!message.id) {
      message.id = uuidv4();
    }
    
    // Add timestamp if not provided
    if (!message.timestamp) {
      message.timestamp = new Date();
    }
    
    // Add message to room
    room.messages.push(message);
    
    // Broadcast message to room
    io.to(roomId).emit('new-message', {
      message,
      room
    });
    
    console.log(`New message in room ${roomId} from ${message.userId}`);

    // Persist room state to backend
    const authToken = socket.handshake.auth.token || 
                    socket.handshake.headers.authorization;
    if (authToken) {
      saveRoomToBackend(room, authToken.split(' ')[1]).catch(err => {
        console.error('Failed to save room state to backend after message:', err);
      });
    }
  });
  
  // Update task
  socket.on('update-task', ({ roomId, taskId, updates }) => {
    const room = rooms.get(roomId);
    
    if (!room) {
      socket.emit('error', 'Room not found');
      return;
    }
    
    // Find task
    const taskIndex = room.tasks.findIndex(t => t.id === taskId);
    
    if (taskIndex === -1) {
      // Task not found, might be a new task
      if (updates.id && updates.title) {
        const newTask: Task = {
          id: updates.id,
          title: updates.title,
          description: updates.description || '',
          assigneeId: updates.assigneeId,
          status: updates.status || 'todo',
          priority: updates.priority || 'medium',
          dueDate: updates.dueDate,
          createdAt: new Date()
        };
        
        room.tasks.push(newTask);
        
        // Broadcast task update
        io.to(roomId).emit('task-updated', {
          task: newTask,
          room
        });
        
        console.log(`New task created in room ${roomId}: ${newTask.title}`);
      } else {
        socket.emit('error', 'Task not found and insufficient data to create new task');
      }
      return;
    }
    
    // Update task
    room.tasks[taskIndex] = {
      ...room.tasks[taskIndex],
      ...updates
    };
    
    // Broadcast task update
    io.to(roomId).emit('task-updated', {
      task: room.tasks[taskIndex],
      room
    });
    
    console.log(`Task ${taskId} updated in room ${roomId}`);

    // Persist room state to backend
    const authToken = socket.handshake.auth.token || 
                    socket.handshake.headers.authorization;
    if (authToken) {
      saveRoomToBackend(room, authToken.split(' ')[1]).catch(err => {
        console.error('Failed to save room state to backend after task update:', err);
      });
    }
  });
  
  // Delete task
  socket.on('delete-task', ({ roomId, taskId }) => {
    const room = rooms.get(roomId);
    
    if (!room) {
      socket.emit('error', 'Room not found');
      return;
    }
    
    // Remove task
    room.tasks = room.tasks.filter(t => t.id !== taskId);
    
    // Broadcast task deletion
    io.to(roomId).emit('task-deleted', {
      taskId,
      room
    });
    
    console.log(`Task ${taskId} deleted from room ${roomId}`);

    // Persist room state to backend
    const authToken = socket.handshake.auth.token || 
                    socket.handshake.headers.authorization;
    if (authToken) {
      saveRoomToBackend(room, authToken.split(' ')[1]).catch(err => {
        console.error('Failed to save room state to backend after task deletion:', err);
      });
    }
  });
  
  // Update whiteboard
  socket.on('update-whiteboard', ({ roomId, elements }) => {
    const room = rooms.get(roomId);
    
    if (!room) {
      socket.emit('error', 'Room not found');
      return;
    }
    
    // Update whiteboard elements
    room.whiteboard.elements = elements;
    
    // Broadcast whiteboard update
    socket.to(roomId).emit('whiteboard-updated', {
      elements,
      room
    });
    
    console.log(`Whiteboard updated in room ${roomId}`);

    // Persist room state to backend periodically (avoid too many updates)
    const authToken = socket.handshake.auth.token || 
                    socket.handshake.headers.authorization;
    if (authToken) {
      // Debounce whiteboard updates (save every 10 seconds)
      if (!room.whiteboardSaveTimeout) {
        room.whiteboardSaveTimeout = setTimeout(() => {
          saveRoomToBackend(room, authToken.split(' ')[1]).catch(err => {
            console.error('Failed to save room state to backend after whiteboard update:', err);
          });
          delete room.whiteboardSaveTimeout;
        }, 10000);
      }
    }
  });
  
  // User typing status
  socket.on('typing-status', ({ roomId, userId, isTyping, location }) => {
    const room = rooms.get(roomId);
    
    if (!room) {
      socket.emit('error', 'Room not found');
      return;
    }
    
    // Update participant typing status
    const participant = room.participants.find(p => p.id === userId);
    if (participant) {
      participant.isTyping = isTyping;
    }
    
    // Broadcast typing status
    socket.to(roomId).emit('typing-status-updated', {
      userId,
      isTyping,
      location,
      room
    });
  });
  
  // Cursor position
  socket.on('cursor-move', ({ roomId, userId, x, y }) => {
    // Broadcast cursor position
    socket.to(roomId).emit('cursor-moved', {
      userId,
      x,
      y
    });
  });
  
  // Toggle recording
  socket.on('toggle-recording', ({ roomId }) => {
    const room = rooms.get(roomId);
    
    if (!room) {
      socket.emit('error', 'Room not found');
      return;
    }
    
    // Toggle recording status
    room.isRecording = !room.isRecording;
    
    // Broadcast recording status
    io.to(roomId).emit('recording-toggled', {
      isRecording: room.isRecording,
      room
    });
    
    console.log(`Recording ${room.isRecording ? 'started' : 'stopped'} in room ${roomId}`);

    // Persist room state to backend
    const authToken = socket.handshake.auth.token || 
                    socket.handshake.headers.authorization;
    if (authToken) {
      saveRoomToBackend(room, authToken.split(' ')[1]).catch(err => {
        console.error('Failed to save room state to backend after recording toggle:', err);
      });
    }
  });
  
  // File upload event
  socket.on('file:upload', async (data: { roomId: string; file: Express.Multer.File }) => {
    try {
      const { roomId, file } = data;
      await handleFileUpload(socket, roomId, file);
    } catch (error) {
      console.error('Error handling file upload:', error);
      socket.emit('error', { message: 'Failed to upload file' });
      }
  });
  
  // File download event
  socket.on('file:download', async (data: { fileId: string }) => {
    try {
      const { fileId } = data;
      const filePath = await handleFileDownload(socket, fileId);
      if (filePath) {
        socket.emit('file:ready', { fileId, filePath });
      }
    } catch (error) {
      console.error('Error handling file download:', error);
      socket.emit('error', { message: 'Failed to download file' });
    }
  });
  
  // Whiteboard events
  socket.on('whiteboard:draw', async (data: { roomId: string; elements: any[] }) => {
    try {
      const { roomId, elements } = data;
      await handleWhiteboardDraw(socket, roomId, elements);
    } catch (error) {
      console.error('Error handling whiteboard draw:', error);
      socket.emit('error', { message: 'Failed to update whiteboard' });
    }
  });

  socket.on('whiteboard:clear', async (data: { roomId: string }) => {
    try {
      const { roomId } = data;
      await handleWhiteboardClear(socket, roomId);
    } catch (error) {
      console.error('Error handling whiteboard clear:', error);
      socket.emit('error', { message: 'Failed to clear whiteboard' });
    }
  });

  socket.on('whiteboard:sync', async (data: { roomId: string }) => {
    try {
      const { roomId } = data;
      await handleWhiteboardSync(socket, roomId);
    } catch (error) {
      console.error('Error handling whiteboard sync:', error);
      socket.emit('error', { message: 'Failed to sync whiteboard' });
    }
  });
  
  // Disconnect
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
    
    // Find rooms user was in and update status
    // Note: In a production app, you would store socket.id -> userId mapping
    // For now, we can't reliably handle this without that mapping
  });
});

// Start server
const PORT = process.env.PORT || 4001;
server.listen(PORT, () => {
  console.log(`Collaboration server running on port ${PORT}`);
}); 