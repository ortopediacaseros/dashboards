import { supabase } from './supabase.js';

export async function checkAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.replace('login.html');
    return null;
  }
  addLogoutButton(session);
  return session;
}

export async function logout() {
  await supabase.auth.signOut();
  window.location.replace('login.html');
}

function addLogoutButton(session) {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar || sidebar.querySelector('.btn-logout')) return;

  const spacer = document.createElement('div');
  spacer.style.flex = '1';
  sidebar.appendChild(spacer);

  const userEl = document.createElement('div');
  userEl.style.cssText = 'padding: 8px 20px 4px; font-size: 11px; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
  userEl.textContent = session.user.email;
  sidebar.appendChild(userEl);

  const btn = document.createElement('button');
  btn.className = 'btn-logout';
  btn.textContent = '🚪 Cerrar sesión';
  btn.style.cssText = `
    margin: 0 12px 16px;
    padding: 9px 14px;
    background: var(--red-dim);
    color: var(--red);
    border: 1px solid rgba(255,91,91,0.2);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 13px;
    font-family: 'IBM Plex Sans', sans-serif;
    font-weight: 500;
    width: calc(100% - 24px);
    text-align: left;
  `;
  btn.addEventListener('click', logout);
  sidebar.appendChild(btn);
}
