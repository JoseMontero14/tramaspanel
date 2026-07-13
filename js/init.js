// ─── INIT: arranca el panel cuando el DOM está listo ─────────────────────────
document.addEventListener('DOMContentLoaded', function () {
  // conectar botón login
  const loginBtn = document.getElementById('login-btn');
  if (loginBtn) loginBtn.addEventListener('click', doLogin);

  // Enter en inputs del login
  const loginEmail = document.getElementById('login-email');
  const loginPass  = document.getElementById('login-pass');
  if (loginEmail) loginEmail.addEventListener('keydown', e => { if (e.key === 'Enter') loginPass?.focus(); });
  if (loginPass)  loginPass.addEventListener('keydown',  e => { if (e.key === 'Enter') doLogin(); });

  // logout
  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) logoutBtn.addEventListener('click', () => { if (confirm('¿Cerrar sesión?')) sbLogout(); });

  // botón sincronizar
  const btnSync = document.getElementById('btn-sincronizar');
  if (btnSync) btnSync.addEventListener('click', sincronizarTodo);

  // arrancar panel
  var tryInit = function () {
    if (window.__csjbInit && document.getElementById('notas-list')) {
      window.__csjbInit();
    } else {
      setTimeout(tryInit, 100);
    }
  };
  tryInit();
});
