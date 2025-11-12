# Cloudinary Integration Setup Guide

This document explains the Cloudinary integration for file management in the Viron Bookkeeping Services application.

## Overview

The application now uses **Cloudinary** as the primary cloud storage solution for all document uploads. This replaces the previous local file storage system and provides:

- ✅ Cloud-based storage (no local disk usage)
- ✅ Automatic CDN delivery for fast file access
- ✅ Organized folder structure by client/form/quarter/year
- ✅ Support for multiple file types (PDF, DOC, DOCX, XLS, XLSX, images, etc.)
- ✅ 10MB file size limit per upload
- ✅ Backward compatibility with existing local files

## Configuration

### 1. Environment Variables

Add the following to your [backend/.env](backend/.env) file:

```env
CLOUDINARY_CLOUD_NAME=dbm40opsy
CLOUDINARY_API_KEY=831233852171955
CLOUDINARY_API_SECRET=psCrx2vNutEtxtqm7EK4dCvYqns
```

### 2. Database Migration

Run the migration script to add Cloudinary support to the database:

```bash
cd backend
node migrate-to-cloudinary.js
```

This adds the `cloudinary_public_id` column to the `documents` table.

### 3. Install Dependencies

The required packages are already installed:
- `cloudinary` - Official Cloudinary SDK
- `multer-storage-cloudinary` - Cloudinary storage adapter for Multer

## File Organization

Files uploaded to Cloudinary are organized in the following folder structure:

```
viron-bookkeeping/
└── client-{client_id}/
    └── {form_name}/
        └── {year}/
            └── Q{quarter}/
                └── {timestamp}-{filename}
```

**Example:**
```
viron-bookkeering/client-123/BIR_Form_2316/2025/Q1/1747123456789-tax-document.pdf
```

## API Changes

### Upload Endpoint
**POST** `/api/upload`

Files are now uploaded directly to Cloudinary. The response returns Cloudinary URLs:

```json
{
  "files": [
    {
      "id": 1,
      "fileName": "tax-document.pdf",
      "fileURL": "https://res.cloudinary.com/dbm40opsy/raw/upload/v1234567890/viron-bookkeeping/...",
      "quarter": "Q1",
      "year": 2025
    }
  ]
}
```

### Download Endpoint
**GET** `/api/download/:documentId`

- For Cloudinary files: Redirects to the Cloudinary URL
- For legacy local files: Serves from local filesystem
- Query parameter `?inline=true` for inline viewing

### Delete Endpoint
**DELETE** `/api/documents/:documentId`

- For Cloudinary files: Deletes from Cloudinary using `public_id`
- For legacy local files: Deletes from local filesystem
- Always removes the database record

### Get Documents Endpoints
**GET** `/api/documents/:clientId/:formName`
**GET** `/api/documents/:clientId`
**GET** `/api/documents`

All endpoints now return Cloudinary URLs in the `fileURL` field.

## File Type Support

The following file types are allowed:

| Type | Extensions | MIME Types |
|------|-----------|------------|
| Images | jpg, jpeg, png, gif | image/jpeg, image/png, image/gif |
| Documents | pdf, doc, docx | application/pdf, application/msword, etc. |
| Spreadsheets | xls, xlsx | application/vnd.ms-excel, etc. |
| Text | txt, csv | text/plain, text/csv |

**File Size Limit:** 10MB per file

## Backward Compatibility

The system maintains backward compatibility with existing local files:

1. **Upload:** New files go to Cloudinary
2. **Download:** Checks if URL is Cloudinary or local path
3. **Delete:** Handles both Cloudinary and local files
4. **Migration:** Existing files remain accessible via local paths

## Security

- API credentials are stored in environment variables (not committed to git)
- File access is controlled through document IDs
- Only authenticated users can upload/download files
- File type validation prevents malicious uploads

## Troubleshooting

### Upload Fails
- Check Cloudinary credentials in `.env`
- Verify file size is under 10MB
- Ensure file type is in allowed list

### Download Returns 404
- For new files: Check Cloudinary dashboard
- For old files: Verify local `uploads/` directory exists

### Migration Errors
- Ensure database credentials are correct in `.env`
- Check if MySQL server is running
- Verify database user has ALTER table permissions

## Testing

To test the integration:

1. **Start the backend server:**
   ```bash
   cd backend
   node server.js
   ```

2. **Upload a test file** through the frontend or API

3. **Check Cloudinary dashboard** to verify file appears in the correct folder

4. **Download the file** to verify URL redirection works

5. **Delete the file** to ensure cleanup works properly

## Configuration Files

- [backend/config/cloudinary.js](backend/config/cloudinary.js) - Cloudinary configuration and Multer setup
- [backend/.env](backend/.env) - Environment variables (credentials)
- [backend/.env.example](backend/.env.example) - Template for environment variables
- [backend/migrate-to-cloudinary.js](backend/migrate-to-cloudinary.js) - Database migration script

## Resources

- [Cloudinary Documentation](https://cloudinary.com/documentation)
- [Cloudinary Node.js SDK](https://cloudinary.com/documentation/node_integration)
- [Multer Storage Cloudinary](https://www.npmjs.com/package/multer-storage-cloudinary)
