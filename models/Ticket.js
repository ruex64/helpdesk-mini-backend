import mongoose from 'mongoose';

const ticketSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  description: {
    type: String,
    required: [true, 'Description is required'],
    maxlength: [2000, 'Description cannot exceed 2000 characters']
  },
  status: {
    type: String,
    enum: ['open', 'in_progress', 'pending', 'resolved', 'closed'],
    default: 'open'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  category: {
    type: String,
    enum: ['technical', 'billing', 'general', 'feature_request'],
    default: 'general'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  sla: {
    responseTime: {
      type: Number, // in hours
      default: function() {
        const priorityMap = { low: 48, medium: 24, high: 8, urgent: 2 };
        return priorityMap[this.priority] || 24;
      }
    },
    resolutionTime: {
      type: Number, // in hours
      default: function() {
        const priorityMap = { low: 168, medium: 72, high: 24, urgent: 8 };
        return priorityMap[this.priority] || 72;
      }
    },
    responseDeadline: {
      type: Date
    },
    resolutionDeadline: {
      type: Date
    },
    isResponseBreached: {
      type: Boolean,
      default: false
    },
    isResolutionBreached: {
      type: Boolean,
      default: false
    }
  },
  tags: [{
    type: String,
    trim: true
  }],
  // Optimistic locking
  version: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  firstResponseAt: {
    type: Date
  },
  resolvedAt: {
    type: Date
  },
  closedAt: {
    type: Date
  }
});

// Indexes for performance
ticketSchema.index({ createdBy: 1 });
ticketSchema.index({ assignedTo: 1 });
ticketSchema.index({ status: 1 });
ticketSchema.index({ priority: 1 });
ticketSchema.index({ createdAt: -1 });
ticketSchema.index({ 'sla.responseDeadline': 1 });
ticketSchema.index({ 'sla.resolutionDeadline': 1 });

// Text index for search
ticketSchema.index({
  title: 'text',
  description: 'text',
  tags: 'text'
});

// Calculate SLA deadlines before saving
ticketSchema.pre('save', function(next) {
  if (this.isNew) {
    const now = new Date();
    this.sla.responseDeadline = new Date(now.getTime() + (this.sla.responseTime * 60 * 60 * 1000));
    this.sla.resolutionDeadline = new Date(now.getTime() + (this.sla.resolutionTime * 60 * 60 * 1000));
  }
  
  // Update updatedAt
  if (this.isModified() && !this.isNew) {
    this.updatedAt = Date.now();
    this.version += 1;
  }
  
  // Update status-specific timestamps
  if (this.isModified('status')) {
    if (this.status === 'resolved' && !this.resolvedAt) {
      this.resolvedAt = new Date();
    }
    if (this.status === 'closed' && !this.closedAt) {
      this.closedAt = new Date();
    }
  }
  
  next();
});

// Check for SLA breaches
ticketSchema.methods.checkSLABreaches = function() {
  const now = new Date();
  
  if (!this.firstResponseAt && now > this.sla.responseDeadline) {
    this.sla.isResponseBreached = true;
  }
  
  if (!this.resolvedAt && now > this.sla.resolutionDeadline) {
    this.sla.isResolutionBreached = true;
  }
};

// Virtual for time remaining
ticketSchema.virtual('timeToResponse').get(function() {
  if (this.firstResponseAt) return null;
  return Math.max(0, this.sla.responseDeadline.getTime() - Date.now());
});

ticketSchema.virtual('timeToResolution').get(function() {
  if (this.resolvedAt) return null;
  return Math.max(0, this.sla.resolutionDeadline.getTime() - Date.now());
});

// Include virtuals in JSON
ticketSchema.set('toJSON', { virtuals: true });

export default mongoose.model('Ticket', ticketSchema);