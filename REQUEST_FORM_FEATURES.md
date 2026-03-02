# Store Officer Request Form Features

## Overview
Implemented a comprehensive Store Officer Request Form system with downloadable PDFs, digital signatures, and visibility for both store officers and admins. The system allows officers to request blank cards with proper approval and signature workflows.

## Features Implemented

### 1. Database Schema Updates
**File**: `server.js` (lines 267-283)

Added new columns to the `blank_card_requests` table:
- `officer_signature` (TEXT) - Stores the officer's signature as base64 PNG data
- `officer_signed_at` (DATETIME) - Timestamp when officer signed
- `admin_signature` (TEXT) - Stores the admin/operator's signature as base64 PNG data
- `admin_signed_at` (DATETIME) - Timestamp when admin countersigned
- `form_data` (TEXT) - Reserved for future form metadata storage
- Updated `status` field to include new states: `officer_signed`, `fully_signed`

Migration code automatically adds missing columns to existing databases.

### 2. API Endpoints (Server)

#### GET `/api/inventory/requests/:id/form`
- **Purpose**: Retrieve request form details
- **Authentication**: Login required
- **Permissions**: Officer can only view their own; admins can view all
- **Returns**: Complete request data with signatures if available

#### POST `/api/inventory/requests/:id/sign-officer`
- **Purpose**: Officer signs the request form
- **Authentication**: Officer role required
- **Body**: `{ signature_data: "data:image/png;base64,..." }`
- **Status Update**: Sets status to `officer_signed`
- **Returns**: Success confirmation

#### POST `/api/inventory/requests/:id/sign-admin`
- **Purpose**: Admin/Operator countersigns the form
- **Authentication**: Admin/Operator role required
- **Body**: `{ signature_data: "data:image/png;base64,..." }`
- **Prerequisites**: Officer must have already signed
- **Status Update**: Sets status to `fully_signed`
- **Returns**: Success confirmation

#### GET `/api/inventory/requests/:id/download-form`
- **Purpose**: Download request form as PDF
- **Authentication**: Login required
- **Permissions**: Officer can download own forms; admins can download all
- **Output**: PDF file with:
  - Request details (ID, quantity, reason, needed by)
  - Approval information
  - Digital signatures (if signed)
  - Timestamps
  - Professional formatting

### 3. Frontend Interface Changes

#### Enhanced Request List View (Inventory Tab)

**Officer View:**
- Displays all their requests with status badges
- Status badges show color-coded states:
  - Yellow: Pending approval
  - Green: Approved
  - Red: Rejected
  - Blue: Officer signed
  - Purple: Fully signed
- Buttons:
  - **View Form**: Modal popup showing form details
  - **Sign Form**: Opens signature canvas (only if approved and not yet signed)
  - **Download**: Downloads PDF (only after officer signature)

**Admin/Operator View:**
- Displays all requests from all officers
- Shows signature status indicators
- Buttons:
  - **View Form**: Modal showing complete form data
  - **Decide**: Approve/reject (only for pending)
  - **Countersign**: Opens signature modal (only after officer signs)
  - **Download**: Always available
  - **Generate Issue**: For approved requests

### 4. Form Viewing Modal
**Function**: `window.viewRequestForm(requestId)`

Displays comprehensive form details in a modal including:
- Request ID and current status
- Creation timestamp
- Request details (quantity, needed by, reason)
- Approval information (if approved)
- Digital signatures with images (if signed)
- All signature timestamps

### 5. Signature Canvas Interface
**Functions**:
- `window.initializeSignatureCanvas(canvas)` - Sets up signature drawing
- `window.clearSignatureCanvas()` - Clears the canvas
- `window.submitOfficerSignature(requestId)` - Submits officer signature
- `window.submitAdminSignature(requestId)` - Submits admin signature

**Features**:
- Draw signatures with mouse on HTML5 canvas
- Clear button to restart drawing
- Real-time stroke rendering
- Base64 PNG conversion for storage
- Validation to ensure signature is actually drawn
- Automatic modal close after successful signature

### 6. PDF Download Feature
**Function**: `window.downloadRequestForm(requestId)`

Generates professional PDF with:
- Header with request ID and generation timestamp
- Request details section
- Approval details section
- Signature section with embedded signature images
- Responsive formatting
- Proper page sizing

## Workflow

### Complete Signature Flow

1. **Store Officer Creates Request**
   - Submits quantity, needed date, and reason
   - Request created with status = "pending"
   - Admin notified

2. **Admin Reviews and Approves**
   - Views request details
   - Approves, partially approves, or rejects
   - Sets approved quantity and decision notes
   - Status updated to "approved" or "rejected"

3. **Officer Signs Form (If Approved)**
   - Clicks "Sign Form" button (only visible if approved and not signed)
   - Opens signature canvas modal
   - Draws signature
   - Submits signature
   - Officer signature stored and status = "officer_signed"

4. **Admin Countersigns Form**
   - Clicks "Countersign" button (only visible after officer signs)
   - Opens signature canvas modal with officer signature visible
   - Draws countersignature
   - Submits signature
   - Admin signature stored and status = "fully_signed"

5. **Both Parties Can Download**
   - Form remains viewable and downloadable
   - PDF includes all signatures and details
   - Provides audit trail for record-keeping
   - Both officer and admin have permanent access

## Status States

- `pending` - Initial state, awaiting admin decision
- `approved` - Admin approved full quantity
- `partially_approved` - Admin approved partial quantity
- `rejected` - Admin rejected request
- `officer_signed` - Officer has signed the form
- `fully_signed` - Both officer and admin have signed

## Security Features

- Role-based access control (officers only see their own forms unless admin)
- Signature validation (must actually draw before submitting)
- Immutable record (signatures stored as images with timestamps)
- Audit logging of all signature events
- Session-based authentication required

## User Experience Enhancements

- Clear visual status indicators with color coding
- Real-time form refreshing after actions
- Intuitive modal interfaces
- Responsive design for all screen sizes
- Empty canvas detection to prevent accidental blank submissions
- Professional PDF output suitable for printing and archiving

## Files Modified

1. **server.js**
   - Added database schema updates
   - Added 5 new API endpoints
   - PDF generation logic with PDFKit

2. **public/app.js**
   - Updated `loadRequests()` function with new UI
   - Added 6 new window functions for form operations
   - Added signature canvas initialization

3. **public/index.html** - No changes needed (existing structure supports new features)

## Testing Checklist

- [ ] Create a request as officer
- [ ] Approve request as admin
- [ ] Officer signs the form
- [ ] Admin countersigns the form
- [ ] Download PDF and verify all details
- [ ] Verify both officer and admin can view the form
- [ ] Test rejection workflow
- [ ] Test partial approval workflow
- [ ] Verify status updates in real-time
- [ ] Test signature canvas clearing
- [ ] Test empty signature submission prevention
