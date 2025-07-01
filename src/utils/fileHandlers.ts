import { Socket } from 'socket.io';
import { Message } from '../models/Message';
import mongoose from 'mongoose';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  }
});

export const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    // Add file type restrictions if needed
    cb(null, true);
  }
});

export const handleFileUpload = async (
  socket: Socket,
  roomId: string,
  file: Express.Multer.File
) => {
  try {
    // Create file message
    const message = await Message.create({
      roomId: new mongoose.Types.ObjectId(roomId),
      senderId: new mongoose.Types.ObjectId(socket.data.userId),
      content: file.originalname,
      type: 'file',
      metadata: {
        fileName: file.originalname,
        fileUrl: `/uploads/${file.filename}`,
        fileType: file.mimetype,
        fileSize: file.size
      }
    });

    // Emit file message to all users in room
    socket.to(roomId).emit('message:received', {
      id: message._id,
      senderId: socket.data.userId,
      content: message.content,
      type: message.type,
      metadata: message.metadata,
      createdAt: message.createdAt
    });

    return message;
  } catch (error) {
    console.error('Error handling file upload:', error);
    socket.emit('error', { message: 'Failed to upload file' });
    return null;
  }
};

export const handleFileDownload = async (
  socket: Socket,
  fileId: string
) => {
  try {
    const message = await Message.findById(fileId);
    if (!message || !message.metadata?.fileUrl) {
      throw new Error('File not found');
    }

    const filePath = path.join(__dirname, '../..', message.metadata.fileUrl);
    if (!fs.existsSync(filePath)) {
      throw new Error('File not found on disk');
    }

    return filePath;
  } catch (error) {
    console.error('Error handling file download:', error);
    socket.emit('error', { message: 'Failed to download file' });
    return null;
  }
}; 