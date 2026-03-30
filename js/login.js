import { supabase } from './supabase.js';

const ADMIN_EMAIL = 'admin@ortopediacaseros.com';

// Si ya hay sesión activa, ir directo al dashboard
supabase.auth.getSession().then(({ data: { session } }) => {
  if (session) window.location.replace('index.html');
});

document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();

  const password = document.getElementById('input-password').value;
  const btn = document.getElementById('btn-login');
  const errorEl = document.getElementById('login-error');

  errorEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Verificando...';

  const { error } = await supabase.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password,
  });

  if (error) {
    errorEl.textContent = 'Contraseña incorrecta';
    errorEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Ingresar';
    document.getElementById('input-password').value = '';
    document.getElementById('input-password').focus();
    return;
  }

  window.location.replace('index.html');
});
