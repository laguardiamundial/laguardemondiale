// Por USB, adb reverse conecta el localhost del teléfono con el servidor del PC.
const API_URL = 'http://localhost:3001/api';

let token = null;
let deviceCode = null;
let usuarioActual = null;
let contactoSeleccionado = null;
let grupoSeleccionado = null;
let socket = null;

// ---------- Utilidades ----------
function escapeHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto;
  return div.innerHTML;
}

function mostrarMensaje(elementoId, texto, tipo = 'error') {
  const el = document.getElementById(elementoId);
  if (!el) return;
  el.textContent = texto;
  el.className = `mensaje ${tipo}`;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}

// ---------- Transiciones de vista (View Transitions API) ----------
async function navegarAVista(nuevaVistaFn) {
  if (document.startViewTransition) {
    await document.startViewTransition(async () => {
      nuevaVistaFn();
    });
  } else {
    nuevaVistaFn();
  }
}

// ---------- Diálogos nativos (<dialog>) ----------
const dialogos = {
  inicio: document.getElementById('pantalla-inicio'),
  registro: document.getElementById('pantalla-registro'),
  login: document.getElementById('pantalla-login'),
  codigo: document.getElementById('pantalla-codigo')
};

function abrirDialogo(id) {
  const d = dialogos[id];
  if (d && typeof d.showModal === 'function') {
    d.showModal();
  }
}

function cerrarDialogo(id) {
  const d = dialogos[id];
  if (d && typeof d.close === 'function') {
    d.close();
  }
}

function mostrarPantallaApp() {
  const app = document.getElementById('pantalla-app');
  app.hidden = false;
  app.classList.add('activa');
}

function ocultarPantallaApp() {
  const app = document.getElementById('pantalla-app');
  app.hidden = true;
  app.classList.remove('activa');
}

// ---------- Socket.io ----------
function conectarSocket() {
  if (socket) return;

  socket = io(`${API_URL.replace('/api','')}`, {
    auth: {
      token: token,
      deviceCode: deviceCode || ''
    }
  });

  socket.on('connect', () => {
    console.log('Conectado al servidor en tiempo real');
  });

  socket.on('disconnect', () => {
    console.log('Desconectado del servidor en tiempo real');
  });

  socket.on('nuevo_mensaje', (mensaje) => {
    const esDelChatActual =
      (contactoSeleccionado && mensaje.remitente_id === contactoSeleccionado && !mensaje.grupo_id && mensaje.remitente_id !== usuarioActual.id) ||
      (grupoSeleccionado && mensaje.grupo_id === grupoSeleccionado && mensaje.remitente_id !== usuarioActual.id) ||
      (!contactoSeleccionado && !grupoSeleccionado && !mensaje.destinatario_id && !mensaje.grupo_id && mensaje.remitente_id !== usuarioActual.id);

    if (esDelChatActual) {
      agregarMensajeAlChat(mensaje);

      // Notificación nativa del navegador si la pestaña no está enfocada
      if (document.hidden && Notification.permission === 'granted') {
        new Notification('Nuevo mensaje', {
          body: mensaje.texto || '[Archivo]',
          icon: '/favicon.ico',
          tag: mensaje.id
        });
      }
    }
  });
}

function desconectarSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

// ---------- Autenticación ----------
// Registro
document.getElementById('form-registro').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nombre = document.getElementById('reg-nombre').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;

  try {
    const res = await fetch(`${API_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, nombre })
    });
    const data = await res.json();
    if (!res.ok) {
      mostrarMensaje('msg-registro', data.error || 'Error al registrar');
      return;
    }
    // La cuenta se crea, pero el usuario debe iniciar sesión explícitamente.
    document.getElementById('form-registro').reset();
    mostrarMensaje('msg-registro', 'Cuenta creada correctamente. Ahora inicia sesión.', 'exito');
    setTimeout(() => {
      cerrarDialogo('registro');
      document.getElementById('log-email').value = email;
      abrirDialogo('login');
      mostrarMensaje('msg-login', 'Cuenta creada correctamente. Inicia sesión para continuar.', 'exito');
    }, 1000);
  } catch (err) {
    mostrarMensaje('msg-registro', 'Error de conexión con el servidor');
  }
});

// Login
document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('log-email').value.trim();
  const password = document.getElementById('log-password').value;

  try {
    const res = await fetch(`${API_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) {
      mostrarMensaje('msg-login', data.error || 'Credenciales inválidas');
      return;
    }
    token = data.token;
    usuarioActual = data.usuario;
    localStorage.setItem('token', token);
    localStorage.setItem('usuario', JSON.stringify(usuarioActual));
    mostrarMensaje('msg-login', 'Sesión iniciada', 'exito');
    setTimeout(() => {
      cerrarDialogo('login');
      verificarDispositivoYPasarAChat(data);
    }, 1000);
  } catch (err) {
    mostrarMensaje('msg-login', 'Error de conexión con el servidor');
  }
});

function verificarDispositivoYPasarAChat(dataLogin = null) {
  const dispositivoGuardado = localStorage.getItem('deviceCode');
  const requiereCodigo = dataLogin ? dataLogin.requiereCodigo : !dispositivoGuardado;

  if (requiereCodigo && !dispositivoGuardado) {
    navegarAVista(() => {
      abrirDialogo('codigo');
    });
    return;
  }
  deviceCode = dispositivoGuardado;
  navegarAVista(() => {
    cerrarDialogo('inicio');
    cerrarDialogo('registro');
    cerrarDialogo('login');
    cerrarDialogo('codigo');
    mostrarPantallaApp();
    cargarApp();
    conectarSocket();
  });
}

// Código único de dispositivo
let dispositivoRegistrado = false;

document.getElementById('btn-guardar-codigo').addEventListener('click', async () => {
  if (!dispositivoRegistrado) {
    // Primer clic: registrar el dispositivo y mostrar el código
    const nombre = document.getElementById('nombre-dispositivo').value.trim() || 'Dispositivo';
    try {
      const res = await fetch(`${API_URL}/dispositivo/registrar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ nombreDispositivo: nombre })
      });
      const data = await res.json();
      if (!res.ok) {
        mostrarMensaje('msg-codigo', data.error || 'Error al registrar dispositivo');
        return;
      }
      document.getElementById('codigo-unico').textContent = data.codigoUnico;
      deviceCode = data.codigoUnico;
      localStorage.setItem('deviceCode', deviceCode);
      dispositivoRegistrado = true;
      document.getElementById('btn-guardar-codigo').textContent = 'Ir al chat';
      mostrarMensaje('msg-codigo', 'Código guardado. Guárdalo en un lugar seguro.', 'exito');
    } catch (err) {
      mostrarMensaje('msg-codigo', 'Error de conexión');
    }
  } else {
    // Segundo clic: entrar al chat
    navegarAVista(() => {
      cerrarDialogo('codigo');
      mostrarPantallaApp();
      cargarApp();
      conectarSocket();
    });
  }
});

// Evitar que el formulario se envíe solo (Enter)
document.getElementById('form-codigo').addEventListener('submit', (e) => e.preventDefault());

document.getElementById('btn-copiar-codigo').addEventListener('click', () => {
  const codigo = document.getElementById('codigo-unico').textContent;
  navigator.clipboard.writeText(codigo);
  mostrarMensaje('msg-codigo', 'Código copiado al portapapeles', 'exito');
});

// Navegación diálogos iniciales
document.getElementById('btn-ingresar').addEventListener('click', () => {
  navegarAVista(() => {
    cerrarDialogo('inicio');
    abrirDialogo('login');
  });
});

document.getElementById('btn-registrar').addEventListener('click', () => {
  navegarAVista(() => {
    cerrarDialogo('inicio');
    abrirDialogo('registro');
  });
});

document.getElementById('volver-inicio-registro').addEventListener('click', () => {
  navegarAVista(() => {
    cerrarDialogo('registro');
    abrirDialogo('inicio');
  });
});

document.getElementById('volver-login-registro').addEventListener('click', () => {
  navegarAVista(() => {
    cerrarDialogo('registro');
    abrirDialogo('login');
  });
});

document.getElementById('volver-inicio-login').addEventListener('click', () => {
  navegarAVista(() => {
    cerrarDialogo('login');
    abrirDialogo('inicio');
  });
});

document.getElementById('volver-registro-login').addEventListener('click', () => {
  navegarAVista(() => {
    cerrarDialogo('login');
    abrirDialogo('registro');
  });
});

document.getElementById('volver-codigo').addEventListener('click', () => {
  navegarAVista(() => {
    cerrarDialogo('codigo');
  });
});

// Cerrar sesión
document.getElementById('btn-cerrar-sesion-app').addEventListener('click', () => {
  token = null;
  deviceCode = null;
  usuarioActual = null;
  contactoSeleccionado = null;
  grupoSeleccionado = null;
  desconectarSocket();
  localStorage.clear();
  navegarAVista(() => {
    ocultarPantallaApp();
    abrirDialogo('inicio');
  });
});

// Headers auth + código de dispositivo
function headersAuth() {
  const h = { 'Authorization': `Bearer ${token}` };
  if (deviceCode) h['X-Device-Code'] = deviceCode;
  return h;
}

// ---------- Contactos ----------
async function cargarContactos() {
  try {
    const res = await fetch(`${API_URL}/contactos`, { headers: headersAuth() });
    if (!res.ok) return;
    const data = await res.json();
    const contenedor = document.getElementById('lista-contactos');
    contenedor.innerHTML = '';

    // Chat general
    const general = document.createElement('button');
    general.type = 'button';
    general.className = 'conv-item' + (contactoSeleccionado === null && !grupoSeleccionado ? ' activo' : '');
    general.innerHTML = `
      <div class="conv-avatar">G</div>
      <div class="conv-info">
        <div class="conv-nombre">Chat General</div>
        <div class="conv-preview">Conversación grupal de la empresa</div>
      </div>
    `;
    general.onclick = () => seleccionarContacto(null, general);
    contenedor.appendChild(general);

    const apiBase = API_URL.replace('/api','');
    data.contactos.forEach(c => {
      const div = document.createElement('button');
      div.type = 'button';
      div.className = 'conv-item' + (contactoSeleccionado === c.id ? ' activo' : '');
      const inicial = (c.nombre || c.email).charAt(0).toUpperCase();
      const avatarHtml = c.avatar
        ? `<img src="${apiBase}${c.avatar}" alt="Avatar" class="avatar-img" />`
        : inicial;
      div.innerHTML = `
        <div class="conv-avatar">${avatarHtml}</div>
        <div class="conv-info">
          <div class="conv-nombre">${escapeHtml(c.nombre || c.email)}</div>
          <div class="conv-preview">Contacto corporativo</div>
        </div>
      `;
      div.onclick = () => seleccionarContacto(c.id, div);
      contenedor.appendChild(div);
    });
  } catch (err) {
    console.error(err);
  }
}

function seleccionarContacto(id, elemento) {
  contactoSeleccionado = id;
  grupoSeleccionado = null;
  document.querySelectorAll('.conv-item').forEach(el => el.classList.remove('activo'));
  if (elemento) elemento.classList.add('activo');

  const nombreEl = document.getElementById('chat-activo-nombre');
  const estadoEl = document.getElementById('chat-activo-estado');
  const avatarEl = document.getElementById('chat-activo-avatar');

  if (id === null) {
    nombreEl.textContent = 'Chat General';
    estadoEl.textContent = 'Conversación de empresa';
    avatarEl.textContent = 'G';
  } else {
    const info = elemento.querySelector('.conv-nombre');
    nombreEl.textContent = info ? info.textContent : 'Contacto';
    estadoEl.textContent = 'En línea';
    avatarEl.textContent = (info ? info.textContent : 'C').charAt(0).toUpperCase();
  }

  document.getElementById('tg-vacio').hidden = true;
  document.getElementById('tg-activo').hidden = false;
  cargarMensajes();

  document.getElementById('tg-sidebar').classList.add('oculto');
  const overlay = document.getElementById('overlay-sidebar');
  if (overlay) overlay.style.display = 'none';
}

// ---------- Avatar / Foto de perfil ----------
const inputAvatar = document.getElementById('input-avatar');
const headerAvatar = document.getElementById('header-avatar');

// Clic en el avatar del header abre el selector de archivo
headerAvatar.addEventListener('click', () => inputAvatar.click());

inputAvatar.addEventListener('change', async () => {
  const archivo = inputAvatar.files[0];
  if (!archivo) return;

  try {
    const formData = new FormData();
    formData.append('avatar', archivo);

    const res = await fetch(`${API_URL}/usuario/avatar`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'X-Device-Code': deviceCode || '' },
      body: formData
    });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || 'Error al subir foto de perfil');
      return;
    }
    const dataJson = await res.json();
    const avatarUrl = `${API_URL.replace('/api','')}${dataJson.avatar}`;
    headerAvatar.innerHTML = `<img src="${avatarUrl}" alt="Avatar" class="avatar-img" />`;
    localStorage.setItem('usuarioAvatar', avatarUrl);
    inputAvatar.value = '';
    mostrarMensaje('msg-codigo', 'Foto de perfil actualizada', 'exito');
  } catch (err) {
    alert('Error de conexión al subir foto');
  }
});

// ---------- Grupos ----------
async function cargarGrupos() {
  try {
    const res = await fetch(`${API_URL}/grupos`, { headers: headersAuth() });
    if (!res.ok) return;
    const data = await res.json();
    const contenedor = document.getElementById('lista-grupos');
    if (!contenedor) return;
    contenedor.innerHTML = '';

    data.grupos.forEach(g => {
      const div = document.createElement('button');
      div.type = 'button';
      div.className = 'conv-item' + (grupoSeleccionado === g.id ? ' activo' : '');
      div.innerHTML = `
        <div class="conv-avatar">👥</div>
        <div class="conv-info">
          <div class="conv-nombre">${escapeHtml(g.nombre)}</div>
          <div class="conv-preview">${g.totalMiembros} miembros</div>
        </div>
      `;
      div.onclick = () => seleccionarGrupo(g.id, div);
      contenedor.appendChild(div);
    });
  } catch (err) {
    console.error(err);
  }
}

function seleccionarGrupo(id, elemento) {
  grupoSeleccionado = id;
  contactoSeleccionado = null;
  document.querySelectorAll('.conv-item').forEach(el => el.classList.remove('activo'));
  if (elemento) elemento.classList.add('activo');

  const nombreEl = document.getElementById('chat-activo-nombre');
  const estadoEl = document.getElementById('chat-activo-estado');
  const avatarEl = document.getElementById('chat-activo-avatar');

  const info = elemento.querySelector('.conv-nombre');
  nombreEl.textContent = info ? info.textContent : 'Grupo';
  estadoEl.textContent = 'Chat grupal';
  avatarEl.textContent = '👥';

  document.getElementById('tg-vacio').hidden = true;
  document.getElementById('tg-activo').hidden = false;
  cargarMensajes();

  document.getElementById('tg-sidebar').classList.add('oculto');
  const overlay = document.getElementById('overlay-sidebar');
  if (overlay) overlay.style.display = 'none';
}

// Crear grupo
document.getElementById('btn-nuevo-grupo').addEventListener('click', async () => {
  const nombre = prompt('Nombre del grupo:');
  if (!nombre || !nombre.trim()) return;

  try {
    const res = await fetch(`${API_URL}/grupos`, {
      method: 'POST',
      headers: headersAuth(),
      body: JSON.stringify({ nombre: nombre.trim(), miembros: [] })
    });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || 'Error al crear grupo');
      return;
    }
    const dataJson = await res.json();
    await cargarGrupos();
    const div = document.querySelector('#lista-grupos .conv-item:last-child');
    if (div) seleccionarGrupo(dataJson.grupo.id, div);
  } catch (err) {
    alert('Error de conexión');
  }
});

// ---------- Mensajes ----------
async function cargarMensajes() {
  try {
    const res = await fetch(`${API_URL}/mensajes`, { headers: headersAuth() });
    if (!res.ok) return;
    const data = await res.json();

    const contenedor = document.getElementById('tg-mensajes');
    contenedor.innerHTML = '';

    data.mensajes.forEach(m => {
      agregarMensajeAlChat(m);
    });
  } catch (err) {
    console.error(err);
  }
}

function agregarMensajeAlChat(mensaje) {
  const contenedor = document.getElementById('tg-mensajes');
  if (!contenedor) return;

  const esMio = mensaje.remitente_id === usuarioActual.id;
  const div = document.createElement('div');
  div.className = `msg ${esMio ? 'mio' : 'otro'}`;

  const fecha = new Date(mensaje.creado_en).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  let estadoHtml = '';
  if (esMio) {
    let icono = '✓';
    let color = oklch(0.5, 0, 0);
    if (mensaje.estado === 'entregado') { icono = '✓✓'; color = oklch(0.5, 0, 0); }
    if (mensaje.estado === 'leido') { icono = '✓✓'; color = oklch(0.55, 0.18, 250); }
    estadoHtml = `<div class="msg-estado" style="color:${color}; font-size:0.7rem; margin-top:2px; text-align:right;">${icono}</div>`;
  }

  const categorias = {
    general: { emoji: '💬', texto: 'General', clase: 'categoria-general' },
    noticia: { emoji: '📰', texto: 'Noticia', clase: 'categoria-noticia' },
    investigacion: { emoji: '🔍', texto: 'Investigación', clase: 'categoria-investigacion' },
    urgente: { emoji: '🚨', texto: 'Urgente', clase: 'categoria-urgente' },
    anuncio: { emoji: '📢', texto: 'Anuncio', clase: 'categoria-anuncio' }
  };
  const cat = categorias[mensaje.categoria || 'general'];
  const categoriaHtml = `<span class="categoria-prefijo ${cat.clase}">${cat.emoji} ${cat.texto}</span>`;

  let contenido = '';
  if (mensaje.tipo === 'image') {
    contenido = `<img src="${API_URL.replace('/api','')}${mensaje.file_path}" class="msg-img" alt="Imagen" />`;
  } else if (mensaje.tipo === 'video') {
    contenido = `<video src="${API_URL.replace('/api','')}${mensaje.file_path}" class="msg-video" controls></video>`;
  } else if (mensaje.tipo === 'audio') {
    contenido = `<audio src="${API_URL.replace('/api','')}${mensaje.file_path}" controls></audio>`;
  } else if (mensaje.tipo === 'file') {
    const nombre = mensaje.file_name || 'archivo';
    const tamano = (mensaje.file_size / 1024).toFixed(1) + ' KB';
    contenido = `
      <div class="msg-archivo">
        <div class="icono">📄</div>
        <div class="info">
          <div class="nombre">${escapeHtml(nombre)}</div>
          <div class="tamano">${tamano}</div>
        </div>
      </div>
    `;
  } else {
    contenido = `<div class="msg-texto">${escapeHtml(mensaje.texto || '')}</div>`;
  }

  const apiBase = API_URL.replace('/api','');
  const avatarUrl = mensaje.remitente_avatar ? `${apiBase}${mensaje.remitente_avatar}` : null;
  const avatarHtml = avatarUrl
    ? `<img src="${avatarUrl}" alt="Avatar" class="msg-avatar-img" />`
    : `<div class="msg-avatar-letter">${(mensaje.remitente_nombre || 'U').charAt(0).toUpperCase()}</div>`;

  // Para mensajes de otros, mostrar avatar a la izquierda; para mí, a la derecha
  const avatarPosition = esMio ? 'msg-avatar-mio' : 'msg-avatar-otro';

  div.innerHTML = `
    ${categoriaHtml}
    <div class="msg-contenido">
      ${!esMio ? `<div class="msg-avatar ${avatarPosition}">${avatarHtml}</div>` : ''}
      <div class="msg-body">${contenido}${estadoHtml}</div>
      ${esMio ? `<div class="msg-avatar ${avatarPosition}">${avatarHtml}</div>` : ''}
    </div>
    <div class="msg-meta">${fecha}</div>
  `;
  contenedor.appendChild(div);
  contenedor.scrollTop = contenedor.scrollHeight;
}

// Enviar mensaje
document.getElementById('form-enviar').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('input-mensaje');
  const texto = input.value.trim();
  if (!texto) return;

  try {
    const res = await fetch(`${API_URL}/mensajes`, {
      method: 'POST',
      headers: headersAuth(),
      body: JSON.stringify({
        texto,
        destinatarioId: contactoSeleccionado,
        grupoId: grupoSeleccionado,
        categoria: document.getElementById('select-categoria').value
      })
    });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || 'Error al enviar');
      return;
    }
    input.value = '';
    await cargarMensajes();
  } catch (err) {
    alert('Error de conexión');
  }
});

// Adjuntar archivo
const btnAdjunto = document.getElementById('btn-adjunto');
const inputArchivo = document.getElementById('input-archivo');

btnAdjunto.addEventListener('click', () => inputArchivo.click());

inputArchivo.addEventListener('change', async () => {
  const archivos = inputArchivo.files;
  if (!archivos || archivos.length === 0) return;

  for (let archivo of archivos) {
    await enviarArchivo(archivo);
  }
  inputArchivo.value = '';
});

async function enviarArchivo(archivo) {
  const formData = new FormData();
  formData.append('archivo', archivo);
  if (contactoSeleccionado) formData.append('destinatarioId', contactoSeleccionado);
  if (grupoSeleccionado) formData.append('grupoId', grupoSeleccionado);
  formData.append('categoria', document.getElementById('select-categoria').value);

  try {
    const res = await fetch(`${API_URL}/mensajes`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'X-Device-Code': deviceCode || '' },
      body: formData
    });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || 'Error al enviar archivo');
      return;
    }
    await cargarMensajes();
  } catch (err) {
    alert('Error de conexión al enviar archivo');
  }
}

// Sidebar móvil
document.getElementById('btn-abrir-sidebar').addEventListener('click', () => {
  const sidebar = document.getElementById('tg-sidebar');
  sidebar.classList.remove('oculto');
  const overlay = document.getElementById('overlay-sidebar') || crearOverlay();
  overlay.style.display = 'block';
});

function crearOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'overlay-sidebar';
  overlay.id = 'overlay-sidebar';
  document.body.appendChild(overlay);
  overlay.addEventListener('click', () => {
    document.getElementById('tg-sidebar').classList.add('oculto');
    overlay.style.display = 'none';
  });
  return overlay;
}

const overlay = crearOverlay();
overlay.addEventListener('click', () => {
  document.getElementById('tg-sidebar').classList.add('oculto');
  overlay.style.display = 'none';
});

// ---------- Tema oscuro ----------
function inicializarTema() {
  const temaGuardado = localStorage.getItem('tema');
  const btnTema = document.getElementById('btn-tema');
  const html = document.documentElement;

  let tema = temaGuardado;
  if (!tema) {
    const prefiereOscuro = window.matchMedia('(prefers-color-scheme: dark)').matches;
    tema = prefiereOscuro ? 'oscuro' : 'claro';
  }

  aplicarTema(tema, btnTema);
}

function aplicarTema(tema, btn) {
  const html = document.documentElement;
  html.setAttribute('data-tema', tema);
  localStorage.setItem('tema', tema);

  if (btn) {
    btn.textContent = tema === 'oscuro' ? '☀️' : '🌙';
    btn.title = tema === 'oscuro' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
  }
}

document.getElementById('btn-tema').addEventListener('click', () => {
  const html = document.documentElement;
  const temaActual = html.getAttribute('data-tema') || 'claro';
  const nuevoTema = temaActual === 'claro' ? 'oscuro' : 'claro';
  aplicarTema(nuevoTema, document.getElementById('btn-tema'));
});

// ---------- Notificaciones nativas ----------
function solicitarPermisoNotificaciones() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

// ---------- Inicialización ----------
document.addEventListener('DOMContentLoaded', () => {
  inicializarTema();
  solicitarPermisoNotificaciones();

  const tok = localStorage.getItem('token');
  const user = localStorage.getItem('usuario');
  const dc = localStorage.getItem('deviceCode');

  if (tok && user) {
    token = tok;
    usuarioActual = JSON.parse(user);
    deviceCode = dc;
    navegarAVista(() => {
      mostrarPantallaApp();
      cargarApp();
      conectarSocket();
    });
  } else {
    navegarAVista(() => {
      abrirDialogo('inicio');
    });
  }
});

async function cargarApp() {
  document.getElementById('header-nombre').textContent = usuarioActual.nombre || usuarioActual.email;

  // Obtener perfil para tener el avatar actualizado
  try {
    const res = await fetch(`${API_URL}/perfil`, { headers: headersAuth() });
    if (res.ok) {
      const data = await res.json();
      if (data.usuario && data.usuario.avatar) {
        const avatarUrl = `${API_URL.replace('/api','')}${data.usuario.avatar}`;
        document.getElementById('header-avatar').innerHTML = `<img src="${avatarUrl}" alt="Avatar" class="avatar-img" />`;
        localStorage.setItem('usuarioAvatar', avatarUrl);
      } else {
        const inicial = (usuarioActual.nombre || usuarioActual.email).charAt(0).toUpperCase();
        document.getElementById('header-avatar').textContent = inicial;
        const avatarGuardado = localStorage.getItem('usuarioAvatar');
        if (avatarGuardado) {
          document.getElementById('header-avatar').innerHTML = `<img src="${avatarGuardado}" alt="Avatar" class="avatar-img" />`;
        }
      }
    }
  } catch (err) {
    console.error('Error cargando perfil:', err);
    const inicial = (usuarioActual.nombre || usuarioActual.email).charAt(0).toUpperCase();
    document.getElementById('header-avatar').textContent = inicial;
  }

  await cargarContactos();
  await cargarGrupos();
  await cargarMensajes();
}
