import express from 'express';
import Ticket from '../models/Ticket.js';
import Comment from '../models/Comment.js';
import Timeline from '../models/Timeline.js';
import User from '../models/User.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

// Helper function to create timeline entry
const createTimelineEntry = async (ticketId, userId, action, description, details = {}) => {
  await Timeline.create({
    ticket: ticketId,
    user: userId,
    action,
    description,
    details
  });
};

// @route   POST /api/tickets
// @desc    Create a new ticket
// @access  Private
router.post('/', async (req, res, next) => {
  try {
    const { title, description, priority, category } = req.body;

    // Validation
    if (!title) {
      return res.status(400).json({
        error: {
          code: 'FIELD_REQUIRED',
          field: 'title',
          message: 'Title is required'
        }
      });
    }

    if (!description) {
      return res.status(400).json({
        error: {
          code: 'FIELD_REQUIRED',
          field: 'description',
          message: 'Description is required'
        }
      });
    }

    const ticket = await Ticket.create({
      title,
      description,
      priority: priority || 'medium',
      category: category || 'general',
      createdBy: req.user._id
    });

    // Create timeline entry
    await createTimelineEntry(
      ticket._id,
      req.user._id,
      'created',
      `Ticket created by ${req.user.name}`
    );

    // Populate the response
    await ticket.populate('createdBy', 'name email role');

    res.status(201).json({
      success: true,
      ticket
    });
  } catch (error) {
    next(error);
  }
});

// @route   GET /api/tickets
// @desc    Get tickets with filtering, searching, and pagination
// @access  Private
router.get('/', async (req, res, next) => {
  try {
    const {
      limit = 20,
      offset = 0,
      status,
      priority,
      assignedTo,
      createdBy,
      search,
      breached,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build query
    let query = {};

    // Role-based filtering
    if (req.user.role === 'user') {
      query.createdBy = req.user._id;
    }

    // Status filter
    if (status) {
      query.status = status;
    }

    // Priority filter
    if (priority) {
      query.priority = priority;
    }

    // Assignment filter
    if (assignedTo) {
      query.assignedTo = assignedTo;
    }

    // Created by filter (for agents/admins)
    if (createdBy && req.user.role !== 'user') {
      query.createdBy = createdBy;
    }

    // SLA Breached filter (for agents/admins)
    if (breached === 'true' && req.user.role !== 'user') {
      query.$or = [
        { 'sla.responseBreached': true },
        { 'sla.resolutionBreached': true }
      ];
    }

    // Search functionality
    if (search) {
      // First try text search
      const textSearchResults = await Ticket.find({
        ...query,
        $text: { $search: search }
      }).select('_id');

      if (textSearchResults.length > 0) {
        query._id = { $in: textSearchResults.map(t => t._id) };
      } else {
        // Fallback to regex search
        query.$or = [
          { title: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } }
        ];
      }
    }

    // Count total for pagination
    const total = await Ticket.countDocuments(query);

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Execute query
    const tickets = await Ticket.find(query)
      .populate('createdBy', 'name email role')
      .populate('assignedTo', 'name email role')
      .sort(sort)
      .skip(parseInt(offset))
      .limit(parseInt(limit))
      .exec();

    // Check for SLA breaches
    tickets.forEach(ticket => {
      ticket.checkSLABreaches();
    });

    const nextOffset = parseInt(offset) + parseInt(limit);
    
    res.json({
      success: true,
      tickets,
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

// @route   GET /api/tickets/agent/test
// @desc    Test endpoint to check tickets assigned to agent
// @access  Private (agents/admins only)
router.get('/agent/test', authorize('agent', 'admin'), async (req, res, next) => {
  try {
    const agentId = req.user._id;
    const tickets = await Ticket.find({ assignedTo: agentId }).select('title status assignedTo');
    const allTickets = await Ticket.find({}).select('title status assignedTo');
    
    res.json({
      success: true,
      agentId: agentId.toString(),
      ticketsAssignedToMe: tickets.length,
      tickets: tickets.map(t => ({
        id: t._id.toString(),
        title: t.title,
        status: t.status,
        assignedTo: t.assignedTo?.toString()
      })),
      totalTicketsInDB: allTickets.length,
      allTickets: allTickets.map(t => ({
        id: t._id.toString(),
        title: t.title,
        status: t.status,
        assignedTo: t.assignedTo?.toString() || 'unassigned'
      }))
    });
  } catch (error) {
    next(error);
  }
});

// @route   GET /api/tickets/agent/dashboard
// @desc    Get agent dashboard statistics
// @access  Private (agents/admins only)
router.get('/agent/dashboard', authorize('agent', 'admin'), async (req, res, next) => {
  try {
    const agentId = req.user._id;
    const now = new Date();

    // Get counts for different categories
    const [
      assignedToMe,
      inProgress,
      breached,
      pendingResponse,
      resolvedToday
    ] = await Promise.all([
      Ticket.countDocuments({ 
        assignedTo: agentId, 
        status: { $nin: ['closed', 'resolved'] } 
      }),
      Ticket.countDocuments({ 
        assignedTo: agentId, 
        status: 'in_progress' 
      }),
      Ticket.countDocuments({ 
        assignedTo: agentId,
        status: { $nin: ['closed', 'resolved'] },
        $or: [
          { 
            firstResponseAt: null,
            'sla.responseDeadline': { $lt: now }
          },
          { 
            resolvedAt: null,
            'sla.resolutionDeadline': { $lt: now }
          }
        ]
      }),
      Ticket.countDocuments({ 
        assignedTo: agentId, 
        status: { $in: ['open', 'pending'] },
        firstResponseAt: null
      }),
      Ticket.countDocuments({
        assignedTo: agentId,
        status: 'resolved',
        resolvedAt: {
          $gte: new Date(new Date().setHours(0, 0, 0, 0))
        }
      })
    ]);

    console.log('Agent Dashboard Stats:', {
      agentId: agentId.toString(),
      assignedToMe,
      inProgress,
      breached,
      pendingResponse,
      resolvedToday
    });

    res.json({
      success: true,
      stats: {
        assignedToMe,
        inProgress,
        breached,
        pendingResponse,
        resolvedToday
      }
    });
  } catch (error) {
    next(error);
  }
});

// @route   GET /api/tickets/:id
// @desc    Get a single ticket with comments and timeline
// @access  Private
router.get('/:id', async (req, res, next) => {
  try {
    const ticket = await Ticket.findById(req.params.id)
      .populate('createdBy', 'name email role')
      .populate('assignedTo', 'name email role');

    if (!ticket) {
      return res.status(404).json({
        error: {
          code: 'TICKET_NOT_FOUND',
          message: 'Ticket not found'
        }
      });
    }

    // Check permissions - users can only see their own tickets
    if (req.user.role === 'user' && !ticket.createdBy._id.equals(req.user._id)) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Access denied'
        }
      });
    }

    // Get comments
    const comments = await Comment.find({ ticket: ticket._id })
      .populate('author', 'name email role')
      .sort({ createdAt: 1 });

    // Get timeline
    const timeline = await Timeline.find({ ticket: ticket._id })
      .populate('user', 'name email role')
      .sort({ createdAt: -1 });

    // Check SLA breaches
    ticket.checkSLABreaches();

    res.json({
      success: true,
      ticket,
      comments,
      timeline
    });
  } catch (error) {
    next(error);
  }
});

// @route   PATCH /api/tickets/:id
// @desc    Update a ticket (with optimistic locking)
// @access  Private (agents/admins or ticket creator for limited fields)
router.patch('/:id', async (req, res, next) => {
  try {
    const { version, ...updates } = req.body;
    
    const ticket = await Ticket.findById(req.params.id);
    
    if (!ticket) {
      return res.status(404).json({
        error: {
          code: 'TICKET_NOT_FOUND',
          message: 'Ticket not found'
        }
      });
    }

    // Optimistic locking check
    if (version !== undefined && ticket.version !== version) {
      return res.status(409).json({
        error: {
          code: 'STALE_UPDATE',
          message: 'Ticket has been modified by another user. Please refresh and try again.'
        }
      });
    }

    // Permission checks
    const isOwner = ticket.createdBy.equals(req.user._id);
    const isAgentOrAdmin = ['agent', 'admin'].includes(req.user.role);

    if (!isOwner && !isAgentOrAdmin) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Access denied'
        }
      });
    }

    // Define allowed fields based on role
    const allowedFields = isAgentOrAdmin 
      ? ['status', 'priority', 'assignedTo', 'title', 'description', 'category', 'tags']
      : ['title', 'description']; // Users can only edit basic fields

    // Filter updates to only allowed fields
    const filteredUpdates = {};
    Object.keys(updates).forEach(key => {
      if (allowedFields.includes(key)) {
        filteredUpdates[key] = updates[key];
      }
    });

    // Track changes for timeline
    const changes = [];
    Object.keys(filteredUpdates).forEach(key => {
      if (ticket[key] !== filteredUpdates[key]) {
        changes.push({
          field: key,
          oldValue: ticket[key],
          newValue: filteredUpdates[key]
        });
      }
    });

    // Update ticket
    Object.assign(ticket, filteredUpdates);
    await ticket.save();

    // Create timeline entries for changes
    for (const change of changes) {
      let description = '';
      switch (change.field) {
        case 'status':
          description = `Status changed from ${change.oldValue} to ${change.newValue}`;
          break;
        case 'priority':
          description = `Priority changed from ${change.oldValue} to ${change.newValue}`;
          break;
        case 'assignedTo':
          const oldUser = change.oldValue ? await User.findById(change.oldValue) : null;
          const newUser = change.newValue ? await User.findById(change.newValue) : null;
          description = `Assignment changed from ${oldUser?.name || 'unassigned'} to ${newUser?.name || 'unassigned'}`;
          break;
        default:
          description = `${change.field.charAt(0).toUpperCase() + change.field.slice(1)} updated`;
      }

      await createTimelineEntry(
        ticket._id,
        req.user._id,
        'updated',
        description,
        { field: change.field, oldValue: change.oldValue, newValue: change.newValue }
      );
    }

    // Populate response
    await ticket.populate('createdBy', 'name email role');
    await ticket.populate('assignedTo', 'name email role');

    res.json({
      success: true,
      ticket
    });
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/tickets/:id/comments
// @desc    Add a comment to a ticket
// @access  Private
router.post('/:id/comments', async (req, res, next) => {
  try {
    const { content, type = 'comment' } = req.body;

    if (!content) {
      return res.status(400).json({
        error: {
          code: 'FIELD_REQUIRED',
          field: 'content',
          message: 'Comment content is required'
        }
      });
    }

    const ticket = await Ticket.findById(req.params.id);
    
    if (!ticket) {
      return res.status(404).json({
        error: {
          code: 'TICKET_NOT_FOUND',
          message: 'Ticket not found'
        }
      });
    }

    // Check permissions
    const isOwner = ticket.createdBy.equals(req.user._id);
    const isAgentOrAdmin = ['agent', 'admin'].includes(req.user.role);

    if (!isOwner && !isAgentOrAdmin) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Access denied'
        }
      });
    }

    // Users cannot create internal notes
    if (type === 'internal_note' && req.user.role === 'user') {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Users cannot create internal notes'
        }
      });
    }

    // Check if this is the first response
    const existingComments = await Comment.countDocuments({ 
      ticket: ticket._id,
      type: 'comment'
    });
    const isFirstResponse = existingComments === 0 && type === 'comment';

    const comment = await Comment.create({
      ticket: ticket._id,
      author: req.user._id,
      content,
      type,
      isFirstResponse
    });

    // Update ticket's first response timestamp
    if (isFirstResponse) {
      ticket.firstResponseAt = new Date();
      await ticket.save();
    }

    // Create timeline entry
    await createTimelineEntry(
      ticket._id,
      req.user._id,
      'commented',
      `${type === 'internal_note' ? 'Internal note' : 'Comment'} added by ${req.user.name}`
    );

    // Populate response
    await comment.populate('author', 'name email role');

    res.status(201).json({
      success: true,
      comment
    });
  } catch (error) {
    next(error);
  }
});

// @route   GET /api/tickets/sla/breached
// @desc    Get tickets with SLA breaches
// @access  Private (agents/admins only)
router.get('/sla/breached', authorize('agent', 'admin'), async (req, res, next) => {
  try {
    const tickets = await Ticket.find({
      $or: [
        { 'sla.isResponseBreached': true },
        { 'sla.isResolutionBreached': true }
      ]
    })
    .populate('createdBy', 'name email role')
    .populate('assignedTo', 'name email role')
    .sort({ 'sla.resolutionDeadline': 1 });

    res.json({
      success: true,
      tickets
    });
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/tickets/:id/assign
// @desc    Assign ticket to agent (agents can self-assign, admins can assign to anyone)
// @access  Private (agents/admins only)
router.post('/:id/assign', authorize('agent', 'admin'), async (req, res, next) => {
  try {
    const { assignedTo } = req.body;
    const ticket = await Ticket.findById(req.params.id);
    
    if (!ticket) {
      return res.status(404).json({
        error: {
          code: 'TICKET_NOT_FOUND',
          message: 'Ticket not found'
        }
      });
    }

    // Agents can only assign to themselves, admins can assign to anyone
    if (req.user.role === 'agent' && assignedTo && assignedTo !== req.user._id.toString()) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Agents can only assign tickets to themselves'
        }
      });
    }

    // Verify assignee is an agent or admin
    if (assignedTo) {
      const assignee = await User.findById(assignedTo);
      if (!assignee || !['agent', 'admin'].includes(assignee.role)) {
        return res.status(400).json({
          error: {
            code: 'INVALID_ASSIGNEE',
            message: 'Can only assign to agents or admins'
          }
        });
      }
    }

    const oldAssignee = ticket.assignedTo;
    ticket.assignedTo = assignedTo || null;
    await ticket.save();

    // Create timeline entry
    const oldUser = oldAssignee ? await User.findById(oldAssignee) : null;
    const newUser = assignedTo ? await User.findById(assignedTo) : null;
    await createTimelineEntry(
      ticket._id,
      req.user._id,
      'assigned',
      `Ticket ${assignedTo ? 'assigned to' : 'unassigned from'} ${newUser?.name || oldUser?.name || 'agent'}`,
      { oldAssignee: oldUser?.name, newAssignee: newUser?.name }
    );

    await ticket.populate('createdBy', 'name email role');
    await ticket.populate('assignedTo', 'name email role');

    res.json({
      success: true,
      ticket
    });
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/tickets/:id/status
// @desc    Change ticket status (agents/admins only)
// @access  Private (agents/admins only)
router.post('/:id/status', authorize('agent', 'admin'), async (req, res, next) => {
  try {
    const { status } = req.body;
    
    const validStatuses = ['open', 'in_progress', 'pending', 'resolved', 'closed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_STATUS',
          field: 'status',
          message: 'Invalid status value'
        }
      });
    }

    const ticket = await Ticket.findById(req.params.id);
    
    if (!ticket) {
      return res.status(404).json({
        error: {
          code: 'TICKET_NOT_FOUND',
          message: 'Ticket not found'
        }
      });
    }

    const oldStatus = ticket.status;
    ticket.status = status;
    await ticket.save();

    // Create timeline entry
    await createTimelineEntry(
      ticket._id,
      req.user._id,
      'status_changed',
      `Status changed from ${oldStatus} to ${status} by ${req.user.name}`,
      { oldStatus, newStatus: status }
    );

    await ticket.populate('createdBy', 'name email role');
    await ticket.populate('assignedTo', 'name email role');

    res.json({
      success: true,
      ticket
    });
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/tickets/:id/priority
// @desc    Change ticket priority (recomputes SLA) (agents/admins only)
// @access  Private (agents/admins only)
router.post('/:id/priority', authorize('agent', 'admin'), async (req, res, next) => {
  try {
    const { priority } = req.body;
    
    const validPriorities = ['low', 'medium', 'high', 'urgent'];
    if (!validPriorities.includes(priority)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_PRIORITY',
          field: 'priority',
          message: 'Invalid priority value'
        }
      });
    }

    const ticket = await Ticket.findById(req.params.id);
    
    if (!ticket) {
      return res.status(404).json({
        error: {
          code: 'TICKET_NOT_FOUND',
          message: 'Ticket not found'
        }
      });
    }

    const oldPriority = ticket.priority;
    ticket.priority = priority;
    // SLA will be recomputed automatically by the pre-save hook
    await ticket.save();

    // Create timeline entry
    await createTimelineEntry(
      ticket._id,
      req.user._id,
      'priority_changed',
      `Priority changed from ${oldPriority} to ${priority} by ${req.user.name} (SLA deadlines recomputed)`,
      { oldPriority, newPriority: priority }
    );

    await ticket.populate('createdBy', 'name email role');
    await ticket.populate('assignedTo', 'name email role');

    res.json({
      success: true,
      ticket
    });
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/tickets/bulk/assign
// @desc    Bulk assign tickets (admins only)
// @access  Private (admin only)
router.post('/bulk/assign', authorize('admin'), async (req, res, next) => {
  try {
    const { ticketIds, assignedTo } = req.body;

    if (!Array.isArray(ticketIds) || ticketIds.length === 0) {
      return res.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: 'ticketIds must be a non-empty array'
        }
      });
    }

    // Verify assignee exists and is agent/admin
    if (assignedTo) {
      const assignee = await User.findById(assignedTo);
      if (!assignee || !['agent', 'admin'].includes(assignee.role)) {
        return res.status(400).json({
          error: {
            code: 'INVALID_ASSIGNEE',
            message: 'Can only assign to agents or admins'
          }
        });
      }
    }

    // Update tickets
    const result = await Ticket.updateMany(
      { _id: { $in: ticketIds } },
      { assignedTo: assignedTo || null }
    );

    // Create timeline entries
    for (const ticketId of ticketIds) {
      const ticket = await Ticket.findById(ticketId);
      if (ticket) {
        const newUser = assignedTo ? await User.findById(assignedTo) : null;
        await createTimelineEntry(
          ticketId,
          req.user._id,
          'assigned',
          `Ticket ${assignedTo ? 'assigned to' : 'unassigned from'} ${newUser?.name || 'agent'} (bulk operation)`,
          { newAssignee: newUser?.name }
        );
      }
    }

    res.json({
      success: true,
      message: `${result.modifiedCount} tickets updated`,
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    next(error);
  }
});

export default router;