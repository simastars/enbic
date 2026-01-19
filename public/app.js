const API_BASE = 'http://localhost:3000/api';

let currentArn = null;
let states = [];

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    initializeTabs();
    loadInitialData();
    setupEventListeners();
    setInterval(loadDashboardStats, 60000); // Refresh stats every minute
    setInterval(generateReminders, 24 * 60 * 60 * 1000); // Generate reminders daily
});

function initializeTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;
            switchTab(tabName);
        });
    });
}

function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });

    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    document.getElementById(tabName).classList.add('active');

    // Load tab-specific data
    if (tabName === 'dashboard') {
        loadDashboard();
    } else if (tabName === 'arns') {
        loadARNs();
    } else if (tabName === 'delivery') {
        loadDeliveryTab();
    } else if (tabName === 'states') {
        loadStatesList();
    }
}

function setupEventListeners() {
    // Add ARN form
    const addArnForm = document.getElementById('addArnForm');
    if (addArnForm) {
        addArnForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const arn = document.getElementById('arnInput').value.trim();
            const state = document.getElementById('stateSelect').value;

            if (!arn || !state) {
                showAlert('Please provide both ARN and State', 'error');
                return;
            }

            try {
                const response = await fetch(`${API_BASE}/arns`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ arn, state })
                });

                const data = await response.json();

                if (response.ok) {
                    showAlert('ARN added successfully', 'success');
                    document.getElementById('arnInput').value = '';
                    document.getElementById('stateSelect').value = '';
                    await Promise.all([loadARNs(), loadDashboardStats(), loadReminders()]);
                } else {
                    showAlert(data.error || 'Failed to add ARN', 'error');
                }
            } catch (error) {
                showAlert('Error connecting to server', 'error');
            }
        });
    }

    // Search and filters
    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.addEventListener('input', loadARNs);
    
    const filterState = document.getElementById('filterState');
    if (filterState) filterState.addEventListener('change', loadARNs);
    
    const filterStatus = document.getElementById('filterStatus');
    if (filterStatus) filterStatus.addEventListener('change', loadARNs);

    // Refresh button
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            loadInitialData();
            showAlert('Data refreshed', 'success');
        });
    }

    // Generate reminders
    const generateRemindersBtn = document.getElementById('generateRemindersBtn');
    if (generateRemindersBtn) {
        generateRemindersBtn.addEventListener('click', async () => {
            try {
                const response = await fetch(`${API_BASE}/reminders/generate`, {
                    method: 'POST'
                });
                const data = await response.json();
                if (response.ok) {
                    showAlert('Reminders generated', 'success');
                    loadDashboard();
                } else {
                    showAlert(data.error || 'Failed to generate reminders', 'error');
                }
            } catch (error) {
                showAlert('Error generating reminders', 'error');
            }
        });
    }

    // Delivery form
    const deliveryForm = document.getElementById('deliveryForm');
    if (deliveryForm) {
        deliveryForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const state = document.getElementById('deliveryStateSelect').value;
            const notes = document.getElementById('deliveryNotes').value;

            if (!state) {
                showAlert('Please select a state', 'error');
                return;
            }

            if (!confirm(`Confirm delivery for ${state}? This will mark all pending ARNs as delivered.`)) {
                return;
            }

            try {
                const response = await fetch(`${API_BASE}/delivery/confirm`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ state, notes })
                });

                const data = await response.json();

                if (response.ok) {
                    showAlert(`Delivery confirmed for ${state}. ${data.count} ARN(s) marked as delivered.`, 'success');
                    document.getElementById('deliveryNotes').value = '';
                    loadDeliveryTab();
                    loadDashboardStats();
                } else {
                    showAlert(data.error || 'Failed to confirm delivery', 'error');
                }
            } catch (error) {
                showAlert('Error connecting to server', 'error');
            }
        });
    }

    // Add State form
    const addStateForm = document.getElementById('addStateForm');
    if (addStateForm) {
        addStateForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const stateName = document.getElementById('stateNameInput').value.trim();

            if (!stateName) {
                showAlert('Please enter a state name', 'error');
                return;
            }

            try {
                const response = await fetch(`${API_BASE}/states`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: stateName })
                });

                const data = await response.json();

                if (response.ok) {
                    showAlert('State added successfully', 'success');
                    document.getElementById('stateNameInput').value = '';
                    loadStates();
                    loadStatesList();
                } else {
                    showAlert(data.error || 'Failed to add state', 'error');
                }
            } catch (error) {
                showAlert('Error connecting to server', 'error');
            }
        });
    }

    // Modal close
    const closeBtn = document.querySelector('.close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            document.getElementById('statusModal').style.display = 'none';
        });
    }

    window.addEventListener('click', (e) => {
        const modal = document.getElementById('statusModal');
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });


    // Confirm status update
    const confirmStatusBtn = document.getElementById('confirmStatusBtn');
    if (confirmStatusBtn) {
        confirmStatusBtn.addEventListener('click', async () => {
            const newStatus = document.getElementById('modalNewStatus').value;
            if (!newStatus) {
                showAlert('Please select a status', 'error');
                return;
            }

            try {
                const response = await fetch(`${API_BASE}/arns/${currentArn}/status`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: newStatus })
                });

                const data = await response.json();

                if (response.ok) {
                    showAlert('Status updated successfully', 'success');
                    document.getElementById('statusModal').style.display = 'none';
                    loadARNs();
                    loadDashboardStats();
                } else {
                    showAlert(data.error || 'Failed to update status', 'error');
                }
            } catch (error) {
                showAlert('Error connecting to server', 'error');
            }
        });
    }
}

async function loadInitialData() {
    await Promise.all([
        loadStates(),
        loadDashboardStats(),
        loadDashboard() // populate reminders and delivery stats on initial load
    ]);
}

async function loadStates() {
    try {
        const response = await fetch(`${API_BASE}/states`);
        if (!response.ok) throw new Error('Failed to load states');
        
        const statesData = await response.json();
        states = statesData.map(s => typeof s === 'string' ? s : s.name).sort();

        // Populate state selects
        const selects = ['stateSelect', 'filterState', 'deliveryStateSelect'];
        selects.forEach(selectId => {
            const select = document.getElementById(selectId);
            if (!select) return;
            
            const currentValue = select.value;
            select.innerHTML = selectId === 'stateSelect' 
                ? '<option value="">Select State</option>'
                : selectId === 'filterState'
                ? '<option value="">All States</option>'
                : '<option value="">Select State</option>';

            states.forEach(state => {
                const option = document.createElement('option');
                option.value = state;
                option.textContent = state;
                select.appendChild(option);
            });

            if (currentValue && states.includes(currentValue)) {
                select.value = currentValue;
            }
        });
    } catch (error) {
        console.error('Error loading states:', error);
    }
}

async function loadDashboardStats() {
    try {
        const response = await fetch(`${API_BASE}/arns`);
        const arns = await response.json();

        const stats = {
            awaiting: arns.filter(a => a.status === 'Awaiting Capture').length,
            submitted: arns.filter(a => a.status === 'Submitted to Personalization').length,
            pending: arns.filter(a => a.status === 'Pending Delivery').length,
            delivered: arns.filter(a => a.status === 'Delivered').length
        };

        document.getElementById('stat-awaiting').textContent = stats.awaiting;
        document.getElementById('stat-submitted').textContent = stats.submitted;
        document.getElementById('stat-pending').textContent = stats.pending;
        document.getElementById('stat-delivered').textContent = stats.delivered;
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

async function loadDashboard() {
    await Promise.all([
        loadReminders(),
        loadDeliveryStats()
    ]);
}

async function loadReminders() {
    try {
        const response = await fetch(`${API_BASE}/reminders`);
        const reminders = await response.json();

        const container = document.getElementById('remindersList');
        if (reminders.length === 0) {
            container.innerHTML = '<p class="info-text">No active reminders</p>';
            return;
        }

        container.innerHTML = reminders.map(reminder => `
            <div class="reminder-item">
                <div class="message">
                    <strong>${reminder.arn}</strong> - ${reminder.message}
                    <div class="meta">State: ${reminder.state} | Status: ${reminder.status}</div>
                </div>
                <div class="actions">
                    <button class="btn btn-success" onclick="resolveReminder(${reminder.id})">Resolve</button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading reminders:', error);
    }
}

async function resolveReminder(id) {
    try {
        const response = await fetch(`${API_BASE}/reminders/${id}/resolve`, {
            method: 'POST'
        });

        if (response.ok) {
                await Promise.all([loadReminders(), loadARNs(), loadDashboardStats()]);
        }
    } catch (error) {
        showAlert('Error resolving reminder', 'error');
    }
}

async function loadDeliveryStats() {
    try {
        const response = await fetch(`${API_BASE}/delivery/stats`);
        const stats = await response.json();

        const container = document.getElementById('deliveryStats');
        if (stats.length === 0) {
            container.innerHTML = '<p class="info-text">No pending deliveries</p>';
            return;
        }

        container.innerHTML = stats.map(stat => `
            <div class="delivery-stat-item">
                <div>
                    <div class="state">${stat.state}</div>
                    <div class="age">Oldest pending: ${stat.oldest_pending_age}</div>
                </div>
                <div class="count">${stat.pending_count}</div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading delivery stats:', error);
    }
}

async function loadARNs() {
    try {
        const search = document.getElementById('searchInput').value;
        const state = document.getElementById('filterState').value;
        const status = document.getElementById('filterStatus').value;

        const params = new URLSearchParams();
        if (search) params.append('search', search);
        if (state) params.append('state', state);
        if (status) params.append('status', status);

        const response = await fetch(`${API_BASE}/arns?${params}`);
        const arns = await response.json();

        const container = document.getElementById('arnsList');
        if (arns.length === 0) {
            container.innerHTML = '<p class="info-text">No ARNs found</p>';
            return;
        }

        container.innerHTML = arns.map(arn => {
            const statusClass = arn.status.toLowerCase().replace(/\s+/g, '-').replace('to', '');
            const statusBadgeClass = arn.status === 'Awaiting Capture' ? 'awaiting' :
                                   arn.status === 'Submitted to Personalization' ? 'submitted' :
                                   arn.status === 'Pending Delivery' ? 'pending' : 'delivered';

            return `
                <div class="arn-item ${statusBadgeClass}">
                    <div class="arn-info">
                        <strong>${arn.arn}</strong>
                        <div class="meta">
                            State: ${arn.state} | 
                            <span class="status-badge ${statusBadgeClass}">${arn.status}</span>
                        </div>
                        <div class="meta">
                            Created: ${formatDate(arn.created_at)}${arn.submitted_at ? ' | Submitted: ' + formatDate(arn.submitted_at) : ''}
                            ${arn.delivered_at ? ' | Delivered: ' + formatDate(arn.delivered_at) : ''}
                        </div>
                    </div>
                    <div>
                        ${arn.status !== 'Delivered' ? `<button class="btn btn-primary" onclick="openStatusModal('${arn.arn}', '${arn.status}')">Update Status</button>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading ARNs:', error);
        showAlert('Error loading ARNs', 'error');
    }
}

function openStatusModal(arn, currentStatus) {
    currentArn = arn;
    document.getElementById('modalArn').textContent = arn;
    document.getElementById('modalCurrentStatus').textContent = currentStatus;

    const select = document.getElementById('modalNewStatus');
    select.innerHTML = '';

    const nextStatuses = {
        'Awaiting Capture': ['Submitted to Personalization'],
        'Submitted to Personalization': ['Pending Delivery'],
        'Pending Delivery': ['Delivered']
    };

    const options = nextStatuses[currentStatus] || [];
    options.forEach(status => {
        const option = document.createElement('option');
        option.value = status;
        option.textContent = status;
        select.appendChild(option);
    });

    document.getElementById('statusModal').style.display = 'block';
}

async function loadDeliveryTab() {
    await Promise.all([
        loadPendingDeliveries(),
        loadDeliveryHistory()
    ]);
}

async function loadPendingDeliveries() {
    try {
        const response = await fetch(`${API_BASE}/arns?status=Pending Delivery`);
        const arns = await response.json();

        const container = document.getElementById('pendingDeliveries');
        if (arns.length === 0) {
            container.innerHTML = '<p class="info-text">No pending deliveries</p>';
            return;
        }

        const byState = {};
        arns.forEach(arn => {
            if (!byState[arn.state]) {
                byState[arn.state] = [];
            }
            byState[arn.state].push(arn);
        });

        container.innerHTML = Object.entries(byState).map(([state, stateArns]) => `
            <div class="pending-delivery-item">
                <h3>${state} (${stateArns.length} ARN${stateArns.length > 1 ? 's' : ''})</h3>
                <div style="margin-top: 10px;">
                    ${stateArns.map(arn => `
                        <div style="padding: 5px 0; border-bottom: 1px solid #eee;">
                            <strong>${arn.arn}</strong> - Pending since ${formatDate(arn.pending_delivery_at)}
                        </div>
                    `).join('')}
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading pending deliveries:', error);
    }
}

async function loadDeliveryHistory() {
    try {
        const response = await fetch(`${API_BASE}/reports/delivery-history`);
        const history = await response.json();

        const container = document.getElementById('deliveryHistory');
        if (history.length === 0) {
            container.innerHTML = '<p class="info-text">No delivery history</p>';
            return;
        }

        container.innerHTML = history.map(item => `
            <div class="history-item">
                <div>
                    <strong>${item.state}</strong>
                    <div class="meta">${formatDate(item.delivery_date)}</div>
                    ${item.operator_notes ? `<div class="meta">${item.operator_notes}</div>` : ''}
                </div>
                <div class="count">${item.arn_count} ARN${item.arn_count > 1 ? 's' : ''}</div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading delivery history:', error);
    }
}

async function viewReport(type) {
    try {
        const response = await fetch(`${API_BASE}/reports/${type}`);
        const data = await response.json();

        const container = document.getElementById('reportContent');
        const title = document.getElementById('reportTitle');

        const titles = {
            'pending-capture': 'Pending Capture (Aging)',
            'submitted': 'Submitted to Personalization',
            'pending-delivery': 'Pending Delivery by State',
            'delivery-history': 'Delivery History',
            'activity-log': 'Activity Log'
        };

        title.textContent = titles[type] || type;

        if (data.length === 0) {
            container.innerHTML = '<p class="info-text">No data available</p>';
        } else {
            const headers = Object.keys(data[0]);
            container.innerHTML = `
                <table class="report-table">
                    <thead>
                        <tr>${headers.map(h => `<th>${h.replace(/_/g, ' ').toUpperCase()}</th>`).join('')}</tr>
                    </thead>
                    <tbody>
                        ${data.map(row => `
                            <tr>${headers.map(h => `<td>${row[h] || ''}</td>`).join('')}</tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }

        document.getElementById('reportView').style.display = 'block';
    } catch (error) {
        showAlert('Error loading report', 'error');
    }
}

function exportReport(type, format) {
    window.open(`${API_BASE}/export/${format}/${type}`, '_blank');
}

function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleString();
}

function showAlert(message, type) {
    const alert = document.createElement('div');
    alert.className = `alert alert-${type}`;
    alert.textContent = message;
    
    const container = document.querySelector('.container');
    container.insertBefore(alert, container.firstChild);

    setTimeout(() => {
        alert.remove();
    }, 5000);
}

async function generateReminders() {
    try {
        await fetch(`${API_BASE}/reminders/generate`, { method: 'POST' });
    } catch (error) {
        console.error('Error generating reminders:', error);
    }
}

async function loadStatesList() {
    try {
        const response = await fetch(`${API_BASE}/states`);
        if (!response.ok) throw new Error('Failed to load states');
        
        const statesData = await response.json();
        const statesList = document.getElementById('statesList');
        
        if (statesData.length === 0) {
            statesList.innerHTML = '<p class="info-text">No states added yet.</p>';
            return;
        }
        
        let html = '<div class="states-table"><table><thead><tr><th>State Name</th><th>Created</th><th>Action</th></tr></thead><tbody>';
        
        statesData.forEach(state => {
            const createdDate = state.created_at ? new Date(state.created_at).toLocaleDateString() : 'N/A';
            html += `
                <tr>
                    <td>${state.name}</td>
                    <td>${createdDate}</td>
                    <td>
                        <button class="btn btn-danger btn-sm" onclick="deleteState(${state.id}, '${state.name}')">Delete</button>
                    </td>
                </tr>
            `;
        });
        
        html += '</tbody></table></div>';
        statesList.innerHTML = html;
    } catch (error) {
        console.error('Error loading states list:', error);
        showAlert('Failed to load states list', 'error');
    }
}

// Reports: view and filtering
let currentReportType = null;
let currentReportPage = 1;

function viewReport(type) {
    currentReportType = type;
    currentReportPage = 1;
    document.getElementById('reportView').style.display = 'block';
    document.getElementById('reportTitle').textContent = `Report: ${type.replace(/-/g, ' ').toUpperCase()}`;
    // populate state filter
    const stateSelect = document.getElementById('reportStateFilter');
    stateSelect.innerHTML = '<option value="">All States</option>';
    states.forEach(s => {
        const opt = document.createElement('option'); opt.value = s; opt.textContent = s; stateSelect.appendChild(opt);
    });

    // wire buttons
    document.getElementById('applyReportFilters').onclick = () => { currentReportPage = 1; loadReport(); };
    document.getElementById('clearReportFilters').onclick = () => {
        document.getElementById('reportSearch').value = '';
        document.getElementById('reportStateFilter').value = '';
        document.getElementById('reportDateFrom').value = '';
        document.getElementById('reportDateTo').value = '';
        document.getElementById('reportPageSize').value = '25';
        currentReportPage = 1;
        loadReport();
    };

    document.getElementById('exportReportExcel').onclick = () => exportReport(currentReportType, 'excel');
    document.getElementById('exportReportPdf').onclick = () => exportReport(currentReportType, 'pdf');

    loadReport();
}

async function loadReport() {
    if (!currentReportType) return;
    const search = document.getElementById('reportSearch').value;
    const state = document.getElementById('reportStateFilter').value;
    const dateFrom = document.getElementById('reportDateFrom').value;
    const dateTo = document.getElementById('reportDateTo').value;
    const pageSize = Number(document.getElementById('reportPageSize').value || 25);

    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (state) params.append('state', state);
    if (dateFrom) params.append('date_from', dateFrom);
    if (dateTo) params.append('date_to', dateTo);
    params.append('page', String(currentReportPage));
    params.append('page_size', String(pageSize));

    try {
        const response = await fetch(`${API_BASE}/reports/${currentReportType}?${params}`);
        const rows = await response.json();

        const container = document.getElementById('reportContent');
        if (!Array.isArray(rows) || rows.length === 0) {
            container.innerHTML = '<p class="info-text">No results</p>';
            return;
        }

        // render table
        let html = '<table class="table"><thead><tr>';
        const keys = Object.keys(rows[0]);
        keys.forEach(k => { html += `<th>${k.replace(/_/g,' ')}</th>`; });
        html += '</tr></thead><tbody>';
        rows.forEach(r => {
            html += '<tr>';
            keys.forEach(k => { html += `<td>${r[k] !== null ? r[k] : ''}</td>`; });
            html += '</tr>';
        });
        html += '</tbody></table>';

        // pagination controls (simple)
        html += `<div style="margin-top:10px;"><button class="btn" id="prevPage">Prev</button> <span>Page ${currentReportPage}</span> <button class="btn" id="nextPage">Next</button></div>`;

        container.innerHTML = html;
        document.getElementById('prevPage').onclick = () => { if (currentReportPage>1) { currentReportPage--; loadReport(); } };
        document.getElementById('nextPage').onclick = () => { currentReportPage++; loadReport(); };

    } catch (error) {
        console.error('Error loading report:', error);
        showAlert('Failed to load report', 'error');
    }
}

async function exportReport(type, format) {
    const search = document.getElementById('reportSearch').value;
    const state = document.getElementById('reportStateFilter').value;
    const dateFrom = document.getElementById('reportDateFrom').value;
    const dateTo = document.getElementById('reportDateTo').value;
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (state) params.append('state', state);
    if (dateFrom) params.append('date_from', dateFrom);
    if (dateTo) params.append('date_to', dateTo);

    const url = `${API_BASE}/export/${format}/${type}?${params}`;
    window.open(url, '_blank');
}

async function deleteState(id, stateName) {
    if (!confirm(`Are you sure you want to delete the state "${stateName}"?`)) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/states/${id}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (response.ok) {
            showAlert(`State "${stateName}" deleted successfully`, 'success');
            loadStatesList();
            loadStates();
        } else {
            showAlert(data.error || 'Failed to delete state', 'error');
        }
    } catch (error) {
        showAlert('Error connecting to server', 'error');
    }
}

// Make functions available globally
window.openStatusModal = openStatusModal;
window.resolveReminder = resolveReminder;
window.viewReport = viewReport;
window.exportReport = exportReport;
