import mongoose from 'mongoose';

const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/moneyyy';
    
    const conn = await mongoose.connect(mongoURI);
    
    console.log(`MongoDB connected: ${conn.connection.host}`);
    
    return conn;
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

export default connectDB; 