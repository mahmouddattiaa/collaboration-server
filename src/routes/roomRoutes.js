const express = require('express');
const router = express.Router();
const Room = require('../models/Room');
const auth = require('../middleware/auth');

// Create a new room
router.post('/', auth, async(req, res) => {
    try {
        const { name, description, isPrivate, settings, features } = req.body;

        const room = new Room({
            name,
            description,
            createdBy: req.user._id,
            isPrivate,
            settings: {...Room.schema.obj.settings, ...settings },
            features: {...Room.schema.obj.features, ...features }
        });

        if (isPrivate) {
            room.accessCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        }

        // Add creator as host
        room.members.push({
            userId: req.user._id,
            role: 'host',
            addedAt: new Date(),
            addedBy: req.user._id
        });

        await room.save();
        res.status(201).json(room);
    } catch (error) {
        res.status(500).json({ message: 'Error creating room', error: error.message });
    }
});

// Get all rooms (with optional filters)
router.get('/', auth, async(req, res) => {
    try {
        const { isPrivate, member, creator, page = 1, limit = 10 } = req.query;
        const query = {};

        if (isPrivate !== undefined) {
            query.isPrivate = isPrivate === 'true';
        }

        if (member) {
            query['members.userId'] = member;
        }

        if (creator) {
            query.createdBy = creator;
        }

        const rooms = await Room.find(query)
            .populate('createdBy', 'username email')
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(Number(limit));

        const total = await Room.countDocuments(query);

        res.json({
            rooms,
            totalPages: Math.ceil(total / limit),
            currentPage: page
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching rooms', error: error.message });
    }
});

// Get a specific room
router.get('/:id', auth, async(req, res) => {
    try {
        const room = await Room.findById(req.params.id)
            .populate('createdBy', 'username email')
            .populate('members.userId', 'username email')
            .populate('activeParticipants.userId', 'username email');

        if (!room) {
            return res.status(404).json({ message: 'Room not found' });
        }

        res.json(room);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching room', error: error.message });
    }
});

// Update a room
router.patch('/:id', auth, async(req, res) => {
    try {
        const room = await Room.findById(req.params.id);

        if (!room) {
            return res.status(404).json({ message: 'Room not found' });
        }

        // Check if user is room host
        const isHost = room.members.some(member =>
            member.userId.toString() === req.user._id.toString() &&
            member.role === 'host'
        );

        if (!isHost) {
            return res.status(403).json({ message: 'Only room host can update room settings' });
        }

        const updates = req.body;
        Object.keys(updates).forEach(key => {
            if (key !== '_id' && key !== 'createdBy') {
                room[key] = updates[key];
            }
        });

        await room.save();
        res.json(room);
    } catch (error) {
        res.status(500).json({ message: 'Error updating room', error: error.message });
    }
});

// Delete a room
router.delete('/:id', auth, async(req, res) => {
    try {
        const room = await Room.findById(req.params.id);

        if (!room) {
            return res.status(404).json({ message: 'Room not found' });
        }

        // Check if user is room host
        const isHost = room.members.some(member =>
            member.userId.toString() === req.user._id.toString() &&
            member.role === 'host'
        );

        if (!isHost) {
            return res.status(403).json({ message: 'Only room host can delete the room' });
        }

        await room.remove();
        res.json({ message: 'Room deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting room', error: error.message });
    }
});

// Join a room
router.post('/:id/join', auth, async(req, res) => {
    try {
        const room = await Room.findById(req.params.id);

        if (!room) {
            return res.status(404).json({ message: 'Room not found' });
        }

        if (room.isPrivate) {
            const { accessCode } = req.body;
            if (!accessCode || accessCode !== room.accessCode) {
                return res.status(403).json({ message: 'Invalid access code' });
            }
        }

        // Check if user is already an active participant
        const isActive = room.activeParticipants.some(
            participant => participant.userId.toString() === req.user._id.toString()
        );

        if (!isActive) {
            room.activeParticipants.push({
                userId: req.user._id,
                role: 'participant'
            });
            await room.save();
        }

        res.json(room);
    } catch (error) {
        res.status(500).json({ message: 'Error joining room', error: error.message });
    }
});

// Leave a room
router.post('/:id/leave', auth, async(req, res) => {
    try {
        const room = await Room.findById(req.params.id);

        if (!room) {
            return res.status(404).json({ message: 'Room not found' });
        }

        room.activeParticipants = room.activeParticipants.filter(
            participant => participant.userId.toString() !== req.user._id.toString()
        );

        await room.save();
        res.json({ message: 'Left room successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error leaving room', error: error.message });
    }
});

module.exports = router;