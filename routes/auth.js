import express from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '7d'
  });
};

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Public
router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;

    // Validation
    if (!name) {
      return res.status(400).json({
        error: {
          code: 'FIELD_REQUIRED',
          field: 'name',
          message: 'Name is required'
        }
      });
    }

    if (!email) {
      return res.status(400).json({
        error: {
          code: 'FIELD_REQUIRED',
          field: 'email',
          message: 'Email is required'
        }
      });
    }

    if (!password) {
      return res.status(400).json({
        error: {
          code: 'FIELD_REQUIRED',
          field: 'password',
          message: 'Password is required'
        }
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        error: {
          code: 'USER_EXISTS',
          field: 'email',
          message: 'User with this email already exists'
        }
      });
    }

    // Create user
    const user = await User.create({
      name,
      email,
      password,
      role: role || 'user' // Default to 'user' role
    });

    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email) {
      return res.status(400).json({
        error: {
          code: 'FIELD_REQUIRED',
          field: 'email',
          message: 'Email is required'
        }
      });
    }

    if (!password) {
      return res.status(400).json({
        error: {
          code: 'FIELD_REQUIRED',
          field: 'password',
          message: 'Password is required'
        }
      });
    }

    // Find user and include password for comparison
    const user = await User.findOne({ email }).select('+password');
    
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password'
        }
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        error: {
          code: 'ACCOUNT_DISABLED',
          message: 'Account is disabled'
        }
      });
    }

    const token = generateToken(user._id);

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    next(error);
  }
});

// @route   GET /api/auth/me
// @desc    Get current user profile
// @access  Private
router.get('/me', authenticate, (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      createdAt: req.user.createdAt,
      lastLoginAt: req.user.lastLoginAt
    }
  });
});

// @route   PUT /api/auth/profile
// @desc    Update user profile
// @access  Private
router.put('/profile', authenticate, async (req, res, next) => {
  try {
    const { name } = req.body;
    
    if (!name) {
      return res.status(400).json({
        error: {
          code: 'FIELD_REQUIRED',
          field: 'name',
          message: 'Name is required'
        }
      });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { name },
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;