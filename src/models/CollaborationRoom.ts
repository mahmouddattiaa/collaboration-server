import mongoose, { Document, Schema } from 'mongoose';



export interface IParticipant {
  _id?: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  name: string;
  avatar?: string;
  status: 'online' | 'away' | 'offline';
  isTyping?: boolean;
}

export interface IMessage {
  _id?: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  content: string;
  timestamp: Date;
  type: 'text' | 'file' | 'system';
}

export interface ITask {
  _id?: mongoose.Types.ObjectId;
  title: string;
  description?: string;
  assigneeId?: mongoose.Types.ObjectId;
  status: 'todo' | 'in-progress' | 'completed';
  priority: 'low' | 'medium' | 'high';
  dueDate?: Date;
  createdAt: Date;
}

export interface IRoomFile {
  _id?: mongoose.Types.ObjectId;
  name: string;
  size: number;
  type: string;
  uploadedBy: mongoose.Types.ObjectId;
  uploadedAt: Date;
  url: string;
  gcsMetadata?: {
    bucket: string;
    filename: string;
    contentType: string;
    size: number;
  }
}

export interface IWhiteboard {
  elements: any[];
}

export interface ICollaborationRoom extends Document {
  name: string;
  description?: string;
  type: 'public' | 'private' | 'team';
  participants: IParticipant[];
  messages: IMessage[];
  tasks: ITask[];
  files: IRoomFile[];
  isRecording: boolean;
  sessionTimer: number;
  whiteboard: IWhiteboard;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const participantSchema = new Schema<IParticipant>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  avatar: String,
  status: {
    type: String,
    enum: ['online', 'away', 'offline'],
    default: 'online'
  },
  isTyping: {
    type: Boolean,
    default: false
  }
});

const messageSchema = new Schema<IMessage>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  type: {
    type: String,
    enum: ['text', 'file', 'system'],
    default: 'text'
  }
});

const taskSchema = new Schema<ITask>({
  title: {
    type: String,
    required: true
  },
  description: String,
  assigneeId: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  status: {
    type: String,
    enum: ['todo', 'in-progress', 'completed'],
    default: 'todo'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },
  dueDate: Date,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const roomFileSchema = new Schema<IRoomFile>({
  name: {
    type: String,
    required: true
  },
  size: {
    type: Number,
    required: true
  },
  type: {
    type: String,
    required: true
  },
  uploadedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  },
  url: {
    type: String,
    required: true
  },
  // Store Google Cloud Storage metadata
  gcsMetadata: {
    bucket: String,
    filename: String,
    contentType: String,
    size: Number
  }
});

const whiteboardSchema = new Schema<IWhiteboard>({
  elements: {
    type: [],
    default: []
  }
});

const collaborationRoomSchema = new Schema<ICollaborationRoom>({
  name: {
    type: String,
    required: true
  },
  description: String,
  type: {
    type: String,
    enum: ['public', 'private', 'team'],
    default: 'private'
  },
  participants: [participantSchema],
  messages: [messageSchema],
  tasks: [taskSchema],
  files: [roomFileSchema],
  isRecording: {
    type: Boolean,
    default: false
  },
  sessionTimer: {
    type: Number,
    default: 0
  },
  whiteboard: {
    type: whiteboardSchema,
    default: { elements: [] }
  },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update timestamp on save
collaborationRoomSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

const CollaborationRoom = mongoose.model<ICollaborationRoom>('CollaborationRoom', collaborationRoomSchema);
export default CollaborationRoom; 