const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        default: null
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    },
    isPrivate: {
        default: true
    },
    accessCode: {
        type: String,
        sparse: true
    },
    /*settings: {
        allowChat: {
            default: true
        },
        allowScreenShare: {
            type: Boolean,
            default: true
        },
        allowFileSharing: {
            type: Boolean,
            default: true
        },
        recordingSetting: {
            type: String,
            enum: ['disabled', 'host-only', 'all-participants'],
            default: 'host-only'
        }
    },*/
    activeParticipants: [{
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        joinedAt: {
            type: Date,
            default: Date.now
        },
        role: {
            type: String,
            enum: ['host', 'participant', 'moderator'],
            default: 'participant'
        }
    }],
    members: [{
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        role: {
            type: String,
            enum: ['host', 'participant', 'moderator'],
            required: true
        },
        addedAt: {
            type: Date,
            default: Date.now
        },
        addedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        }
    }],
    features: {
        whiteboard: {
            type: Boolean,
            default: true
        },
        codeEditor: {
            type: Boolean,
            default: true
        },
        fileSharing: {
            type: Boolean,
            default: true
        },
        videoConference: {
            type: Boolean,
            default: true
        }
    }
});

// Indexes for better query performance
roomSchema.index({ name: 1 });
roomSchema.index({ createdBy: 1 });
roomSchema.index({ isPrivate: 1 });
roomSchema.index({ accessCode: 1 }, { sparse: true });
roomSchema.index({ 'members.userId': 1 });

// Update the updatedAt timestamp on save
roomSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

module.exports = mongoose.model('Room', roomSchema);