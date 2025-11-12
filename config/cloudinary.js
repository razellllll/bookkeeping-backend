const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configure Cloudinary Storage for Multer
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    // Create a folder structure: viron-bookkeeping/client-{id}/form-{name}/year-{year}/quarter-{quarter}
    const { client_id, form_name, quarter, year } = req.body;

    // Sanitize folder path
    const sanitizedFormName = form_name ? form_name.replace(/[^a-zA-Z0-9-_]/g, '_') : 'general';
    const folderPath = `viron-bookkeeping/client-${client_id}/${sanitizedFormName}/${year}/Q${quarter}`;

    // Determine resource type based on file mimetype
    let resourceType = 'auto';
    if (file.mimetype.startsWith('image/')) {
      resourceType = 'image';
    } else if (file.mimetype.startsWith('video/')) {
      resourceType = 'video';
    } else {
      resourceType = 'raw'; // For PDFs, documents, etc.
    }

    return {
      folder: folderPath,
      resource_type: resourceType,
      allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt'],
      public_id: `${Date.now()}-${file.originalname.replace(/\.[^/.]+$/, '')}`, // Remove extension, Cloudinary adds it
      use_filename: true,
      unique_filename: true,
      overwrite: false,
    };
  },
});

// Configure Multer with Cloudinary Storage
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept common document and image formats
    const allowedMimes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'text/plain'
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPG, PNG, GIF, PDF, DOC, DOCX, XLS, XLSX, CSV, and TXT files are allowed.'));
    }
  }
});

module.exports = {
  cloudinary,
  upload
};
