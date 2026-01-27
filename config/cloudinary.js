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
    // Note: req.body fields may not be parsed yet when this runs
    const client_id = req.body?.client_id || 'unknown';
    const form_name = req.body?.form_name;
    const quarter = req.body?.quarter;
    const year = req.body?.year;

    // Sanitize folder path and handle optional values
    const sanitizedFormName = form_name && form_name !== 'N/A' && form_name !== 'Unspecified Form'
      ? form_name.replace(/[^a-zA-Z0-9-_]/g, '_')
      : 'general';

    // Build folder path dynamically, excluding N/A values
    let folderPath = `viron-bookkeeping/client-${client_id}/${sanitizedFormName}`;

    // Only add year if it's valid
    if (year && year !== 'N/A' && !isNaN(year)) {
      folderPath += `/${year}`;

      // Only add quarter if year is present and quarter is valid
      if (quarter && quarter !== 'N/A' && quarter !== '') {
        folderPath += `/${quarter}`;
      }
    }

    // Determine resource type based on file mimetype
    let resourceType = 'auto';
    let formatOptions = {};

    if (file.mimetype.startsWith('image/')) {
      resourceType = 'image';
      formatOptions.allowed_formats = ['jpg', 'jpeg', 'png', 'gif'];
    } else if (file.mimetype.startsWith('video/')) {
      resourceType = 'video';
    } else {
      resourceType = 'raw'; // For PDFs, documents, etc.
      // Note: Don't use allowed_formats for raw resources - it causes issues
    }

    return {
      folder: folderPath,
      resource_type: resourceType,
      ...formatOptions, // Only add allowed_formats for images
      // Keep the full filename including extension for raw files (PDFs, docs, etc.)
      // Cloudinary only auto-adds extensions for images, not raw resources
      public_id: `${Date.now()}-${file.originalname}`,
      use_filename: false, // We're manually creating the public_id
      unique_filename: false, // Timestamp already makes it unique
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
