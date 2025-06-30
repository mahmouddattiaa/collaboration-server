import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Directory for file uploads
const uploadsDir = path.join(__dirname, '../../uploads');

// Ensure uploads directory exists
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

interface FileData {
  originalname: string;
  buffer: Buffer;
  mimetype: string;
  size: number;
}

interface UploadOptions {
  metadata?: Record<string, any>;
}

/**
 * Uploads a file to the local storage
 * 
 * @param file The file to upload
 * @param options Upload options
 * @returns Object with file details
 */
export const uploadFile = async (file: FileData, options: UploadOptions = {}) => {
  try {
    const filename = `${uuidv4()}-${file.originalname.replace(/\s+/g, '_')}`;
    const filepath = path.join(uploadsDir, filename);
    
    // Write file to disk
    fs.writeFileSync(filepath, file.buffer);
    
    // Generate URL for file access
    const url = `/uploads/${filename}`;
    
    return {
      filename,
      filepath,
      url,
      contentType: file.mimetype,
      size: file.size,
      bucket: 'local-storage'
    };
  } catch (error) {
    console.error('Error uploading file:', error);
    throw new Error('File upload failed');
  }
};

/**
 * Gets a file from the local storage
 * 
 * @param filename The name of the file
 * @returns The file data
 */
export const getFile = (filename: string) => {
  const filepath = path.join(uploadsDir, filename);
  
  if (!fs.existsSync(filepath)) {
    throw new Error('File not found');
  }
  
  return {
    filepath,
    data: fs.readFileSync(filepath),
    contentType: path.extname(filepath).substring(1)
  };
};

/**
 * Deletes a file from the local storage
 * 
 * @param filename The name of the file
 * @returns Boolean indicating success
 */
export const deleteFile = (filename: string) => {
  const filepath = path.join(uploadsDir, filename);
  
  if (!fs.existsSync(filepath)) {
    return false;
  }
  
  fs.unlinkSync(filepath);
  return true;
}; 