// ─── SUPABASE CONFIG ─────────────────────────────────────────────────────────
const SB_URL = 'https://msyqmiijojmtimvyyoft.supabase.co';
const SB_KEY = 'sb_publishable_U9pQbmKoIyIONc4WR9ZcQw_LN8tY8zS';
const SB_TABLE = 'panel_data';

// Estado de sesión global en window para compartir entre supabase.js y app.js
window.sbSession     = null;
window.currentUser   = null;
let jefeTargetUserId = null;

const TRAMADORES = {
  'jtmontero@tramaspanel.com':  { id: 'c7ffabc0-5bde-4149-8a1c-85dcb3e999a1', nombre: 'José' },
  'jrparicoto@tramaspanel.com': { id: 'f8df99d4-8f84-4218-b787-c73ef69eb378', nombre: 'Paricoto' }
};

// ── HELPERS ──────────────────────────────────────────────────────────────────
function sbHeaders(extra = {}) {
  return {
    'apikey': SB_KEY,
    'Authorization': 'Bearer ' + (window.sbSession || SB_KEY),
    'Content-Type': 'application/json',
    ...extra
  };
}

function targetUserId() {
  if (window.currentUser?.rol === 'jefe' && jefeTargetUserId) return jefeTargetUserId;
  return window.currentUser?.id || null;
}

function showSyncStatus(ok) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  el.className = 'sync-dot ' + (ok ? 'sync-ok' : 'sync-err');
  el.title = ok ? 'Sincronizado con Supabase' : 'Sin conexión — reintentando';
}

// ── AUTH ─────────────────────────────────────────────────────────────────────
async function sbLogin(email, password) {
  const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || 'Credenciales incorrectas');
  window.sbSession = data.access_token;
  // cargar perfil
  const profRes = await fetch(`${SB_URL}/rest/v1/user_profiles?id=eq.${data.user.id}&select=*&limit=1`, {
    headers: sbHeaders()
  });
  const profData = await profRes.json();
  if (!profData.length) throw new Error('Usuario sin perfil. Contacta al administrador.');
  window.currentUser = { id: data.user.id, email: data.user.email, ...profData[0] };
  sessionStorage.setItem('sb_session', window.sbSession);
  sessionStorage.setItem('sb_user', JSON.stringify(window.currentUser));
  return window.currentUser;
}

async function sbRestoreSession() {
  const tok = sessionStorage.getItem('sb_session');
  const usr = sessionStorage.getItem('sb_user');
  if (!tok || !usr) return false;
  try {
    const res = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + tok }
    });
    if (!res.ok) { sbLogout(false); return false; }
    window.sbSession = tok;
    window.currentUser = JSON.parse(usr);
    return true;
  } catch (e) { return false; }
}

function sbLogout(reload = true) {
  window.sbSession = null; window.currentUser = null; jefeTargetUserId = null;
  sessionStorage.clear();
  if (reload) location.reload();
}

// ── PANEL DATA ────────────────────────────────────────────────────────────────
async function sbGuardar(key, value) {
  // solo guardar si hay sesión activa de tramador
  const uid = window.currentUser?.id;
  if (!uid || !window.sbSession) return;
  if (window.currentUser?.rol !== 'tramador') return;
  try {
    const res = await fetch(`${SB_URL}/rest/v1/${SB_TABLE}`, {
      method: 'POST',
      headers: sbHeaders({ 'Prefer': 'resolution=merge-duplicates' }),
      body: JSON.stringify({ key, data: value, user_id: uid, updated_at: new Date().toISOString() })
    });
    if (!res.ok) {
      const txt = await res.text();
      showSyncStatus(false);
      mostrarToast('Error al guardar: ' + res.status, 'err');
      console.warn('sbGuardar error:', txt);
    } else {
      showSyncStatus(true);
    }
  } catch (e) {
    showSyncStatus(false);
    mostrarToast('Sin conexión con Supabase', 'err');
  }
}

async function sbCargarTodo(uid) {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/${SB_TABLE}?user_id=eq.${uid}&select=key,data`, {
      headers: sbHeaders()
    });
    if (!res.ok) throw new Error('Error ' + res.status);
    const rows = await res.json();
    showSyncStatus(true);
    // devolver como objeto key->data
    const result = {};
    rows.forEach(r => { result[r.key] = r.data; });
    return result;
  } catch (e) {
    showSyncStatus(false);
    return null;
  }
}

// ── EXCEL ─────────────────────────────────────────────────────────────────────
async function sbGuardarExcel(nombre, base64data) {
  const uid = window.currentUser?.id;
  if (!uid) return;
  const hoy = new Date().toISOString().split('T')[0];
  try {
    // borrar excel anterior del día
    await fetch(`${SB_URL}/rest/v1/excel_archivos?user_id=eq.${uid}&fecha=eq.${hoy}`, {
      method: 'DELETE', headers: sbHeaders()
    });
    // guardar nuevo
    const res = await fetch(`${SB_URL}/rest/v1/excel_archivos`, {
      method: 'POST',
      headers: sbHeaders({ 'Prefer': 'return=minimal' }),
      body: JSON.stringify({ user_id: uid, nombre, archivo: base64data, fecha: hoy })
    });
    if (res.ok) {
      mostrarToast('☁ Excel guardado en Supabase', 'ok');
    } else {
      mostrarToast('Error al guardar Excel: ' + res.status, 'err');
    }
  } catch (e) {
    mostrarToast('Error de conexión: ' + e.message, 'err');
  }
}

async function sbCargarExcel(uid) {
  const hoy = new Date().toISOString().split('T')[0];
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/excel_archivos?user_id=eq.${uid}&fecha=eq.${hoy}&select=nombre,archivo&limit=1`,
      { headers: sbHeaders() }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows && rows.length ? rows[0] : null;
  } catch (e) { return null; }
}

// ── JEFE: cambiar tramador ────────────────────────────────────────────────────
async function jefeCambiarTramador(email, nombre) {
  const t = TRAMADORES[email];
  if (!t) return;
  jefeTargetUserId = t.id;

  // UI: botones activos
  document.querySelectorAll('.jefe-tramador-btn').forEach(b => b.classList.remove('active'));
  const btnId = email === 'jtmontero@tramaspanel.com' ? 'jefe-btn-jose' : 'jefe-btn-paricoto';
  document.getElementById(btnId)?.classList.add('active');

  mostrarToast(`Cargando datos de ${nombre}…`, 'ok');

  // cargar datos de Supabase
  const datos = await sbCargarTodo(t.id);
  if (!datos) { mostrarToast('No se pudieron cargar los datos', 'err'); return; }

  // aplicar al panel
  aplicarDatosSupabase(datos);

  // cargar Excel del día
  const excel = await sbCargarExcel(t.id);
  const badge = document.getElementById('excel-saved-badge');
  const badgeNombre = document.getElementById('excel-saved-nombre');

  if (excel && excel.archivo) {
    if (badge) badge.classList.add('visible');
    if (badgeNombre) badgeNombre.textContent = excel.nombre;
    const bin = atob(excel.archivo);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    procesarArchivo(arr.buffer, excel.nombre);
    mostrarToast(`✓ Datos de ${nombre} cargados`, 'ok');
  } else {
    if (badge) badge.classList.remove('visible');
    const nEst = Object.values(datos).length;
    mostrarContenido();
    renderMetrics();
    updateStorageInfo();
    mostrarToast(nEst > 0 ? `${nEst} claves de ${nombre} — sin Excel hoy` : `Sin datos hoy para ${nombre}`, 'ok');
  }
}

// ── HELPER: toast independiente de app.js ────────────────────────────────────
function mostrarToast(msg, tipo) {
  const toast = document.getElementById('toast-main');
  const toastMsg = document.getElementById('toast-msg');
  if (!toast || !toastMsg) return;
  toastMsg.textContent = msg;
  toast.className = 'toast' + (tipo === 'err' ? ' toast-err' : '');
  toast.classList.add('show');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
}

// ── SINCRONIZACIÓN MANUAL (botón "Guardar todo") ──────────────────────────────
async function sincronizarTodo() {
  const uid = window.currentUser?.id;
  if (!uid || window.currentUser?.rol !== 'tramador') return;

  const btn = document.getElementById('btn-sincronizar');
  const iconEl = btn?.querySelector('i');
  if (btn) { btn.disabled = true; if (iconEl) iconEl.className = 'ti ti-loader-2'; }
  mostrarToast('Guardando en Supabase…', 'ok');

  // recolectar todo desde localStorage
  const keys = [
    { ls: 'tramas_estados_v6',   label: 'estados' },
    { ls: 'tramas_hist_v6',      label: 'historial' },
    { ls: 'tramas_asign_v6',     label: 'asignaciones' },
    { ls: 'tramas_exsl_v6',      label: 'sin lote' },
    { ls: 'tramas_notas_v1',     label: 'notas' },
  ];

  let ok = 0, fail = 0;
  for (const { ls } of keys) {
    const raw = localStorage.getItem(ls);
    if (!raw) continue;
    try {
      const data = JSON.parse(raw);
      const res = await fetch(`${SB_URL}/rest/v1/${SB_TABLE}`, {
        method: 'POST',
        headers: sbHeaders({ 'Prefer': 'resolution=merge-duplicates' }),
        body: JSON.stringify({ key: ls, data, user_id: uid, updated_at: new Date().toISOString() })
      });
      if (res.ok) ok++; else fail++;
    } catch (e) { fail++; }
  }

  if (btn) { btn.disabled = false; if (iconEl) iconEl.className = 'ti ti-cloud-upload'; }
  if (fail === 0) {
    showSyncStatus(true);
    mostrarToast(`✓ ${ok} claves guardadas en Supabase`, 'ok');
  } else {
    showSyncStatus(false);
    mostrarToast(`${ok} OK · ${fail} fallaron — reintenta`, 'err');
  }
}
