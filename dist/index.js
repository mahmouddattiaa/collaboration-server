"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Load environment variables from .env file
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
// Set environment variables explicitly if not provided
process.env.JWT_SECRET = process.env.JWT_SECRET || 'your_secure_jwt_secret_key';
process.env.PORT = process.env.PORT || '4001';
process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/moneyyy';
process.env.BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:5001/api';
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const uuid_1 = require("uuid");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const axios_1 = __importDefault(require("axios"));
const multer_1 = __importDefault(require("multer"));
const mongoose_1 = __importDefault(require("mongoose"));
const db_1 = __importDefault(require("./config/db"));
const auth_1 = __importDefault(require("./middleware/auth"));
const CollaborationRoom_1 = __importDefault(require("./models/CollaborationRoom"));
const fileStorage_1 = require("./utils/fileStorage");
// Configuration
const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:5001/api';
// In-memory data store
const rooms = new Map();
const userRooms = new Map(); // userId -> roomId
// Create Express app
const app = (0, express_1.default)();
const router = express_1.default.Router();
app.use((0, cors_1.default)({
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));
app.use(express_1.default.json());
// Register routes explicitly
app.use('/', router);
// Create HTTP server
const server = http_1.default.createServer(app);
// Create Socket.IO server
const io = new socket_io_1.Server(server, {
    cors: {
        origin: ['http://localhost:5173', 'http://localhost:3000'],
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: true
    }
});
// Configure multer for memory storage
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB file size limit
    }
});
// Ensure uploads directory exists
const uploadsDir = path_1.default.join(__dirname, '../uploads');
if (!fs_1.default.existsSync(uploadsDir)) {
    fs_1.default.mkdirSync(uploadsDir, { recursive: true });
}
// Serve static files from uploads directory
app.use('/uploads', express_1.default.static(uploadsDir));
// Connect to MongoDB
(0, db_1.default)();
// Helper function to save room to backend
const saveRoomToBackend = async (room, authToken) => {
    try {
        if (!authToken) {
            console.warn(`No auth token provided for room ${room.id}, cannot persist to backend`);
            return;
        }
        // Find if the room exists in the backend by roomId
        const existingRoom = await axios_1.default.get(`${BACKEND_API_URL}/collaboration/room/${room.id}`, {
            headers: {
                Authorization: `Bearer ${authToken}`
            }
        }).catch(() => null);
        if (existingRoom?.data) {
            // Update existing room
            await axios_1.default.put(`${BACKEND_API_URL}/collaboration/room/${room.id}`, {
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
        }
        else {
            // Create new room
            const response = await axios_1.default.post(`${BACKEND_API_URL}/collaboration/room`, {
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
    }
    catch (error) {
        console.error('Error saving room to backend:', error);
    }
};
// Helper function to upload file to backend
const uploadFileToBackend = async (roomId, file, userId, authToken) => {
    try {
        if (!authToken) {
            console.warn(`No auth token provided for file upload in room ${roomId}, cannot persist to backend`);
            return null;
        }
        const formData = new FormData();
        formData.append('file', new Blob([file.buffer], { type: file.mimetype }), file.originalname);
        const response = await axios_1.default.post(`${BACKEND_API_URL}/collaboration/room/${roomId}/file`, formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
                Authorization: `Bearer ${authToken}`
            }
        });
        return response.data;
    }
    catch (error) {
        console.error('Error uploading file to backend:', error);
        return null;
    }
};
// API Routes
// Create a new room
router.post('/api/rooms', auth_1.default, async (req, res) => {
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
        const room = new CollaborationRoom_1.default({
            name,
            description: description || 'Created from collaboration server',
            type: type || 'private',
            participants: [{
                    userId: new mongoose_1.default.Types.ObjectId(userId),
                    name: userName,
                    avatar: req.user.profilePicture,
                    status: 'online'
                },
                ...(members || []).map((participant) => ({
                    userId: new mongoose_1.default.Types.ObjectId(participant.id),
                    name: participant.name,
                    avatar: participant.avatar,
                    status: 'offline'
                }))],
            createdBy: new mongoose_1.default.Types.ObjectId(userId)
        });
        await room.save();
        // Create in-memory room for Socket.IO
        const memoryRoom = {
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
                id: m._id?.toString() || (0, uuid_1.v4)(),
                userId: m.userId.toString(),
                content: m.content,
                timestamp: m.timestamp,
                type: m.type
            })),
            tasks: room.tasks.map(t => ({
                id: t._id?.toString() || (0, uuid_1.v4)(),
                title: t.title,
                description: t.description,
                assigneeId: t.assigneeId?.toString(),
                status: t.status,
                priority: t.priority,
                dueDate: t.dueDate,
                createdAt: t.createdAt
            })),
            files: room.files.map(f => ({
                id: f._id?.toString() || (0, uuid_1.v4)(),
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
    }
    catch (error) {
        console.error('Error creating room:', error);
        return res.status(500).json({ error: 'Failed to create room' });
    }
});
// Get all rooms for a user
router.get('/api/rooms', auth_1.default, async (req, res) => {
    try {
        const userId = req.user.id;
        // Find rooms where the user is a participant
        const dbRooms = await CollaborationRoom_1.default.find({
            'participants.userId': new mongoose_1.default.Types.ObjectId(userId)
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
    }
    catch (error) {
        console.error('Error getting rooms:', error);
        return res.status(500).json({ error: 'Failed to get rooms' });
    }
});
// Get a specific room
router.get('/api/rooms/:roomId', auth_1.default, async (req, res) => {
    try {
        const { roomId } = req.params;
        const userId = req.user.id;
        // Find room in MongoDB
        const dbRoom = await CollaborationRoom_1.default.findById(roomId);
        if (!dbRoom) {
            return res.status(404).json({ error: 'Room not found' });
        }
        // Check if user is a participant
        const isParticipant = dbRoom.participants.some(p => p.userId.toString() === userId);
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
                id: m._id?.toString() || (0, uuid_1.v4)(),
                userId: m.userId.toString(),
                content: m.content,
                timestamp: m.timestamp,
                type: m.type
            })),
            tasks: dbRoom.tasks.map(t => ({
                id: t._id?.toString() || (0, uuid_1.v4)(),
                title: t.title,
                description: t.description,
                assigneeId: t.assigneeId?.toString(),
                status: t.status,
                priority: t.priority,
                dueDate: t.dueDate,
                createdAt: t.createdAt
            })),
            files: dbRoom.files.map(f => ({
                id: f._id?.toString() || (0, uuid_1.v4)(),
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
            rooms.set(roomId, room);
        }
        return res.json(room);
    }
    catch (error) {
        console.error('Error getting room:', error);
        return res.status(500).json({ error: 'Failed to get room' });
    }
});
// Update room details
router.put('/api/rooms/:roomId', auth_1.default, async (req, res) => {
    try {
        const { roomId } = req.params;
        const { name, description, type } = req.body;
        const userId = req.user.id;
        // Find room in MongoDB
        const dbRoom = await CollaborationRoom_1.default.findById(roomId);
        if (!dbRoom) {
            return res.status(404).json({ error: 'Room not found' });
        }
        // Check if user is the creator
        if (dbRoom.createdBy.toString() !== userId) {
            return res.status(403).json({ error: 'Not authorized to update this room' });
        }
        // Update fields
        if (name)
            dbRoom.name = name;
        if (description !== undefined)
            dbRoom.description = description;
        if (type)
            dbRoom.type = type;
        await dbRoom.save();
        // Update in-memory room
        const memoryRoom = rooms.get(roomId);
        if (memoryRoom) {
            if (name)
                memoryRoom.name = name;
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
    }
    catch (error) {
        console.error('Error updating room:', error);
        return res.status(500).json({ error: 'Failed to update room' });
    }
});
// Add a participant to a room
router.post('/api/rooms/:roomId/participant', auth_1.default, async (req, res) => {
    try {
        const { roomId } = req.params;
        const { userId, name, avatar } = req.body;
        const currentUserId = req.user.id;
        // Find room in MongoDB
        const dbRoom = await CollaborationRoom_1.default.findById(roomId);
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
        const existingParticipant = dbRoom.participants.find(p => p.userId.toString() === userId);
        if (existingParticipant) {
            return res.status(400).json({ error: 'User is already a participant' });
        }
        // Add participant
        dbRoom.participants.push({
            userId: new mongoose_1.default.Types.ObjectId(userId),
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
    }
    catch (error) {
        console.error('Error adding participant:', error);
        return res.status(500).json({ error: 'Failed to add participant' });
    }
});
// Upload a file to a room
router.post('/api/rooms/:roomId/file', auth_1.default, upload.single('file'), async (req, res) => {
    try {
        const { roomId } = req.params;
        const userId = req.user.id;
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        // Find room in MongoDB
        const dbRoom = await CollaborationRoom_1.default.findById(roomId);
        if (!dbRoom) {
            return res.status(404).json({ error: 'Room not found' });
        }
        // Check if user is a participant
        const isParticipant = dbRoom.participants.some(p => p.userId.toString() === userId);
        if (!isParticipant) {
            return res.status(403).json({ error: 'Not authorized to upload files to this room' });
        }
        // Upload file
        const result = await (0, fileStorage_1.uploadFile)(req.file, {
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
            uploadedBy: new mongoose_1.default.Types.ObjectId(userId),
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
            userId: new mongoose_1.default.Types.ObjectId(userId),
            content: `Uploaded file: ${req.file.originalname}`,
            timestamp: new Date(),
            type: 'system'
        };
        dbRoom.messages.push(message);
        await dbRoom.save();
        // Update in-memory room
        const memoryRoom = rooms.get(roomId);
        if (memoryRoom) {
            const fileId = dbRoom.files[dbRoom.files.length - 1]._id?.toString() || (0, uuid_1.v4)();
            const messageId = dbRoom.messages[dbRoom.messages.length - 1]._id?.toString() || (0, uuid_1.v4)();
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
            id: dbRoom.files[dbRoom.files.length - 1]._id?.toString() || (0, uuid_1.v4)(),
            name: newFile.name,
            size: newFile.size,
            type: newFile.type,
            uploadedBy: userId,
            uploadedAt: newFile.uploadedAt,
            url: newFile.url
        });
    }
    catch (error) {
        console.error('Error uploading file:', error);
        return res.status(500).json({ error: 'Failed to upload file' });
    }
});
// Get all files in a room
router.get('/api/rooms/:roomId/files', auth_1.default, async (req, res) => {
    try {
        const { roomId } = req.params;
        const userId = req.user.id;
        // Find room in MongoDB
        const dbRoom = await CollaborationRoom_1.default.findById(roomId);
        if (!dbRoom) {
            return res.status(404).json({ error: 'Room not found' });
        }
        // Check if user is a participant
        const isParticipant = dbRoom.participants.some(p => p.userId.toString() === userId);
        if (!isParticipant) {
            return res.status(403).json({ error: 'Not authorized to access files in this room' });
        }
        // Map files to the format expected by the frontend
        const files = dbRoom.files.map(f => ({
            id: f._id?.toString() || (0, uuid_1.v4)(),
            name: f.name,
            size: f.size,
            type: f.type,
            uploadedBy: f.uploadedBy.toString(),
            uploadedAt: f.uploadedAt,
            url: f.url
        }));
        return res.json(files);
    }
    catch (error) {
        console.error('Error getting files:', error);
        return res.status(500).json({ error: 'Failed to get files' });
    }
});
// Delete a room
router.delete('/api/rooms/:roomId', auth_1.default, async (req, res) => {
    try {
        const { roomId } = req.params;
        const userId = req.user.id;
        // Find room in MongoDB
        const dbRoom = await CollaborationRoom_1.default.findById(roomId);
        if (!dbRoom) {
            return res.status(404).json({ error: 'Room not found' });
        }
        // Check if user is the creator
        if (dbRoom.createdBy.toString() !== userId) {
            return res.status(403).json({ error: 'Not authorized to delete this room' });
        }
        // Delete room
        await CollaborationRoom_1.default.findByIdAndDelete(roomId);
        // Remove from in-memory store
        rooms.delete(roomId);
        // Disconnect all sockets in the room
        const socketsInRoom = await io.in(roomId).fetchSockets();
        socketsInRoom.forEach(socket => {
            socket.leave(roomId);
            socket.emit('room-deleted', { roomId });
        });
        return res.json({ message: 'Room deleted successfully' });
    }
    catch (error) {
        console.error('Error deleting room:', error);
        return res.status(500).json({ error: 'Failed to delete room' });
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
                const dbRoom = await CollaborationRoom_1.default.findById(roomId);
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
                        id: m._id?.toString() || (0, uuid_1.v4)(),
                        userId: m.userId.toString(),
                        content: m.content,
                        timestamp: m.timestamp,
                        type: m.type
                    })),
                    tasks: dbRoom.tasks.map(t => ({
                        id: t._id?.toString() || (0, uuid_1.v4)(),
                        title: t.title,
                        description: t.description,
                        assigneeId: t.assigneeId?.toString(),
                        status: t.status,
                        priority: t.priority,
                        dueDate: t.dueDate,
                        createdAt: t.createdAt
                    })),
                    files: dbRoom.files.map(f => ({
                        id: f._id?.toString() || (0, uuid_1.v4)(),
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
            }
            else {
                // Add participant if not exists
                room.participants.push({
                    id: userId,
                    name: userName,
                    avatar: userAvatar,
                    status: 'online'
                });
                // Update in database
                await CollaborationRoom_1.default.findByIdAndUpdate(roomId, {
                    $addToSet: {
                        participants: {
                            userId: new mongoose_1.default.Types.ObjectId(userId),
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
        }
        catch (error) {
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
            message.id = (0, uuid_1.v4)();
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
                const newTask = {
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
            }
            else {
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
    // File upload
    socket.on('upload-file', async ({ roomId, userId, file }) => {
        const room = rooms.get(roomId);
        if (!room) {
            socket.emit('error', 'Room not found');
            return;
        }
        try {
            // Try to upload to backend first if token is available
            let fileData = null;
            const authToken = socket.handshake.auth.token ||
                socket.handshake.headers.authorization;
            if (authToken) {
                fileData = await uploadFileToBackend(roomId, file, userId, authToken.split(' ')[1]);
            }
            // Fallback to local storage if backend upload failed or no token
            if (!fileData) {
                // Save file locally (implementation depends on your file object structure)
                const timestamp = Date.now();
                const filename = `${timestamp}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
                const filepath = path_1.default.join(uploadsDir, filename);
                fs_1.default.writeFileSync(filepath, file.buffer);
                fileData = {
                    id: (0, uuid_1.v4)(),
                    name: file.originalname,
                    size: file.size,
                    type: file.mimetype,
                    uploadedBy: userId,
                    uploadedAt: new Date(),
                    url: `/uploads/${filename}`
                };
            }
            // Add file to room
            room.files.push(fileData);
            // Add system message about file upload
            const message = {
                id: (0, uuid_1.v4)(),
                userId,
                content: `Uploaded file: ${file.originalname}`,
                timestamp: new Date(),
                type: 'system'
            };
            room.messages.push(message);
            // Notify room about new file
            io.to(roomId).emit('file-uploaded', {
                file: fileData,
                message,
                room
            });
            console.log(`File uploaded to room ${roomId} by ${userId}: ${file.originalname}`);
        }
        catch (error) {
            console.error('Error handling file upload:', error);
            socket.emit('error', 'Failed to upload file');
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
