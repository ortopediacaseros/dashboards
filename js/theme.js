// Inyecta el botón toggle 🌙/☀️ y maneja el cambio de tema.
// El script anti-flash va inline en el <head> de cada HTML.

function isDark() {
  return document.documentElement.classList.contains('dark');
}

function applyTheme(dark) {
  document.documentElement.classList.toggle('dark', dark);
  localStorage.setItem('theme', dark ? 'dark' : 'light');
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = dark ? '☀️' : '🌙';
}

function injectToggle() {
  const btn = document.createElement('button');
  btn.id = 'theme-toggle';
  btn.className = 'theme-toggle-btn';
  btn.title = 'Cambiar tema';
  btn.textContent = isDark() ? '☀️' : '🌙';
  btn.addEventListener('click', () => applyTheme(!isDark()));
  document.body.appendChild(btn);
}

injectToggle();
