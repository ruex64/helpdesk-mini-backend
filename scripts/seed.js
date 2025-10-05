import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import User from '../models/User.js';
import Ticket from '../models/Ticket.js';
import Comment from '../models/Comment.js';
import Timeline from '../models/Timeline.js';

dotenv.config();

const seedData = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/helpdesk');
    console.log('Connected to MongoDB');

    // Clear existing data
    await User.deleteMany({});
    await Ticket.deleteMany({});
    await Comment.deleteMany({});
    await Timeline.deleteMany({});
    console.log('Cleared existing data');

    // Create users
    const hashedPassword = await bcrypt.hash('password123', 12);
    
    const users = await User.create([
      {
        name: 'Admin User',
        email: 'admin@helpdesk.com',
        password: hashedPassword,
        role: 'admin'
      },
      {
        name: 'Agent Smith',
        email: 'agent@helpdesk.com',
        password: hashedPassword,
        role: 'agent'
      },
      {
        name: 'Agent Johnson',
        email: 'agent2@helpdesk.com',
        password: hashedPassword,
        role: 'agent'
      },
      {
        name: 'John Doe',
        email: 'user@helpdesk.com',
        password: hashedPassword,
        role: 'user'
      },
      {
        name: 'Jane Smith',
        email: 'user2@helpdesk.com',
        password: hashedPassword,
        role: 'user'
      }
    ]);

    console.log('Created users');

    const [admin, agent1, agent2, user1, user2] = users;

    // Create tickets
    const tickets = await Ticket.create([
      {
        title: 'Login Issues',
        description: 'Cannot login to my account, getting invalid credentials error',
        priority: 'high',
        category: 'technical',
        status: 'open',
        createdBy: user1._id,
        assignedTo: agent1._id
      },
      {
        title: 'Billing Question',
        description: 'Need clarification on my latest invoice',
        priority: 'medium',
        category: 'billing',
        status: 'in_progress',
        createdBy: user2._id,
        assignedTo: agent2._id
      },
      {
        title: 'Feature Request - Dark Mode',
        description: 'Please add dark mode support to the application',
        priority: 'low',
        category: 'feature_request',
        status: 'open',
        createdBy: user1._id
      },
      {
        title: 'System Down',
        description: 'Unable to access the system, getting 500 errors',
        priority: 'urgent',
        category: 'technical',
        status: 'resolved',
        createdBy: user2._id,
        assignedTo: agent1._id,
        resolvedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) // 2 hours ago
      },
      {
        title: 'Password Reset',
        description: 'Need help resetting my password',
        priority: 'medium',
        category: 'technical',
        status: 'closed',
        createdBy: user1._id,
        assignedTo: agent2._id,
        resolvedAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
        closedAt: new Date(Date.now() - 23 * 60 * 60 * 1000) // 23 hours ago
      }
    ]);

    console.log('Created tickets');

    // Create comments
    const comments = [];
    
    // Comments for first ticket (Login Issues)
    comments.push(
      {
        ticket: tickets[0]._id,
        author: agent1._id,
        content: 'I can see your account is active. Can you try clearing your browser cache and cookies?',
        type: 'comment',
        isFirstResponse: true,
        createdAt: new Date(tickets[0].createdAt.getTime() + 30 * 60 * 1000) // 30 min after ticket
      },
      {
        ticket: tickets[0]._id,
        author: user1._id,
        content: 'I tried clearing cache but still having the same issue.',
        type: 'comment',
        createdAt: new Date(tickets[0].createdAt.getTime() + 2 * 60 * 60 * 1000) // 2 hours after ticket
      },
      {
        ticket: tickets[0]._id,
        author: agent1._id,
        content: 'I\'ll reset your password and send you a new one via email.',
        type: 'comment',
        createdAt: new Date(tickets[0].createdAt.getTime() + 3 * 60 * 60 * 1000) // 3 hours after ticket
      }
    );

    // Comments for billing ticket
    comments.push(
      {
        ticket: tickets[1]._id,
        author: agent2._id,
        content: 'I can see the invoice you\'re referring to. The charge is for the premium plan upgrade.',
        type: 'comment',
        isFirstResponse: true,
        createdAt: new Date(tickets[1].createdAt.getTime() + 1 * 60 * 60 * 1000) // 1 hour after ticket
      },
      {
        ticket: tickets[1]._id,
        author: agent2._id,
        content: 'Internal note: Customer upgraded to premium on the 15th',
        type: 'internal_note',
        createdAt: new Date(tickets[1].createdAt.getTime() + 1.5 * 60 * 60 * 1000) // 1.5 hours after ticket
      }
    );

    await Comment.create(comments);
    console.log('Created comments');

    // Update first response timestamps
    tickets[0].firstResponseAt = comments[0].createdAt;
    tickets[1].firstResponseAt = comments[3].createdAt;
    await tickets[0].save();
    await tickets[1].save();

    // Create timeline entries
    const timelineEntries = [];

    // Timeline for all tickets
    tickets.forEach((ticket, index) => {
      timelineEntries.push({
        ticket: ticket._id,
        user: ticket.createdBy,
        action: 'created',
        description: `Ticket created by ${users.find(u => u._id.equals(ticket.createdBy)).name}`,
        createdAt: ticket.createdAt
      });

      if (ticket.assignedTo) {
        timelineEntries.push({
          ticket: ticket._id,
          user: admin._id, // Assume admin assigned it
          action: 'assigned',
          description: `Assigned to ${users.find(u => u._id.equals(ticket.assignedTo)).name}`,
          createdAt: new Date(ticket.createdAt.getTime() + 10 * 60 * 1000) // 10 min after creation
        });
      }

      if (ticket.status === 'resolved' || ticket.status === 'closed') {
        timelineEntries.push({
          ticket: ticket._id,
          user: ticket.assignedTo || admin._id,
          action: 'resolved',
          description: `Ticket resolved by ${users.find(u => u._id.equals(ticket.assignedTo || admin._id)).name}`,
          createdAt: ticket.resolvedAt
        });
      }

      if (ticket.status === 'closed') {
        timelineEntries.push({
          ticket: ticket._id,
          user: ticket.assignedTo || admin._id,
          action: 'closed',
          description: `Ticket closed by ${users.find(u => u._id.equals(ticket.assignedTo || admin._id)).name}`,
          createdAt: ticket.closedAt
        });
      }
    });

    // Add comment timeline entries
    comments.forEach(comment => {
      timelineEntries.push({
        ticket: comment.ticket,
        user: comment.author,
        action: 'commented',
        description: `${comment.type === 'internal_note' ? 'Internal note' : 'Comment'} added by ${users.find(u => u._id.equals(comment.author)).name}`,
        createdAt: comment.createdAt
      });
    });

    await Timeline.create(timelineEntries);
    console.log('Created timeline entries');

    console.log('\n=== SEED DATA CREATED SUCCESSFULLY ===');
    console.log('\nTest User Credentials:');
    console.log('Admin: admin@helpdesk.com / password123');
    console.log('Agent: agent@helpdesk.com / password123');
    console.log('Agent 2: agent2@helpdesk.com / password123');
    console.log('User: user@helpdesk.com / password123');
    console.log('User 2: user2@helpdesk.com / password123');
    console.log('\nData Summary:');
    console.log(`- Users: ${users.length}`);
    console.log(`- Tickets: ${tickets.length}`);
    console.log(`- Comments: ${comments.length}`);
    console.log(`- Timeline entries: ${timelineEntries.length}`);

    process.exit(0);
  } catch (error) {
    console.error('Error seeding data:', error);
    process.exit(1);
  }
};

seedData();