# Store Officer Request Form Workflow - Visual Guide

## Request Lifecycle

```
┌─────────────────────────────────────────────────────────────────────┐
│                     STORE OFFICER REQUEST FORM                       │
│                         Workflow Summary                             │
└─────────────────────────────────────────────────────────────────────┘

STEP 1: CREATE REQUEST (Store Officer)
├─ Quantity: 500 blank cards
├─ Needed By: 2026-03-15
├─ Reason: Stock replenishment
└─ Status: PENDING ⏳

        ↓ (Admin Notification)

STEP 2: REVIEW & APPROVE (Admin/Operator)
├─ Decision: ✓ APPROVE
├─ Approved Qty: 500
├─ Decision Note: Stock available, approved for shipment
└─ Status: APPROVED ✓

        ↓ (Officer Notified)

STEP 3: OFFICER SIGNS FORM (Store Officer)
├─ Opens Request Form
├─ Draws Signature on Canvas
├─ Submits Signature
├─ Signature stored with timestamp
└─ Status: OFFICER_SIGNED 📝

        ↓ (Admin Notified)

STEP 4: ADMIN COUNTERSIGNS (Admin/Operator)
├─ Reviews Officer Signature
├─ Draws Countersignature
├─ Submits Signature
├─ Signature stored with timestamp
└─ Status: FULLY_SIGNED ✓✓

        ↓

STEP 5: DOWNLOAD & ARCHIVE
├─ Form remains accessible to both parties
├─ PDF includes all signatures
├─ Can be printed and filed
├─ Audit trail maintained
└─ Status: FULLY_SIGNED (Permanent)
```

## User Interface Actions

### FOR STORE OFFICERS:

```
Inventory Tab → Requests Section
    ↓
[View Form] → Shows request details + signatures in modal
    ↓
    Decision Point:
    ├─ If Status = APPROVED & NOT signed:
    │  └─ [Sign Form] → Opens signature canvas
    │                   ↓
    │                   [Draw Signature]
    │                   ↓
    │                   [Save & Submit]
    │                   ↓
    │                   Status → OFFICER_SIGNED
    │
    ├─ If Status = OFFICER_SIGNED:
    │  └─ [Download] → PDF with all details
    │
    └─ If Status = FULLY_SIGNED:
       └─ [View Form] + [Download] → Access permanent record
```

### FOR ADMIN/OPERATORS:

```
Inventory Tab → Requests Section
    ↓
[View Form] → Shows request details + signatures in modal
    ↓
Decision Point:
├─ If Status = PENDING:
│  └─ [Decide] → Approve/Partial/Reject
│                ↓
│                [Approve] → Status → APPROVED
│
├─ If Status = APPROVED & Officer hasn't signed:
│  ├─ [Countersign] → Disabled (waiting for officer)
│  └─ [Download] → Available
│
├─ If Status = OFFICER_SIGNED:
│  ├─ [Countersign] → Active
│  │                 ↓
│  │                 Opens signature canvas
│  │                 ↓
│  │                 [Draw Signature]
│  │                 ↓
│  │                 [Save & Submit]
│  │                 ↓
│  │                 Status → FULLY_SIGNED
│  └─ [Download] → Available
│
└─ If Status = FULLY_SIGNED:
   └─ [View Form] + [Download] → Access permanent record
```

## Status Badge Colors

```
┌──────────────────┬────────────────┬─────────────────────────────┐
│ Status           │ Color          │ Meaning                     │
├──────────────────┼────────────────┼─────────────────────────────┤
│ PENDING          │ 🟡 Yellow      │ Awaiting admin approval     │
│ APPROVED         │ 🟢 Green       │ Admin approved, ready to    │
│                  │                │ sign                        │
│ REJECTED         │ 🔴 Red         │ Admin rejected              │
│ OFFICER_SIGNED   │ 🔵 Blue        │ Officer signed, awaiting    │
│                  │                │ admin countersign           │
│ FULLY_SIGNED     │ 🟣 Purple      │ Both signed, permanent      │
│                  │                │ record                      │
│ PARTIALLY_       │ ⚪ Gray         │ Admin approved partial qty  │
│ APPROVED         │                │                             │
└──────────────────┴────────────────┴─────────────────────────────┘
```

## Signature Canvas Interface

```
┌─────────────────────────────────────────────────────┐
│  Sign Request Form #123                        ✕    │
├─────────────────────────────────────────────────────┤
│                                                       │
│  Draw your signature in the canvas below:           │
│                                                       │
│  ┌─────────────────────────────────────────────┐   │
│  │                                             │   │
│  │  [Drawing Area - Click to draw]             │   │
│  │  Use mouse to sign naturally                │   │
│  │                                             │   │
│  │  Size: 550x150px                            │   │
│  │  Format: Real-time stroke capture           │   │
│  │                                             │   │
│  └─────────────────────────────────────────────┘   │
│                                                       │
│  [Clear] - Reset drawing                            │
│                                                       │
│  [Cancel]  [Sign & Save]                            │
└─────────────────────────────────────────────────────┘

Signature captured as PNG and converted to base64
for storage in database
```

## PDF Download Content

```
╔═════════════════════════════════════════════════════╗
║           BLANK CARD REQUEST FORM                   ║
║                                                     ║
║           Request ID: 123                           ║
║           Generated: 2026-03-01 14:32:15            ║
╠═════════════════════════════════════════════════════╣
║ REQUEST DETAILS                                     ║
├─────────────────────────────────────────────────────┤
║ Requester:           Officer Name                  ║
║ Quantity Requested:  500                           ║
║ Needed By:           2026-03-15                    ║
║ Reason:              Stock replenishment            ║
║ Date Created:        2026-03-01 10:00:00           ║
╠═════════════════════════════════════════════════════╣
║ APPROVAL DETAILS                                    ║
├─────────────────────────────────────────────────────┤
║ Status:              FULLY_SIGNED                   ║
║ Approved By:         Admin Name                    ║
║ Approved Quantity:   500                           ║
║ Decision Note:       Stock available, approved     ║
╠═════════════════════════════════════════════════════╣
║ SIGNATURES                                          ║
├─────────────────────────────────────────────────────┤
║ OFFICER SIGNATURE:                                  ║
║ ┌───────────────────────────────────────┐           ║
║ │ [Officer's signature image here]      │           ║
║ └───────────────────────────────────────┘           ║
║ Signed: 2026-03-01 14:00:00                        ║
║                                                     ║
║ ADMIN COUNTERSIGNATURE:                            ║
║ ┌───────────────────────────────────────┐           ║
║ │ [Admin's signature image here]        │           ║
║ └───────────────────────────────────────┘           ║
║ Signed: 2026-03-01 14:32:15                        ║
╚═════════════════════════════════════════════════════╝
```

## Data Flow Diagram

```
┌──────────────────┐
│ Store Officer    │
│ Creates Request  │
└────────┬─────────┘
         │ POST /api/inventory/requests
         ↓
    ┌────────────────┐
    │ blank_card_    │
    │ requests TABLE │ (status: pending)
    └────────┬───────┘
             │
             ├── 📧 Notification to Admin
             │
             ↓
    ┌──────────────────┐
    │ Admin Reviews    │
    │ & Approves       │
    └────────┬─────────┘
             │ POST /api/inventory/requests/:id/decide
             ↓
    ┌─────────────────────────┐
    │ Update Status: APPROVED │
    │ Set approved_qty        │
    │ Set approver_id         │
    └────────┬────────────────┘
             │
             ├── 📧 Notification to Officer
             │
             ↓
    ┌────────────────────────────┐
    │ Officer Opens Form &       │
    │ Signs with Digital Canvas  │
    └────────┬───────────────────┘
             │ POST /api/inventory/requests/:id/sign-officer
             │
             ↓
    ┌─────────────────────────────────────┐
    │ Store officer_signature (base64 PNG)│
    │ Store officer_signed_at (timestamp) │
    │ Update Status: OFFICER_SIGNED       │
    └────────┬────────────────────────────┘
             │
             ├── 📧 Notification to Admin
             │
             ↓
    ┌──────────────────────────┐
    │ Admin Countersigns       │
    │ with Digital Canvas      │
    └────────┬─────────────────┘
             │ POST /api/inventory/requests/:id/sign-admin
             │
             ↓
    ┌──────────────────────────────────────┐
    │ Store admin_signature (base64 PNG)   │
    │ Store admin_signed_at (timestamp)    │
    │ Update Status: FULLY_SIGNED          │
    └────────┬─────────────────────────────┘
             │
             ↓
    ┌────────────────────────────────┐
    │ Form Complete & Immutable      │
    │ Both Parties Can Download PDF  │
    │ Audit Trail Established        │
    └────────────────────────────────┘
```

## Visibility Matrix

```
┌──────────────────┬──────────────┬─────────────┐
│ Action           │ Store Officer│ Admin/Operator│
├──────────────────┼──────────────┼─────────────┤
│ View Own Forms   │ ✓            │ N/A         │
│ View All Forms   │ ✗            │ ✓           │
│ Create Request   │ ✓            │ ✓           │
│ Approve Request  │ ✗            │ ✓           │
│ Sign Form        │ ✓ (own only) │ ✗           │
│ Countersign      │ ✗            │ ✓           │
│ Download PDF     │ ✓ (own only) │ ✓ (all)     │
│ View Signatures  │ ✓            │ ✓           │
└──────────────────┴──────────────┴─────────────┘
```

## Error Handling

```
Edge Cases Handled:
├─ ✓ Officer cannot sign if not approved
├─ ✓ Admin cannot countersign if officer hasn't signed
├─ ✓ Empty signature submission prevented
├─ ✓ Only authorized users can access forms
├─ ✓ Signature data stored as tamper-proof PNG images
├─ ✓ All operations logged in audit table
├─ ✓ Timestamps recorded for compliance
└─ ✓ PDF generation fails gracefully with error message
```

## System Security

```
Authentication:      ✓ Login required
Authorization:       ✓ Role-based access control
Signature Storage:   ✓ Base64 PNG (immutable)
Audit Trail:         ✓ Timestamps on all actions
Data Integrity:      ✓ Database constraints
                     ✓ Audit logging
Session Management:  ✓ Express-session based
PDF Access:          ✓ Authorized users only
```
