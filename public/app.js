const API_BASE = 'http://localhost:3000/api';

let currentArn = null;
let states = [];

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    initializeSidebar();
    loadInitialData();
    setupEventListeners();
    setInterval(loadDashboardStats, 60000); // Refresh stats every minute
    setInterval(generateReminders, 24 * 60 * 60 * 1000); // Generate reminders daily
});

function initializeSidebar() {
    document.querySelectorAll('.sidebar-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const viewName = btn.dataset.view;
            switchView(viewName);
        });
    });
}

function switchView(viewName) {
    document.querySelectorAll('.sidebar-item').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelectorAll('.view-content').forEach(content => {
        content.classList.remove('active');
    });

    document.querySelector(`[data-view="${viewName}"]`).classList.add('active');
    document.getElementById(viewName).classList.add('active');

    // Load view-specific data
    if (viewName === 'dashboard') {
        loadDashboard();
    } else if (viewName === 'arns') {
        loadARNs();
    } else if (viewName === 'delivery') {
        loadDeliveryTab();
    } else if (viewName === 'states') {
        loadStatesList();
    } else if (viewName === 'inventory') {
        loadInventoryTab();
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

    // Inventory: receive
    const receiveForm = document.getElementById('receiveForm');
    if (receiveForm) {
        receiveForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const qty = Number(document.getElementById('receiveQty').value);
            const reference = document.getElementById('receiveRef').value.trim();
            const notes = document.getElementById('receiveNotes').value.trim();
            if (!qty || qty <= 0) return showAlert('Enter a valid quantity', 'error');
            try {
                const res = await fetch(`${API_BASE}/inventory/receive`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ qty, reference, notes }) });
                const d = await res.json();
                if (!res.ok) return showAlert(d.error || 'Failed to record receipt', 'error');
                showAlert('Receipt recorded', 'success');
                document.getElementById('receiveQty').value = '';
                await Promise.all([loadInventoryBalance(), loadLedger(), loadLowStock()]);
            } catch (e) { showAlert('Error recording receipt', 'error'); }
        });
    }

    // Issue to personalization
    const issuePersoForm = document.getElementById('issuePersoForm');

                        // Receive personalized ARNs into store
                        const receiveArnsBtn = document.getElementById('receiveArnsBtn');
                        if (receiveArnsBtn) {
                            receiveArnsBtn.addEventListener('click', async () => {
                                const text = document.getElementById('receiveArnsInput').value || '';
                                const state = document.getElementById('receiveArnsState').value || '';
                                const arns = text.split(/\s|,|;|\n/).map(s=>s.trim()).filter(Boolean);
                                if (arns.length === 0) return showAlert('Provide at least one ARN', 'error');
                                try {
                                    const res = await fetch(`${API_BASE}/arns/receive`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ arns, state: state || null }) });
                                    const d = await res.json();
                                    if (!res.ok) return showAlert(d.error || 'Failed to register ARNs', 'error');
                                    const result = d.results || [];
                                    const ok = result.filter(r=>r.success).length;
                                    document.getElementById('receiveArnsResult').innerHTML = `<div>${ok} succeeded, ${result.length-ok} failed.</div><pre>${JSON.stringify(result,null,2)}</pre>`;
                                    showAlert('Processed ARNs', 'success');
                                    await Promise.all([loadARNs(), loadInventoryBalance(), loadLowStock()]);
                                } catch (e) { showAlert('Error processing ARNs', 'error'); }
                            });
                        }

                        // Record SHQ pickup
                        const pickupArnsBtn = document.getElementById('pickupArnsBtn');
                        if (pickupArnsBtn) {
                            pickupArnsBtn.addEventListener('click', async () => {
                                const text = document.getElementById('pickupArnsInput').value || '';
                                const arns = text.split(/\s|,|;|\n/).map(s=>s.trim()).filter(Boolean);
                                const collector_name = document.getElementById('collectorName').value.trim();
                                const collector_id = document.getElementById('collectorId').value.trim();
                                const phone = document.getElementById('collectorPhone').value.trim();
                                if (arns.length === 0) return showAlert('Provide at least one ARN', 'error');
                                if (!collector_name && !collector_id && !phone) return showAlert('Provide collector info', 'error');
                                try {
                                    const res = await fetch(`${API_BASE}/arns/pickup`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ arns, collector_name, collector_id, phone }) });
                                    const d = await res.json();
                                    if (!res.ok) return showAlert(d.error || 'Failed to record pickup', 'error');
                                    const result = d.results || [];
                                    const ok = result.filter(r=>r.success).length;
                                    document.getElementById('pickupArnsResult').innerHTML = `<div>${ok} succeeded, ${result.length-ok} failed.</div><pre>${JSON.stringify(result,null,2)}</pre>`;
                                    showAlert('Recorded pickups', 'success');
                                    await Promise.all([loadARNs(), loadDeliveryStats(), loadDashboardStats()]);
                                } catch (e) { showAlert('Error recording pickup', 'error'); }
                            });
                        }
    if (issuePersoForm) {
        issuePersoForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const qty = Number(document.getElementById('issueQty').value);
            const issued_to = document.getElementById('issueTo').value.trim();
            const reference = document.getElementById('issueRef').value.trim();
            if (!qty || qty <= 0) return showAlert('Enter a valid quantity', 'error');
            try {
                const res = await fetch(`${API_BASE}/inventory/issue-to-perso`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ qty, issued_to, reference }) });
                const d = await res.json();
                if (!res.ok) return showAlert(d.error || 'Failed to issue', 'error');
                showAlert('Issued to personalization', 'success');
                document.getElementById('issueQty').value = '';
                await Promise.all([loadInventoryBalance(), loadLedger(), loadLowStock()]);
            } catch (e) { showAlert('Error issuing', 'error'); }
        });
    }

    // Create request
    const requestForm = document.getElementById('requestForm');
    if (requestForm) {
        requestForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const quantity = Number(document.getElementById('requestQty').value);
            const needed_by = document.getElementById('requestNeededBy').value || null;
            const reason = document.getElementById('requestReason').value.trim();
            if (!quantity || quantity <= 0) return showAlert('Enter a valid quantity', 'error');
            try {
                const res = await fetch(`${API_BASE}/inventory/requests`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ quantity, reason, needed_by }) });
                const d = await res.json();
                if (!res.ok) return showAlert(d.error || 'Failed to create request', 'error');
                showAlert('Request created successfully', 'success');
                document.getElementById('requestQty').value = '';
                document.getElementById('requestNeededBy').value = '';
                document.getElementById('requestReason').value = '';
                await loadRequests();
            } catch (e) { showAlert('Error creating request', 'error'); }
        });
    }

    // Restock central inventory (Admin only)
    const restockForm = document.getElementById('restockForm');
    if (restockForm) {
        restockForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const qty = Number(document.getElementById('restockQty').value);
            const reference = document.getElementById('restockRef').value.trim();
            const notes = document.getElementById('restockNotes').value.trim();
            if (!qty || qty <= 0) return showAlert('Enter a valid quantity', 'error');
            try {
                const res = await fetch(`${API_BASE}/inventory/receive`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ qty, reference, notes }) });
                const d = await res.json();
                if (!res.ok) return showAlert(d.error || 'Failed to add stock', 'error');
                showAlert('Central inventory updated successfully', 'success');
                document.getElementById('restockQty').value = '';
                document.getElementById('restockRef').value = '';
                document.getElementById('restockNotes').value = '';
                await Promise.all([loadInventoryBalance(), loadLedger()]);
            } catch (e) { showAlert('Error updating inventory', 'error'); }
        });
    }

    const refreshLedger = document.getElementById('refreshLedger');
    if (refreshLedger) refreshLedger.addEventListener('click', loadLedger);
    const refreshRecon = document.getElementById('refreshRecon');
    if (refreshRecon) refreshRecon.addEventListener('click', loadReconciliation);
}

async function loadInitialData() {
    await fetchCurrentUser();
    if (!currentUser) {
        // Do not load further data until user logs in
        return;
    }
    await Promise.all([
        loadStates(),
        loadDashboardStats(),
        loadDashboard() // populate reminders and delivery stats on initial load
    ]);
}

// Auth / UI helpers
let currentUser = null;
async function fetchCurrentUser() {
    try {
        const res = await fetch(`${API_BASE}/auth/me`);
        if (!res.ok) { currentUser = null; updateAuthUI(); return; }
        const data = await res.json();
        currentUser = data.user;
        updateAuthUI();
    } catch (e) { console.warn('failed to fetch current user', e); currentUser = null; updateAuthUI(); }
}

function updateAuthUI() {
    const userDisplay = document.getElementById('userDisplay');
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const generateBtn = document.getElementById('generateRemindersBtn');

    // Role-based tab visibility
    const allowedTabs = {
        admin: ['dashboard','arns','delivery','states','reports','inventory'],
        operator: ['dashboard','arns','delivery','reports'],
        officer: ['dashboard','delivery','inventory'],
        supervisor: ['dashboard','reports']
    };

    const sidebarItems = Array.from(document.querySelectorAll('.sidebar-item'));
    const viewContents = Array.from(document.querySelectorAll('.view-content'));

    if (currentUser) {
        userDisplay.textContent = `${currentUser.username} (${currentUser.role})`;
        loginBtn.style.display = 'none';
        logoutBtn.style.display = 'inline-block';
        // Only operators/admins/supervisors can trigger manual reminders
        if (generateBtn) generateBtn.disabled = !(currentUser.role === 'operator' || currentUser.role === 'admin' || currentUser.role === 'supervisor');
        // show/hide sidebar items based on role
        const allowed = allowedTabs[currentUser.role] || [];
        sidebarItems.forEach(btn => {
            const name = btn.dataset.view;
            btn.style.display = allowed.includes(name) ? '' : 'none';
        });
        // ensure an active sidebar item is visible; if current active item hidden, switch to first allowed
        const activeBtn = document.querySelector('.sidebar-item.active');
        if (!activeBtn || activeBtn.style.display === 'none') {
            const first = document.querySelector('.sidebar-item[style*="display: "]') || document.querySelector('.sidebar-item');
            if (first && first.dataset && first.dataset.view) switchView(first.dataset.view);
        }
        
        // Show admin restock section only for admins
        const adminRestockSection = document.getElementById('adminRestockSection');
        if (adminRestockSection) {
            adminRestockSection.style.display = (currentUser.role === 'admin' || currentUser.role === 'operator') ? 'block' : 'none';
        }
    } else {
        userDisplay.textContent = '';
        loginBtn.style.display = 'inline-block';
        logoutBtn.style.display = 'none';
        if (generateBtn) generateBtn.disabled = true;
        // hide all sidebar items until login
        document.querySelectorAll('.sidebar-item').forEach(btn => btn.style.display = 'none');
        // hide all view contents
        viewContents.forEach(c => c.classList.remove('active'));
        // show login modal
        const loginModal = document.getElementById('loginModal');
        if (loginModal) loginModal.style.display = 'block';
        
        // Hide admin sections
        const adminRestockSection = document.getElementById('adminRestockSection');
        if (adminRestockSection) {
            adminRestockSection.style.display = 'none';
        }
    }
}

// Wire login/logout UI
document.addEventListener('DOMContentLoaded', () => {
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const loginModal = document.getElementById('loginModal');
    const loginClose = document.getElementById('loginClose');
    const loginForm = document.getElementById('loginForm');
    const loginError = document.getElementById('loginError');

    if (loginBtn) loginBtn.addEventListener('click', () => { if (loginModal) loginModal.style.display = 'block'; });
    if (loginClose) loginClose.addEventListener('click', () => { if (loginModal) loginModal.style.display = 'none'; });
    if (logoutBtn) logoutBtn.addEventListener('click', async () => {
        try { await fetch(`${API_BASE}/auth/logout`, { method: 'POST' }); currentUser = null; updateAuthUI(); showAlert('Logged out', 'success'); } catch (e) { showAlert('Logout failed', 'error'); }
    });

    if (loginForm) loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        loginError.style.display = 'none';
        const u = document.getElementById('loginUsername').value.trim();
        const p = document.getElementById('loginPassword').value;
        try {
            const res = await fetch(`${API_BASE}/auth/login`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: u, password: p })
            });
            const d = await res.json();
            if (!res.ok) { loginError.textContent = d.error || 'Login failed'; loginError.style.display = 'block'; return; }
            currentUser = d.user; updateAuthUI(); if (loginModal) loginModal.style.display = 'none'; showAlert('Logged in', 'success');
            // reload UI data that may be role dependent
            await Promise.all([loadStates(), loadDashboardStats(), loadDashboard(), loadARNs(), loadDeliveryTab()]);
        } catch (err) { loginError.textContent = 'Login error'; loginError.style.display = 'block'; }
    });

    // close login modal when clicking outside
    window.addEventListener('click', (e) => { if (e.target === document.getElementById('loginModal')) { document.getElementById('loginModal').style.display = 'none'; } });
});

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

    // inventory quick loads
    try { await Promise.all([loadInventoryBalance(), loadLowStock()]); } catch(e){/*ignore*/}
}

// Inventory UI functions
async function loadInventoryTab() {
    try {
        await Promise.all([
            loadInventoryBalance(),
            loadLowStock(),
            loadLedger(),
            loadRequests(),
            loadIssueNotes()
        ]);
    } catch (e) {
        console.error('Error loading inventory tab', e);
    }
}

async function loadInventoryBalance() {
    try {
        const res = await fetch(`${API_BASE}/inventory/balance`);
        if (!res.ok) return;
        const d = await res.json();
        const balanceEl = document.getElementById('inventoryBalanceTotal');
        
        // Check if user is admin (has officer_stocks array)
        if (d.officer_stocks !== undefined) {
            // Admin view - show central stock and all officer stocks
            let html = `<div style="margin-bottom:12px;"><strong>Central Stock (Admin):</strong> <span style="font-size:18px;font-weight:bold;color:#2980b9;">${d.central_stock}</span></div>`;
            
            if (d.officer_stocks && d.officer_stocks.length > 0) {
                html += `<div style="border-top:1px solid #ddd;padding-top:12px;"><strong>Officer Store Stock:</strong><div style="margin-top:8px;">`;
                d.officer_stocks.forEach(officer => {
                    html += `<div style="padding:6px;background:#f5f5f5;margin-bottom:4px;border-radius:4px;display:flex;justify-content:space-between;"><span>${officer.username}</span><strong>${officer.balance}</strong></div>`;
                });
                html += `</div></div>`;
            } else {
                html += `<div style="border-top:1px solid #ddd;padding-top:12px;"><div style="color:#999;font-size:12px;">No officer stock allocated yet</div></div>`;
            }
            
            balanceEl.innerHTML = html;
        } else {
            // Officer view - show only their own balance
            balanceEl.innerHTML = `<div><strong>Your Store Stock:</strong> <span style="font-size:18px;font-weight:bold;color:#27ae60;">${d.total}</span></div>`;
        }
    } catch (e) { console.warn('loadInventoryBalance', e); }
}

async function loadLowStock() {
    try {
        const res = await fetch(`${API_BASE}/inventory/low-stock`);
        if (!res.ok) return;
        const d = await res.json();
        const el = document.getElementById('inventoryLowStock');
        if (d.low) el.textContent = `Low stock! Threshold: ${d.threshold}`; else el.textContent = '';
    } catch (e) { console.warn('loadLowStock', e); }
}

async function loadLedger() {
    try {
        const res = await fetch(`${API_BASE}/inventory/ledger`);
        const rows = await res.json();
        const container = document.getElementById('inventoryLedger');
        if (!rows || rows.length === 0) { container.innerHTML = '<p class="info-text">No movements</p>'; return; }
        container.innerHTML = `<table class="report-table"><thead><tr><th>When</th><th>Type</th><th>Qty</th><th>Ref</th><th>Operator</th><th>Notes</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${formatDate(r.created_at)}</td><td>${r.type}</td><td>${r.qty}</td><td>${r.reference||''}</td><td>${r.operator||''}</td><td>${r.notes||''}</td></tr>`).join('')}</tbody></table>`;
    } catch (e) { console.error('Error loading ledger', e); showAlert('Failed to load ledger', 'error'); }
}

async function loadRequests() {
    try {
        const res = await fetch(`${API_BASE}/inventory/requests`);
        const rows = await res.json();
        const container = document.getElementById('requestsList');
        if (!rows || rows.length === 0) { 
            container.innerHTML = '<p class="info-text">No requests</p>'; 
            return; 
        }
        
        // Determine view based on user role
        const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.role === 'operator');
        const isOfficer = currentUser && currentUser.role === 'officer';
        
        // Officer view - shows their requests with status
        if (isOfficer) {
            container.innerHTML = `<div style="padding:12px;background:#f9f9f9;border-radius:6px;">
                <h4>Your Requests</h4>
                ${rows.map(r => {
                    const statusColor = r.status === 'approved' ? '#28a745' : (r.status === 'rejected' ? '#dc3545' : (r.status === 'pending' ? '#ffc107' : '#17a2b8'));
                    const statusBgColor = r.status === 'approved' ? '#d4edda' : (r.status === 'rejected' ? '#f8d7da' : (r.status === 'pending' ? '#fff3cd' : '#d1ecf1'));
                    return `<div style="padding:10px;margin:8px 0;border:1px solid #ddd;border-radius:4px;background:${statusBgColor};">
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <div>
                                <strong style="font-size:14px;">Request #${r.id}</strong>
                                <span style="margin-left:12px;color:#666;">Qty: <strong>${r.quantity}</strong></span>
                                <span style="margin-left:12px;color:#666;">Needed by: <strong>${r.needed_by || 'N/A'}</strong></span>
                            </div>
                            <div style="text-align:right;">
                                <span style="display:inline-block;padding:4px 10px;background:${statusColor};color:white;border-radius:4px;font-weight:bold;font-size:12px;">${r.status.toUpperCase()}</span>
                            </div>
                        </div>
                        ${r.reason ? `<div style="margin-top:6px;font-size:12px;color:#666;">Reason: ${r.reason}</div>` : ''}
                        ${r.approved_qty ? `<div style="margin-top:6px;font-size:12px;color:#666;">Approved Qty: <strong>${r.approved_qty}</strong></div>` : ''}
                        ${r.decision_note ? `<div style="margin-top:6px;font-size:12px;color:#666;">Decision: ${r.decision_note}</div>` : ''}
                    </div>`;
                }).join('')}
            </div>`;
        }
        // Admin/Operator view - shows all requests with management options
        else if (isAdmin) {
            container.innerHTML = `<div style="padding:12px;">
                <h4>All Blank Card Requests</h4>
                ${rows.map(r => {
                    const statusColor = r.status === 'approved' ? '#28a745' : (r.status === 'rejected' ? '#dc3545' : (r.status === 'pending' ? '#ffc107' : (r.status === 'partially_approved' ? '#17a2b8' : '#999')));
                    const statusBgColor = r.status === 'approved' ? '#d4edda' : (r.status === 'rejected' ? '#f8d7da' : (r.status === 'pending' ? '#fff3cd' : (r.status === 'partially_approved' ? '#d1ecf1' : '#f0f0f0')));
                    return `<div style="padding:10px;margin:8px 0;border:1px solid #ddd;border-radius:4px;background:${statusBgColor};">
                        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                            <div style="flex:1;">
                                <div style="font-weight:bold;">Request #${r.id}</div>
                                <div style="margin-top:4px;font-size:13px;">
                                    <span style="color:#666;">By: <strong>${r.requester || 'N/A'}</strong></span>
                                    <span style="margin-left:12px;color:#666;">Qty: <strong>${r.quantity}</strong></span>
                                    <span style="margin-left:12px;color:#666;">Needed by: <strong>${r.needed_by || 'N/A'}</strong></span>
                                </div>
                                ${r.reason ? `<div style="margin-top:4px;font-size:12px;color:#666;">Reason: ${r.reason}</div>` : ''}
                                ${r.approved_qty ? `<div style="margin-top:4px;font-size:12px;color:#666;">Approved: <strong>${r.approved_qty}</strong></div>` : ''}
                                ${r.decision_note ? `<div style="margin-top:4px;font-size:12px;color:#666;">Note: ${r.decision_note}</div>` : ''}
                            </div>
                            <div style="text-align:right;">
                                <span style="display:inline-block;padding:4px 10px;background:${statusColor};color:white;border-radius:4px;font-weight:bold;font-size:12px;margin-bottom:8px;">${r.status.toUpperCase()}</span>
                                <div style="display:flex;gap:4px;flex-direction:column;">
                                    <button class="btn btn-sm" style="padding:4px 8px;font-size:11px;" onclick="openDecideModal(${r.id}, '${r.status}', ${r.quantity}, '${r.requester || 'N/A'}')" ${r.status === 'pending' ? '' : 'disabled'}>Decide</button>
                                    <button class="btn btn-primary btn-sm" style="padding:4px 8px;font-size:11px;" onclick="generateIssue(${r.id})" ${r.status === 'approved' || r.status === 'partially_approved' ? '' : 'disabled'}>Generate Issue</button>
                                </div>
                            </div>
                        </div>
                    </div>`;
                }).join('')}
            </div>`;
        }
    } catch (e) { console.error('Error loading requests', e); }
}

window.generateIssue = async function(requestId) {
    try {
        const res = await fetch(`${API_BASE}/inventory/requests/${requestId}/generate-issue`, { method: 'POST' });
        const d = await res.json();
        if (!res.ok) return showAlert(d.error || 'Failed to generate issue', 'error');
        showAlert('Issue note created', 'success');
        await loadIssueNotes();
    } catch (e) { console.error(e); showAlert('Failed to generate issue', 'error'); }
}

window.openDecideModal = function(id, status, qty, requester) {
    // Only allow admins/operators to decide
    if (!currentUser || !(currentUser.role === 'admin' || currentUser.role === 'operator')) {
        showAlert('Only admins can make decisions on requests', 'error');
        return;
    }
    
    const modal = document.createElement('div'); modal.className='modal'; modal.style.display='block';
    modal.innerHTML = `<div class="modal-content" style="max-width:520px">
        <h3>Decide Request #${id}</h3>
        <div style="background:#f9f9f9;padding:10px;border-radius:4px;margin-bottom:12px;">
            <div><strong>Requester:</strong> ${requester}</div>
            <div><strong>Quantity Requested:</strong> ${qty}</div>
            <div><strong>Current Status:</strong> <span style="color:#666;">${status}</span></div>
        </div>
        <div style="margin-bottom:12px;">
            <label style="display:block;margin-bottom:6px;font-weight:bold;">Decision</label>
            <select id="_dec_action" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;">
                <option value="approve">✓ Approve (Full)</option>
                <option value="partial">⚠ Partial Approval</option>
                <option value="reject">✗ Reject</option>
            </select>
        </div>
        <div style="margin-bottom:12px;">
            <label style="display:block;margin-bottom:6px;font-weight:bold;">Approved Quantity (for partial)</label>
            <input id="_dec_qty" type="number" value="${qty}" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;">
        </div>
        <div style="margin-bottom:12px;">
            <label style="display:block;margin-bottom:6px;font-weight:bold;">Decision Note</label>
            <input id="_dec_note" type="text" placeholder="e.g., In stock, Insufficient stock, etc." style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;">
        </div>
        <div style="margin-top:14px;text-align:right;display:flex;gap:8px;justify-content:flex-end;">
            <button id="_dec_cancel" class="btn">Cancel</button>
            <button id="_dec_save" class="btn btn-primary">Save Decision</button>
        </div>
    </div>`;
    document.body.appendChild(modal);
    document.getElementById('_dec_cancel').onclick = ()=>modal.remove();
    document.getElementById('_dec_save').onclick = async ()=>{
        const action = document.getElementById('_dec_action').value;
        const approved_qty = Number(document.getElementById('_dec_qty').value)||0;
        const decision_note = document.getElementById('_dec_note').value.trim();
        try {
            const res = await fetch(`${API_BASE}/inventory/requests/${id}/decide`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ action: action==='approve' ? 'approve' : (action==='partial' ? 'partial' : 'reject'), approved_qty, decision_note }) });
            const d = await res.json();
            if (!res.ok) return showAlert(d.error || 'Failed to decide', 'error');
            showAlert('Decision recorded successfully', 'success');
            modal.remove();
            // Refresh requests list and inventory balance
            await Promise.all([loadRequests(), loadInventoryBalance(), loadLedger()]);
        } catch (e) { showAlert('Error recording decision', 'error'); }
    };
}

async function loadIssueNotes() {
    try {
        const res = await fetch(`${API_BASE}/inventory/issue-notes`);
        const rows = await res.json();
        const container = document.getElementById('issueNotesList');
        if (!rows || rows.length===0) { container.innerHTML = '<p class="info-text">No issue notes</p>'; return; }
        container.innerHTML = rows.map(i=>`<div style="padding:8px;border-bottom:1px solid #eee;"><div><strong>Issue #${i.id}</strong> req:${i.request_id} qty:${i.quantity} status:${i.status}</div><div>Issuer: ${i.issuer_name||''} ${i.issuer_signed_at ? ('at '+formatDate(i.issuer_signed_at)) : ''}</div><div>Receiver: ${i.receiver_name||''} ${i.receiver_signed_at ? ('at '+formatDate(i.receiver_signed_at)) : ''}</div><div style="margin-top:6px;display:flex;gap:8px;"><button class="btn" onclick="openIssueSign(${i.id}, 'issuer')" ${i.issuer_name? 'disabled': ''}>Sign as Issuer</button><button class="btn" onclick="openIssueSign(${i.id}, 'receiver')" ${i.receiver_name? 'disabled': ''}>Sign as Receiver</button></div></div>`).join('');
    } catch (e) { console.error('Error loading issue notes', e); }
}

window.openIssueSign = function(issueId, signer) {
    const modal = document.createElement('div'); modal.className='modal'; modal.style.display='block';
    modal.innerHTML = `<div class="modal-content" style="max-width:480px"><h3>Sign Issue #${issueId} as ${signer}</h3><label>Name</label><input id="_is_name" type="text"><label>Upload (optional)</label><input id="_is_file" type="file" accept=".pdf,image/*"><div style="margin-top:10px;text-align:right"><button id="_is_cancel" class="btn">Cancel</button><button id="_is_save" class="btn btn-primary">Save</button></div></div>`;
    document.body.appendChild(modal);
    document.getElementById('_is_cancel').onclick = ()=>modal.remove();
    document.getElementById('_is_save').onclick = async ()=>{
        const name = document.getElementById('_is_name').value.trim();
        const fileInput = document.getElementById('_is_file');
        let fileData = null;
        if (!name) return alert('Enter name');
        if (fileInput.files && fileInput.files[0]) { try { fileData = await fileToBase64(fileInput.files[0]); } catch(e){ console.error(e); } }
        try {
            const res = await fetch(`${API_BASE}/inventory/issue/${issueId}/sign`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ signer, name, fileData }) });
            const d = await res.json(); if (!res.ok) return showAlert(d.error || 'Failed to sign', 'error');
            showAlert('Signature saved', 'success'); modal.remove(); await loadIssueNotes(); await loadInventoryBalance(); await loadLedger();
        } catch (e) { showAlert('Error signing', 'error'); }
    };
}

async function loadReconciliation() {
    try {
        const res = await fetch(`${API_BASE}/inventory/reconciliation`);
        const d = await res.json();
        const el = document.getElementById('reconResult');
        el.innerHTML = `<div>Opening: ${d.opening} | Received: ${d.received} | Issued: ${d.issued} | Damaged: ${d.damaged} | Lost: ${d.lost} | Adjustments: ${d.adjustments} | Expected: <strong>${d.expected}</strong></div>`;
    } catch (e) { console.error('recon', e); }
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
                <div style="margin-top:10px;">
                    <button class="btn btn-primary" onclick="prepareDispatch('${state}', ${stateArns.length})">Generate Delivery Note</button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading pending deliveries:', error);
    }
}

/* Delivery dispatch: server-backed batch management and signature workflow */
async function fetchDispatchBatches() {
    try {
        const res = await fetch(`${API_BASE}/dispatch/batches`, { credentials: 'include' });
        if (!res.ok) return [];
        return await res.json();
    } catch (e) { console.error('Error fetching batches', e); return []; }
}

async function prepareDispatch(state, cardCount) {
    const batchId = `batch-${Date.now()}-${Math.floor(Math.random()*1000)}`;
    try {
        const res = await fetch(`${API_BASE}/dispatch/batches`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ batchId, state, cardCount: cardCount || 0 })
        });
        if (!res.ok) {
            const err = await res.json().catch(()=>({}));
            return showAlert(err.error || 'Failed to create dispatch batch', 'error');
        }
        showAlert('Delivery note prepared (server) for ' + state, 'success');
        await renderDispatchBatches();
    } catch (e) { console.error(e); showAlert('Failed to create batch', 'error'); }
}

async function openDeliveryNoteModal(batchId, signer) {
    // get batch metadata from server
    const batches = await fetchDispatchBatches();
    const batch = batches.find(b => b.batch_id === batchId);
    if (!batch) return;

    // create modal form to collect signer name and optional signed file
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'block';

    const content = document.createElement('div');
    content.className = 'modal-content';
    content.style.maxWidth = '520px';
    content.innerHTML = `
        <h2>${signer === 'operator' ? 'Operator' : 'Store Officer'} Signature</h2>
        <p>Batch: <strong>${batch.state}</strong> — ${batch.card_count} card(s)</p>
        <label style="display:block;margin-top:10px;">Name</label>
        <input id="_sig_name" type="text" style="width:100%;padding:8px;margin-top:6px;border:1px solid #ddd;border-radius:6px;">
        <label style="display:block;margin-top:10px;">Signed Delivery Note (optional PDF/image)</label>
        <input id="_sig_file" type="file" accept=".pdf,image/*" style="width:100%;margin-top:6px;">
        <div style="margin-top:14px;text-align:right;display:flex;gap:8px;justify-content:flex-end;">
            <button id="_sig_cancel" class="btn">Cancel</button>
            <button id="_sig_save" class="btn btn-primary">Save Signature</button>
        </div>
    `;

    modal.appendChild(content);
    document.body.appendChild(modal);

    function close() { modal.remove(); }
    document.getElementById('_sig_cancel').onclick = () => close();

    document.getElementById('_sig_save').onclick = async () => {
        const nameInput = document.getElementById('_sig_name');
        const fileInput = document.getElementById('_sig_file');
        const name = nameInput.value.trim();
        if (!name) { alert('Please enter a name for the signature'); return; }

        let fileData = null;
        if (fileInput.files && fileInput.files[0]) {
            try { fileData = await fileToBase64(fileInput.files[0]); } catch (e) { console.error('Error reading file', e); showAlert('Failed to read uploaded file', 'error'); return; }
        }

        try {
            const res = await fetch(`${API_BASE}/dispatch/${batchId}/sign`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ signer, name, fileData })
            });
            if (!res.ok) {
                const err = await res.json().catch(()=>({}));
                showAlert(err.error || 'Failed to save signature', 'error');
                return;
            }

            // if both signatures present, ask server to generate delivery note
            const updated = await fetchDispatchBatches();
            const updatedBatch = updated.find(b => b.batch_id === batchId);
            if (updatedBatch && updatedBatch.operator_name && updatedBatch.officer_name && !updatedBatch.delivery_note_path) {
                // generate server-side delivery note
                await fetch(`${API_BASE}/dispatch/${batchId}/generate-note`, { method: 'POST' });
            }

            await renderDispatchBatches();
            close();
            showAlert(`${signer} signature captured for ${batch.state}`, 'success');
        } catch (e) { console.error(e); showAlert('Failed to save signature', 'error'); }
    };

    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function renderDispatchBatches() {
    const container = document.getElementById('dispatchBatches');
    if (!container) return;
    const batches = await fetchDispatchBatches();
    if (!batches || batches.length === 0) {
        container.innerHTML = '<p class="info-text">No dispatch batches prepared.</p>';
        return;
    }

    container.innerHTML = batches.map(b => {
        const hasOperator = !!b.operator_name;
        const hasOfficer = !!b.officer_name;
        const signedNoteExists = !!b.delivery_note_path;

        const canOperatorSign = !hasOperator && b.status === 'prepared';
        const canOfficerSign = hasOperator && !hasOfficer && b.status === 'prepared';
        const canConfirmDispatch = b.status === 'ready_for_dispatch';
        const canUploadConfirmation = b.status === 'dispatched';
        const canDownloadNote = signedNoteExists || (hasOperator && hasOfficer);

        const operatorText = hasOperator ? `${b.operator_name} (${b.operator_signed_at ? new Date(b.operator_signed_at).toLocaleString() : ''})` : '<em>pending</em>';
        const officerText = hasOfficer ? `${b.officer_name} (${b.officer_signed_at ? new Date(b.officer_signed_at).toLocaleString() : ''})` : '<em>pending</em>';

        return `
        <div class="pending-delivery-item" style="display:flex;flex-direction:column;gap:8px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <div><strong>${b.state}</strong> — ${b.card_count} card(s)</div>
                <div style="font-size:12px;color:#666">Created: ${new Date(b.created_at).toLocaleString()}</div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                <div>Operator: ${operatorText}</div>
                <div>Store Officer: ${officerText}</div>
            </div>
            <div style="display:flex;gap:8px;">
                <button class="btn btn-secondary" ${canOperatorSign ? '' : 'disabled'} onclick="openDeliveryNoteModal('${b.batch_id}','operator')">Sign as Operator</button>
                <button class="btn btn-secondary" ${canOfficerSign ? '' : 'disabled'} onclick="openDeliveryNoteModal('${b.batch_id}','officer')">Counter-sign (Store Officer)</button>
                <button class="btn btn-primary" ${canConfirmDispatch ? '' : 'disabled'} onclick="confirmDispatch('${b.batch_id}')">Confirm Dispatch</button>
                <button class="btn" onclick="downloadDeliveryNote('${b.batch_id}')" ${canDownloadNote ? '' : 'disabled'}>Download Delivery Note</button>
                <button class="btn btn-success" ${canUploadConfirmation ? '' : 'disabled'} onclick="receiveConfirmation('${b.batch_id}')">Upload Confirmation Note</button>
            </div>
            <div style="font-size:12px;color:#666">Status: ${b.status}</div>
        </div>
        `;
    }).join('');
}

async function downloadDeliveryNote(batchId) {
    try {
        // fetch latest batch record
        const batches = await fetchDispatchBatches();
        const b = batches.find(x => x.batch_id === batchId);
        if (!b) return showAlert('Batch not found', 'error');

        // ensure server has generated/saved a delivery note
        if (!b.delivery_note_path) {
            // attempt to generate server-side; ignore failure and try fetching file anyway
            try {
                await fetch(`${API_BASE}/dispatch/${batchId}/generate-note`, { method: 'POST' });
            } catch (e) { console.warn('generate-note failed', e); }
            // refresh batch record (allow server a short moment to write file)
            await new Promise(r => setTimeout(r, 400));
        }

        // Try fetching the stored file with a few retries
        let attempt = 0;
        let res = null;
        while (attempt < 4) {
            try {
                res = await fetch(`${API_BASE}/dispatch/${batchId}/file/delivery`, { credentials: 'include' });
                if (res && res.ok) break;
            } catch (e) {
                console.warn('fetch file attempt error', attempt, e);
            }
            attempt++;
            await new Promise(r => setTimeout(r, 300 * attempt));
        }

        if (!res || !res.ok) {
            // attempt to surface server-provided path for troubleshooting
            const refreshed = await fetchDispatchBatches();
            const rb = refreshed.find(x => x.batch_id === batchId);
            const serverPath = rb && rb.delivery_note_path ? rb.delivery_note_path : null;
            console.warn('Failed to retrieve delivery note for', batchId, 'serverPath:', serverPath);
            return showAlert(serverPath ? `Delivery note not yet available. Server path: ${serverPath}` : 'Failed to download delivery note', 'error');
        }

        const blob = await res.blob();
        // try to infer extension from response headers or fallback to html
        const contentType = res.headers.get('content-type') || '';
        const ext = contentType.includes('pdf') ? '.pdf' : (contentType.includes('html') ? '.html' : '');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `${batchId}-delivery-note${ext}`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { console.error(e); showAlert('Failed to download delivery note', 'error'); }
}

async function confirmDispatch(batchId) {
    try {
        const res = await fetch(`${API_BASE}/dispatch/${batchId}/confirm`, { method: 'POST' });
        if (!res.ok) { const err = await res.json().catch(()=>({})); return showAlert(err.error || 'Failed to confirm dispatch', 'error'); }
        showAlert('Dispatch confirmed (server) for ' + batchId, 'success');
        await renderDispatchBatches();
    } catch (e) { console.error(e); showAlert('Failed to confirm dispatch', 'error'); }
}

async function receiveConfirmation(batchId) {
    // ask user to upload confirmation file
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.pdf,image/*';
    fileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const data = await fileToBase64(file);
            const res = await fetch(`${API_BASE}/dispatch/${batchId}/confirmation`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fileData: data })
            });
            if (!res.ok) { const err = await res.json().catch(()=>({})); return showAlert(err.error || 'Failed to upload confirmation', 'error'); }
            showAlert(`Confirmation received for ${batchId}. Batch marked Delivered.`, 'success');
            await renderDispatchBatches();
        } catch (e) { console.error(e); showAlert('Failed to upload confirmation', 'error'); }
    };
    fileInput.click();
}

// ensure dispatch batches render when loading delivery tab
const originalLoadDeliveryTab = loadDeliveryTab;
loadDeliveryTab = async function() {
    await originalLoadDeliveryTab();
    renderDispatchBatches();
};

// expose for onclick handlers
window.prepareDispatch = prepareDispatch;
window.openDeliveryNoteModal = openDeliveryNoteModal;
window.renderDispatchBatches = renderDispatchBatches;
window.confirmDispatch = confirmDispatch;
window.receiveConfirmation = receiveConfirmation;

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
        // render table (use report-table so styles apply)
        let html = '<div class="report-table-wrap"><table class="report-table"><thead><tr>';
        const keys = Object.keys(rows[0]);
        keys.forEach(k => { html += `<th>${k.replace(/_/g,' ')}</th>`; });
        html += '</tr></thead><tbody>';
        rows.forEach(r => {
            html += '<tr>';
            keys.forEach(k => { html += `<td>${r[k] !== null ? r[k] : ''}</td>`; });
            html += '</tr>';
        });
        html += '</tbody></table></div>';

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
