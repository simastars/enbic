# ENBIC Local Personalization & Delivery Tracking System

A local web application for tracking ENBIC card processing using ARN as the only identifier. This system helps operators reduce human error, prevent duplicate submissions, and manage state-wise delivery with automated reminders and reports.

## Features

- **ARN Management**: Add, track, and manage ARNs with unique validation
- **Strict Status Lifecycle**: Enforces proper status progression (Awaiting Capture → Submitted to Personalization → Pending Delivery → Delivered)
- **Reminder Engine**: Daily reminders for pending actions
- **State-Based Delivery**: Bulk delivery confirmation per state
- **Comprehensive Reporting**: Multiple report types with Excel and PDF export
- **Local Database**: SQLite database with automatic backups
- **Audit Trail**: Complete history of all changes

## System Requirements

- Node.js (v14 or higher)
- npm (comes with Node.js)
- Modern web browser

## Installation

1. Clone or download this repository
2. Navigate to the project directory:
   ```bash
   cd enbic
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

## Running the Application

1. Start the server:
   ```bash
   npm start
   ```

   Or for development with auto-reload:
   ```bash
   npm run dev
   ```

2. Open your web browser and navigate to:
   ```
   http://localhost:3000
   ```

## Usage

### Adding an ARN

1. Go to the "ARN Management" tab
2. Paste the ARN in the input field
3. Select the state from the dropdown
4. Click "Add ARN"

The system will automatically:
- Validate that the ARN is unique
- Set initial status to "Awaiting Capture"
- Record the creation timestamp

### Updating Status

1. Find the ARN in the ARN list
2. Click "Update Status"
3. Select the next valid status from the dropdown
4. Confirm the update

**Note**: The system enforces strict status progression. Invalid status jumps are blocked.

### Confirming Delivery

1. Go to the "Delivery" tab
2. Select the state from the dropdown
3. Optionally add notes
4. Click "Confirm Delivery"

This will mark **all** pending ARNs for that state as delivered in one action.

### Generating Reminders

- Click "Generate Reminders" in the header to create reminders for ARNs awaiting capture
- Reminders are also automatically generated daily
- View active reminders on the Dashboard

### Reports

1. Go to the "Reports" tab
2. Select a report type:
   - **Pending Capture (Aging)**: ARNs awaiting capture
   - **Submitted to Personalization**: ARNs submitted for personalization
   - **Pending Delivery**: ARNs pending delivery by state
   - **Delivery History**: Historical delivery records
   - **Activity Log**: Complete audit trail

3. Click "View" to see the report in the browser
4. Click "Excel" or "PDF" to export

## Data Storage

- **Database**: SQLite database located in `data/enbic.db`
- **Backups**: Automatic backups stored in `backups/` directory (keeps last 30 backups)
- **Backup Frequency**: Every 6 hours

## Status Lifecycle

The system enforces the following status progression:

1. **Awaiting Capture** (Initial state)
   - Can transition to: Submitted to Personalization

2. **Submitted to Personalization**
   - Can transition to: Pending Delivery

3. **Pending Delivery**
   - Can transition to: Delivered

4. **Delivered** (Final state)
   - No further transitions allowed

## API Endpoints

The backend provides RESTful API endpoints:

- `GET /api/arns` - Get all ARNs (with optional filters)
- `GET /api/arns/:arn` - Get specific ARN
- `POST /api/arns` - Add new ARN
- `PUT /api/arns/:arn/status` - Update ARN status
- `POST /api/delivery/confirm` - Confirm delivery for a state
- `GET /api/reminders` - Get active reminders
- `POST /api/reminders/generate` - Generate reminders
- `GET /api/reports/:type` - Get report data
- `GET /api/export/excel/:type` - Export to Excel
- `GET /api/export/pdf/:type` - Export to PDF

## Design Philosophy

- **Human decides**: Operators make all decisions
- **System remembers**: Tracks all data and timestamps
- **System reminds**: Automated reminders for pending actions
- **System enforces**: Prevents invalid status transitions and duplicates
- **System reports**: Comprehensive reporting and export capabilities

## Security & Privacy

- **Local Only**: No internet access required
- **No External APIs**: All processing is local
- **No Personal Data**: Only ARN and state information stored
- **Audit Trail**: Complete history of all changes

## Troubleshooting

### Port Already in Use

If port 3000 is already in use, you can change it in `server.js`:
```javascript
const PORT = 3000; // Change to another port
```

### Database Issues

If you encounter database errors:
1. Stop the server
2. Delete `data/enbic.db` (this will reset all data)
3. Restart the server (database will be recreated)

### Backup Recovery

To restore from a backup:
1. Stop the server
2. Copy a backup file from `backups/` to `data/enbic.db`
3. Restart the server

## License

ISC

## Support

For issues or questions, please refer to the project documentation or contact the development team.
