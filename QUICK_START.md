# Quick Start Guide - Store Officer Request Form System

## What Was Implemented

You now have a complete digital request form system where:

1. **Store Officers** can submit blank card requests
2. **Admins** can approve/reject requests
3. Both can **digitally sign** the forms
4. Forms can be **downloaded as PDFs** with all details and signatures
5. The **signed forms remain permanently accessible** to both parties

## How to Use

### AS A STORE OFFICER:

#### Step 1: Create a Request
1. Go to **Inventory** tab
2. Scroll to **"Requests (Store Officer)"** section
3. Fill in:
   - **Quantity**: Number of blank cards needed
   - **Needed By**: Date you need them (optional)
   - **Reason**: Why you need the cards
4. Click **"Create Request"**
5. Status shows as "PENDING" - waiting for admin decision

#### Step 2: Wait for Admin Approval
- The admin will review and approve/reject your request
- You'll see the status update (might need to refresh)
- Status changes to "APPROVED" if accepted

#### Step 3: Sign the Form
1. Your request now shows a **"Sign Form"** button
2. Click **"Sign Form"**
3. A modal appears with a drawing canvas
4. **Draw your signature** in the white area (use your mouse)
5. Click **"Sign & Save"** to submit
6. Status changes to "OFFICER_SIGNED" (blue badge)

#### Step 4: Download the Form
1. After signing, a **"Download"** button appears
2. Click **"Download"** to get the PDF
3. Opens in new tab/browser
4. Can print and file if needed

#### Step 5: Admin Countersigns (Admin does this)
- The admin will see your signature
- Admin will countersign the form
- Status updates to "FULLY_SIGNED" (purple badge)

#### Step 6: Access Signed Form Anytime
- Click **"View Form"** to see the complete form
- Shows all signatures with dates and times
- Shows approval information
- Remains accessible for record-keeping

---

### AS AN ADMIN/OPERATOR:

#### Step 1: Review Pending Requests
1. Go to **Inventory** tab
2. Look at **"Requests (Store Officer)"** section
3. See list of "All Blank Card Requests" grouped by officer
4. Status badges show current state

#### Step 2: Decide on Request
1. For "PENDING" requests, a **"Decide"** button appears
2. Click **"Decide"**
3. Choose:
   - **✓ Approve (Full)** - Approve all requested quantity
   - **⚠ Partial Approval** - Approve smaller quantity (enter number)
   - **✗ Reject** - Deny the request
4. Add optional **Decision Note** (e.g., "In stock, shipping next week")
5. Click **"Approve"**
6. Status updates to "APPROVED"

#### Step 3: Wait for Officer's Signature
- Officer will see the approved form
- Officer draws signature on canvas
- Status updates to "OFFICER_SIGNED" (blue badge)
- You'll see a checkmark: "✓ Officer Signed: [date/time]"

#### Step 4: Countersign the Form
1. A **"Countersign"** button appears (only after officer signs)
2. Click **"Countersign"**
3. Canvas modal opens
4. **Draw your countersignature** on the canvas
5. Click **"Countersign & Save"**
6. Status updates to "FULLY_SIGNED" (purple badge)
7. Both signatures now permanently recorded

#### Step 5: Download Completed Form
1. Click **"Download"** button
2. PDF opens with:
   - All request details
   - Approval information
   - Both signatures with timestamps
   - Professional formatting
   - Suitable for printing/archiving

#### Step 6: Access Anytime
- Click **"View Form"** to see modal with all details
- Both signatures visible with dates/times
- Permanent accessible record
- Audit trail maintained

---

## Key Features

### Visual Status Indicators
```
🟡 PENDING          - Awaiting your (admin) decision
🟢 APPROVED         - You approved it, officer will sign
🔵 OFFICER_SIGNED   - Officer signed, you need to countersign
🟣 FULLY_SIGNED     - Complete! Both signed
🔴 REJECTED         - Request was denied
```

### Security
- Only officers see their own requests (admins see all)
- Only officer can sign their forms
- Only admin can countersign
- Signatures stored as tampering-proof images
- All actions logged with timestamps
- Role-based access control enforced

### Workflow
```
Officer Creates → Admin Approves → Officer Signs → Admin Countersigns → PDF Ready
   PENDING          APPROVED        OFFICER_SIGNED    FULLY_SIGNED
```

---

## Common Workflows

### Workflow 1: Approval and Signing
```
Officer: Creates request for 500 cards
  ↓
Admin: Reviews → Approves 500
  ↓
Officer: Signs form (draws signature)
  ↓
Admin: Countersigns form (draws signature)
  ↓
Both: Download PDF with all info + signatures
```

### Workflow 2: Partial Approval
```
Officer: Requests 1000 cards
  ↓
Admin: Reviews → Approves PARTIAL (800 available)
  ↓
Officer: Signs form (for 800 cards)
  ↓
Admin: Countersigns form
  ↓
Both: Download PDF showing 800 approved
```

### Workflow 3: Rejection
```
Officer: Creates request
  ↓
Admin: Reviews → Rejects (no budget, duplicate request, etc)
  ↓
Request stays visible with status: REJECTED
Officer can create new request
```

---

## Troubleshooting

### Issue: "Sign Form" button not appearing
- **Cause**: Request not approved yet
- **Solution**: Ask admin to approve the request first
- You can only sign after approval

### Issue: Can't draw signature smoothly
- **Cause**: Drawing too fast or browser lag
- **Solution**: 
  - Draw slower
  - Try different browser
  - Check internet connection
  - Click "Clear" to try again

### Issue: Signature submission failing
- **Cause**: Empty canvas (didn't draw anything)
- **Solution**: Draw something on the canvas before saving

### Issue: Can't see countersign button as admin
- **Cause**: Officer hasn't signed yet
- **Solution**: Wait for officer to sign their name first
- You can monitor in the form details

### Issue: PDF download not working
- **Cause**: Pop-up blocked, browser issue, or no internet
- **Solution**:
  - Allow pop-ups for your site
  - Try different browser
  - Check if you have permission to access that request
  - Reload page and try again

---

## Data Being Stored

For each request, the system stores:
- Request ID
- Officer name who created it
- Quantity requested
- Date needed by
- Reason for request
- Approval decision (approve/partial/reject)
- Approved quantity
- Decision notes
- **Officer's signature (as PNG image)**
- Officer's signature timestamp
- **Admin's signature (as PNG image)**
- Admin's signature timestamp
- Current status
- All dates and times

All this information is:
- ✓ Searchable
- ✓ Filterable
- ✓ Downloadable as PDF
- ✓ Permanently stored
- ✓ Audit-logged
- ✓ Role-protected

---

## Files Modified

- `server.js` - Backend API and PDF generation
- `public/app.js` - Frontend UI and interactions
- Database automatically updated with new columns

---

## Support

For technical issues:
1. Check browser console for errors (F12)
2. Verify you're logged in and have correct role
3. Ensure server.js is running (should see API endpoints working)
4. Check that you have permission for the requested action
5. Try refreshing the page

---

## Key Points to Remember

✓ Keep signature clean and unique
✓ Request forms are permanent records once signed
✓ Both parties retain access to all signed forms
✓ PDFs can be downloaded for archiving
✓ All actions are logged for compliance
✓ Empty signatures are rejected (must draw something)
✓ Officer must sign before admin countersigns
✓ Admin cannot edit requests once created (can only approve/reject)
✓ Officers cannot see other officers' requests (admins can see all)

---

## Next Steps

1. Test with a new request
2. Go through complete workflow (create → approve → sign → countersign)
3. Download PDF to verify format
4. Archive signed PDFs
5. Use download feature for compliance/audit records
