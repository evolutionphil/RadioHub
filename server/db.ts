// MongoDB connection setup
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { logger } from './utils/logger';

dotenv.config();

// Initialize MongoDB connection
const connectDB = async () => {
  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL must be set for MongoDB connection");
    }
    
    await mongoose.connect(process.env.DATABASE_URL);
    logger.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

export { connectDB };
