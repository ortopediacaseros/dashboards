// Aplica el tema guardado y conecta el botón #theme-toggle inyectado por common.js
// El script anti-flash va inline en el <head> de cada HTML.

function isDark() {
  return document.documentElement.classList.contains('dark');
}

function applyTheme(dark) {
  document.documentElement.classList.toggle('dark', dark);
  localStorage.setItem('theme', dark ? 'dark' : 'light');
  syncBtn();
}

function syncBtn() {
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = isDark() ? '☀️' : '🌙';
}

// Conectar al botón cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
  syncBtn();
  document.addEventListener('click', e => {
    if (e.target.id === 'theme-toggle' || e.target.closest('#theme-toggle')) {
      applyTheme(!isDark());
    }
  });
});

// Fallback: si no hay topbar (login), inyectar botón flotante
if (!document.querySelector('.sidebar')) {
  const btn = document.createElement('button');
  btn.id = 'theme-toggle';
  btn.className = 'theme-toggle-btn';
  btn.style.cssText = 'position:fixed;top:14px;right:16px;z-index:400';
  btn.textContent = isDark() ? '☀️' : '🌙';
  document.addEventListener('DOMContentLoaded', () => {
    document.body.appendChild(btn);
    syncBtn();
  });
}
