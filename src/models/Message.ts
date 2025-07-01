import mongoose, { Schema, Document } from 'mongoose';

export interface IMessage extends Document {
  roomId: mongoose.Types.ObjectId;
  senderId: mongoose.Types.ObjectId;
  content: string;
  type: 'text' | 'file' | 'system';
  metadata?: {
    fileName?: string;
    fileUrl?: string;
    fileType?: string;
    fileSize?: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const MessageSchema = new Schema({
  roomId: {
    type: Schema.Types.ObjectId,
    ref: 'Room',
    required: true,
    index: true
  },
  senderId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['text', 'file', 'system'],
    default: 'text'
  },
  metadata: {
    fileName: String,
    fileUrl: String,
    fileType: String,
    fileSize: Number
  }
}, {
  timestamps: true
});

// Index for faster queries
MessageSchema.index({ roomId: 1, createdAt: -1 });

export const Message = mongoose.model<IMessage>('Message', MessageSchema); 