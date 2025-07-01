import { Socket } from 'socket.io';
import { Message } from '../models/Message';
import mongoose from 'mongoose';

export interface MessagePayload {
  content: string;
  type: 'text' | 'file' | 'system';
  metadata?: {
    fileName?: string;
    fileUrl?: string;
    fileType?: string;
    fileSize?: number;
  };
}

export const handleSendMessage = async (
  socket: Socket,
  roomId: string,
  payload: MessagePayload
) => {
  try {
    // Create new message in database
    const message = await Message.create({
      roomId: new mongoose.Types.ObjectId(roomId),
      senderId: new mongoose.Types.ObjectId(socket.data.userId),
      content: payload.content,
      type: payload.type,
      metadata: payload.metadata
    });

    // Emit message to all users in room
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
    console.error('Error sending message:', error);
    socket.emit('error', { message: 'Failed to send message' });
    return null;
  }
};

export const handleGetMessages = async (
  socket: Socket,
  roomId: string,
  options: { limit?: number; before?: Date } = {}
) => {
  try {
    const query = {
      roomId: new mongoose.Types.ObjectId(roomId)
    };

    if (options.before) {
      query['createdAt'] = { $lt: options.before };
    }

    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(options.limit || 50)
      .populate('senderId', 'name avatar')
      .lean();

    socket.emit('messages:loaded', messages.reverse());
    return messages;
  } catch (error) {
    console.error('Error getting messages:', error);
    socket.emit('error', { message: 'Failed to load messages' });
    return [];
  }
}; 