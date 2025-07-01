"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteFile = exports.getFile = exports.uploadFile = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const uuid_1 = require("uuid");
// Directory for file uploads
const uploadsDir = path_1.default.join(__dirname, '../../uploads');
// Ensure uploads directory exists
if (!fs_1.default.existsSync(uploadsDir)) {
    fs_1.default.mkdirSync(uploadsDir, { recursive: true });
}
/**
 * Uploads a file to the local storage
 *
 * @param file The file to upload
 * @param options Upload options
 * @returns Object with file details
 */
const uploadFile = async (file, options = {}) => {
    try {
        const filename = `${(0, uuid_1.v4)()}-${file.originalname.replace(/\s+/g, '_')}`;
        const filepath = path_1.default.join(uploadsDir, filename);
        // Write file to disk
        fs_1.default.writeFileSync(filepath, file.buffer);
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
    }
    catch (error) {
        console.error('Error uploading file:', error);
        throw new Error('File upload failed');
    }
};
exports.uploadFile = uploadFile;
/**
 * Gets a file from the local storage
 *
 * @param filename The name of the file
 * @returns The file data
 */
const getFile = (filename) => {
    const filepath = path_1.default.join(uploadsDir, filename);
    if (!fs_1.default.existsSync(filepath)) {
        throw new Error('File not found');
    }
    return {
        filepath,
        data: fs_1.default.readFileSync(filepath),
        contentType: path_1.default.extname(filepath).substring(1)
    };
};
exports.getFile = getFile;
/**
 * Deletes a file from the local storage
 *
 * @param filename The name of the file
 * @returns Boolean indicating success
 */
const deleteFile = (filename) => {
    const filepath = path_1.default.join(uploadsDir, filename);
    if (!fs_1.default.existsSync(filepath)) {
        return false;
    }
    fs_1.default.unlinkSync(filepath);
    return true;
};
exports.deleteFile = deleteFile;
