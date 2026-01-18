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
    }
}

function setupEventListeners() {
    // Add ARN form
    document.getElementById('addArnForm').addEventListener('submit', async (e) => {
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
                loadARNs();
                loadDashboardStats();
            } else {
                showAlert(data.error || 'Failed to add ARN', 'error');
            }
        } catch (error) {
            showAlert('Error connecting to server', 'error');
        }
    });

    // Search and filters
    document.getElementById('searchInput').addEventListener('input', loadARNs);
    document.getElementById('filterState').addEventListener('change', loadARNs);
    document.getElementById('filterStatus').addEventListener('change', loadARNs);

    // Refresh button
    document.getElementById('refreshBtn').addEventListener('click', () => {
        loadInitialData();
        showAlert('Data refreshed', 'success');
    });

    // Generate reminders
    document.getElementById('generateRemindersBtn').addEventListener('click', async () => {
        try {
            const response = await fetch(`${API_BASE}/reminders/generate`, {
                method: 'POST'
            });
            const data = await response.json();
            if (response.ok) {
                showAlert('Reminders generated', 'success');
                loadDashboard();
            }
        } catch (error) {
            showAlert('Error generating reminders', 'error');
        }
    });

    // Delivery form
    document.getElementById('deliveryForm').addEventListener('submit', async (e) => {
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

    // Modal close
    document.querySelector('.close').addEventListener('click', () => {
        document.getElementById('statusModal').style.display = 'none';
    });

    window.addEventListener('click', (e) => {
        const modal = document.getElementById('statusModal');
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });

    // Confirm status update
    document.getElementById('confirmStatusBtn').addEventListener('click', async () => {
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

async function loadInitialData() {
    await Promise.all([
        loadStates(),
        loadDashboardStats()
    ]);
}

async function loadStates() {
    try {
        const response = await fetch(`${API_BASE}/arns`);
        const arns = await response.json();
        const uniqueStates = [...new Set(arns.map(a => a.state).filter(Boolean))].sort();
        states = uniqueStates;

        // Populate state selects
        const selects = ['stateSelect', 'filterState', 'deliveryStateSelect'];
        selects.forEach(selectId => {
            const select = document.getElementById(selectId);
            const currentValue = select.value;
            select.innerHTML = selectId === 'stateSelect' 
                ? '<option value="">Select State</option>'
                : selectId === 'filterState'
                ? '<option value="">All States</option>'
                : '<option value="">Select State</option>';

            uniqueStates.forEach(state => {
                const option = document.createElement('option');
                option.value = state;
                option.textContent = state;
                select.appendChild(option);
            });

            if (currentValue && uniqueStates.includes(currentValue)) {
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
            loadReminders();
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

// Make functions available globally
window.openStatusModal = openStatusModal;
window.resolveReminder = resolveReminder;
window.viewReport = viewReport;
window.exportReport = exportReport;
