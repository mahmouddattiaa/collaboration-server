"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importStar(require("mongoose"));
const participantSchema = new mongoose_1.Schema({
    userId: {
        type: mongoose_1.Schema.Types.ObjectId,
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
const messageSchema = new mongoose_1.Schema({
    userId: {
        type: mongoose_1.Schema.Types.ObjectId,
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
const taskSchema = new mongoose_1.Schema({
    title: {
        type: String,
        required: true
    },
    description: String,
    assigneeId: {
        type: mongoose_1.Schema.Types.ObjectId,
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
const roomFileSchema = new mongoose_1.Schema({
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
        type: mongoose_1.Schema.Types.ObjectId,
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
const whiteboardSchema = new mongoose_1.Schema({
    elements: {
        type: [],
        default: []
    }
});
const collaborationRoomSchema = new mongoose_1.Schema({
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
        type: mongoose_1.Schema.Types.ObjectId,
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
collaborationRoomSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});
const CollaborationRoom = mongoose_1.default.model('CollaborationRoom', collaborationRoomSchema);
exports.default = CollaborationRoom;
