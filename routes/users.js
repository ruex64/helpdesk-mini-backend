import express from 'express';
import User from '../models/User.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

// @route   GET /api/users
// @desc    Get all users (agents/admins only)
// @access  Private (agents/admins)
router.get('/', authorize('agent', 'admin'), async (req, res, next) => {
  try {
    const { role, limit = 50, offset = 0 } = req.query;
    
    let query = { isActive: true };
    
    if (role) {
      query.role = role;
    }

    const total = await User.countDocuments(query);
    
    const users = await User.find(query)
      .select('name email role createdAt lastLoginAt')
      .sort({ createdAt: -1 })
      .skip(parseInt(offset))
      .limit(parseInt(limit));

    const nextOffset = parseInt(offset) + parseInt(limit);

    res.json({
      success: true,
      users,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        next_offset: nextOffset < total ? nextOffset : null
      }
    });
  } catch (error) {
    next(error);
  }
});

// @route   GET /api/users/agents
// @desc    Get all agents for assignment
// @access  Private (agents/admins)
router.get('/agents', authorize('agent', 'admin'), async (req, res, next) => {
  try {
    const agents = await User.find({ 
      role: { $in: ['agent', 'admin'] }, 
      isActive: true 
    }).select('name email role');

    res.json({
      success: true,
      agents
    });
  } catch (error) {
    next(error);
  }
});

// @route   PATCH /api/users/:id/role
// @desc    Update user role (admin only)
// @access  Private (admin)
router.patch('/:id/role', authorize('admin'), async (req, res, next) => {
  try {
    const { role } = req.body;
    
    if (!role || !['user', 'agent', 'admin'].includes(role)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_ROLE',
          field: 'role',
          message: 'Role must be user, agent, or admin'
        }
      });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { role },
      { new: true, runValidators: true }
    ).select('name email role');

    if (!user) {
      return res.status(404).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found'
        }
      });
    }

    res.json({
      success: true,
      user
    });
  } catch (error) {
    next(error);
  }
});

// @route   PATCH /api/users/:id/status
// @desc    Activate/deactivate user (admin only)
// @access  Private (admin)
router.patch('/:id/status', authorize('admin'), async (req, res, next) => {
  try {
    const { isActive } = req.body;
    
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({
        error: {
          code: 'INVALID_STATUS',
          field: 'isActive',
          message: 'isActive must be a boolean'
        }
      });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isActive },
      { new: true, runValidators: true }
    ).select('name email role isActive');

    if (!user) {
      return res.status(404).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found'
        }
      });
    }

    res.json({
      success: true,
      user
    });
  } catch (error) {
    next(error);
  }
});

export default router;