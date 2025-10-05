import mongoose from 'mongoose';

const timelineSchema = new mongoose.Schema({
  ticket: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ticket',
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  action: {
    type: String,
    required: true,
    enum: [
      'created',
      'updated',
      'assigned',
      'unassigned',
      'status_changed',
      'priority_changed',
      'commented',
      'resolved',
      'closed',
      'reopened',
      'sla_breach'
    ]
  },
  details: {
    type: mongoose.Schema.Types.Mixed, // Flexible object for action-specific data
    default: {}
  },
  description: {
    type: String,
    required: true,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes
timelineSchema.index({ ticket: 1, createdAt: -1 });
timelineSchema.index({ user: 1 });
timelineSchema.index({ action: 1 });

export default mongoose.model('Timeline', timelineSchema);