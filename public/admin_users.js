async function fetchUsers() {
  const res = await fetch('/api/admin/users', { credentials: 'same-origin' });
  if (!res.ok) {
    alert('Failed to fetch users: ' + res.statusText);
    return [];
  }
  return res.json();
}

function render(users) {
  const tbody = document.querySelector('#usersTable tbody');
  tbody.innerHTML = '';
  users.forEach(u => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${u.id}</td>
      <td>${u.username}</td>
      <td class="full_name">${escapeHtml(u.full_name || '')}</td>
      <td>${u.role}</td>
      <td><button data-id="${u.id}" class="editBtn">Edit</button></td>
    `;
    tbody.appendChild(tr);
  });
  document.querySelectorAll('.editBtn').forEach(btn => btn.addEventListener('click', onEdit));
}

function escapeHtml(str) {
  return (str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function onEdit(e) {
  const id = e.currentTarget.getAttribute('data-id');
  const row = e.currentTarget.closest('tr');
  const current = row.querySelector('.full_name').textContent || '';
  const newName = prompt('Enter full name for user ID ' + id, current);
  if (newName === null) return;
  const res = await fetch('/api/admin/users/' + id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ full_name: newName })
  });
  if (!res.ok) {
    const err = await res.json().catch(()=>({error:res.statusText}));
    alert('Update failed: ' + (err.error || res.statusText));
    return;
  }
  const data = await res.json();
  row.querySelector('.full_name').textContent = data.user.full_name || '';
  alert('Updated');
}

window.initAdminUsers = async function initAdminUsers() {
  const users = await fetchUsers();
  render(users);
};