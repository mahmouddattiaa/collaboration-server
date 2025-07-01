import { Socket } from 'socket.io';
import mongoose from 'mongoose';
import { ICollaborationRoom } from '../models/CollaborationRoom';

// Get the model from mongoose
const CollaborationRoom = mongoose.model<ICollaborationRoom>('CollaborationRoom');

interface WhiteboardElement {
  id: string;
  type: 'pencil' | 'line' | 'rectangle' | 'circle' | 'text';
  points?: { x: number; y: number }[];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  text?: string;
  color: string;
  strokeWidth: number;
}

export const handleWhiteboardDraw = async (
  socket: Socket,
  roomId: string,
  elements: WhiteboardElement[]
) => {
  try {
    // Update room's whiteboard elements
    await CollaborationRoom.findByIdAndUpdate(roomId, {
      $set: { 'whiteboard.elements': elements }
    });

    // Emit update to all users in room except sender
    socket.to(roomId).emit('whiteboard:update', elements);
  } catch (error) {
    console.error('Error handling whiteboard draw:', error);
    socket.emit('error', { message: 'Failed to update whiteboard' });
  }
};

export const handleWhiteboardClear = async (
  socket: Socket,
  roomId: string
) => {
  try {
    // Clear room's whiteboard elements
    await CollaborationRoom.findByIdAndUpdate(roomId, {
      $set: { 'whiteboard.elements': [] }
    });

    // Emit clear to all users in room except sender
    socket.to(roomId).emit('whiteboard:update', []);
  } catch (error) {
    console.error('Error handling whiteboard clear:', error);
    socket.emit('error', { message: 'Failed to clear whiteboard' });
  }
};

export const handleWhiteboardSync = async (
  socket: Socket,
  roomId: string
) => {
  try {
    // Get room's whiteboard elements
    const room = await CollaborationRoom.findById(roomId);
    if (!room) {
      throw new Error('Room not found');
    }

    // Send elements to requesting user
    socket.emit('whiteboard:update', room.whiteboard?.elements || []);
  } catch (error) {
    console.error('Error handling whiteboard sync:', error);
    socket.emit('error', { message: 'Failed to sync whiteboard' });
  }
}; 