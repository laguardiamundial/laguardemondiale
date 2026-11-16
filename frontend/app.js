const API_URL = 'http://localhost:3001/api';

let token = null;
let deviceCode = null;
let usuarioActual = null;
let contactoSeleccionado = null;
let grupoSeleccionado = null;
let socket = null;

// Elementos DOM
const pantallas = {
  inicio: document.getElementById('pantalla-inicio'),
  registro: document.getElementById('pantalla-registro'),
  login: document.getElementById('pantalla-login'),
  codigo: document.getElementById('pantalla-codigo'),
  app: document.getElementById('pantalla-app')
};

const overlay = document.createElement('div');
overlay.className = 'overlay-sidebar';
overlay.id = 'overlay-sidebar';
document.body.appendChild(overlay);

function mostrar(pantalla) {
  Object.values(pantallas).forEach(p => p.classList.remove('activa'));
  Object.values(pantallas).forEach(p => p.classList.add('oculto'));
  pantallas[pantalla].classList.remove('oculto');
  pantallas[pantalla].classList.add('activa');
}

function mostrarMensaje(elementoId, texto, tipo = 'error') {
  const el = document.getElementById(elementoId);
  if (!el) return;
  el.textContent = texto;
  el.className = `mensaje ${tipo}`;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}

// Navegación pantallas iniciales
document.getElementById('btn-ingresar').addEventListener('click', () => mostrar('login'));
document.getElementById('btn-registrar').addEventListener('click', () => mostrar('registro'));
document.getElementById('volver-inicio-registro').addEventListener('click', () => mostrar('inicio'));
document.getElementById('volver-login-registro').addEventListener('click', () => mostrar('login'));
document.getElementById('volver-inicio-login').addEventListener('click', () => mostrar('inicio'));
document.getElementById('volver-registro-login').addEventListener('click', () => mostrar('registro'));

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
    token = data.token;
    usuarioActual = data.usuario;
    localStorage.setItem('token', token);
    localStorage.setItem('usuario', JSON.stringify(usuarioActual));
    mostrarMensaje('msg-registro', 'Cuenta creada. Iniciando sesión...', 'exito');
    setTimeout(() => verificarDispositivoYPasarAChat(), 1000);
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
    setTimeout(() => verificarDispositivoYPasarAChat(data), 1000);
  } catch (err) {
    mostrarMensaje('msg-login', 'Error de conexión con el servidor');
  }
});

function verificarDispositivoYPasarAChat(dataLogin = null) {
  const dispositivoGuardado = localStorage.getItem('deviceCode');
  const requiereCodigo = dataLogin ? dataLogin.requiereCodigo : !dispositivoGuardado;

  if (requiereCodigo && !dispositivoGuardado) {
    mostrar('codigo');
    return;
  }
  deviceCode = dispositivoGuardado;
  cargarApp();
}

async function cargarApp() {
  document.getElementById('header-nombre').textContent = usuarioActual.nombre || usuarioActual.email;
  document.getElementById('header-avatar').textContent = (usuarioActual.nombre || usuarioActual.email).charAt(0).toUpperCase();
  await cargarContactos();
  await cargarGrupos();
  await cargarMensajes();
  mostrar('app');
  conectarSocket();
}

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

  // Escuchar nuevos mensajes en tiempo real
  socket.on('nuevo_mensaje', (mensaje) => {
    // Si el mensaje es del chat actual Y es de OTRO usuario, agregarlo en tiempo real
    // (Los mensajes propios ya aparecen al enviar)
    const esDelChatActual = 
      (contactoSeleccionado && mensaje.remitente_id === contactoSeleccionado && !mensaje.grupo_id && mensaje.remitente_id !== usuarioActual.id) ||
      (grupoSeleccionado && mensaje.grupo_id === grupoSeleccionado && mensaje.remitente_id !== usuarioActual.id) ||
      (!contactoSeleccionado && !grupoSeleccionado && !mensaje.destinatario_id && !mensaje.grupo_id && mensaje.remitente_id !== usuarioActual.id);

    if (esDelChatActual) {
      agregarMensajeAlChat(mensaje);
    }
  });
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
    estadoHtml = `<div class="msg-estado" style="color:#999; font-size:0.7rem; margin-top:2px; text-align:right;">✓</div>`;
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

  div.innerHTML = categoriaHtml + contenido + estadoHtml + `<div class="msg-meta">${fecha}</div>`;
  contenedor.appendChild(div);
  contenedor.scrollTop = contenedor.scrollHeight;
}

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
      const div = document.createElement('div');
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

  // Buscar nombre del grupo en el elemento
  const info = elemento.querySelector('.conv-nombre');
  nombreEl.textContent = info ? info.textContent : 'Grupo';
  estadoEl.textContent = 'Chat grupal';
  avatarEl.textContent = '👥';

  document.getElementById('tg-vacio').classList.add('oculto');
  document.getElementById('tg-activo').classList.remove('oculto');
  cargarMensajes();

  document.getElementById('tg-sidebar').classList.add('oculto');
  overlay.style.display = 'none';
}

// Código único de dispositivo
document.getElementById('btn-guardar-codigo').addEventListener('click', async () => {
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
    document.getElementById('btn-guardar-codigo').textContent = 'Ir al chat';
    document.getElementById('btn-guardar-codigo').onclick = () => cargarApp();
    mostrarMensaje('msg-codigo', 'Código guardado. Guárdalo en un lugar seguro.', 'exito');
  } catch (err) {
    mostrarMensaje('msg-codigo', 'Error de conexión');
  }
});

document.getElementById('btn-copiar-codigo').addEventListener('click', () => {
  const codigo = document.getElementById('codigo-unico').textContent;
  navigator.clipboard.writeText(codigo);
  mostrarMensaje('msg-codigo', 'Código copiado al portapapeles', 'exito');
});

// Cerrar sesión
document.getElementById('btn-cerrar-sesion-app').addEventListener('click', () => {
  token = null;
  deviceCode = null;
  usuarioActual = null;
  contactoSeleccionado = null;
  grupoSeleccionado = null;
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  localStorage.clear();
  mostrar('inicio');
});

// Headers auth + código de dispositivo
function headersAuth() {
  const h = { 'Authorization': `Bearer ${token}` };
  if (deviceCode) h['X-Device-Code'] = deviceCode;
  return h;
}

// Contactos
async function cargarContactos() {
  try {
    const res = await fetch(`${API_URL}/contactos`, { headers: headersAuth() });
    if (!res.ok) return;
    const data = await res.json();
    const contenedor = document.getElementById('lista-contactos');
    contenedor.innerHTML = '';

    const general = document.createElement('div');
    general.className = 'conv-item' + (contactoSeleccionado === null ? ' activo' : '');
    general.innerHTML = `
      <div class="conv-avatar">G</div>
      <div class="conv-info">
        <div class="conv-nombre">Chat General</div>
        <div class="conv-preview">Conversación grupal de la empresa</div>
      </div>
    `;
    general.onclick = () => seleccionarContacto(null, general);
    contenedor.appendChild(general);

    data.contactos.forEach(c => {
      const div = document.createElement('div');
      div.className = 'conv-item' + (contactoSeleccionado === c.id ? ' activo' : '');
      const inicial = (c.nombre || c.email).charAt(0).toUpperCase();
      div.innerHTML = `
        <div class="conv-avatar">${inicial}</div>
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

  document.getElementById('tg-vacio').classList.add('oculto');
  document.getElementById('tg-activo').classList.remove('oculto');
  cargarMensajes();

  // Marcar mensajes del contacto como leídos
  if (id !== null) {
    fetch(`${API_URL}/mensajes/marcar-leidos`, {
      method: 'POST',
      headers: headersAuth(),
      body: JSON.stringify({ remitente_id: id })
    }).catch(() => {});
  }

  document.getElementById('tg-sidebar').classList.add('oculto');
  overlay.style.display = 'none';
}

// Mensajes
async function cargarMensajes() {
  try {
    const res = await fetch(`${API_URL}/mensajes`, { headers: headersAuth() });
    if (!res.ok) return;
    const data = await res.json();

    const contenedor = document.getElementById('tg-mensajes');
    contenedor.innerHTML = '';

    data.mensajes.forEach(m => {
      const esMio = m.remitente_id === usuarioActual.id;
      const div = document.createElement('div');
      div.className = `msg ${esMio ? 'mio' : 'otro'}`;

      const fecha = new Date(m.creado_en).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      let estadoHtml = '';
      if (esMio) {
        let icono = '✓';
        let color = '#999';
        if (m.estado === 'entregado') { icono = '✓✓'; color = '#999'; }
        if (m.estado === 'leido') { icono = '✓✓'; color = '#0078d7'; }
        estadoHtml = `<div class="msg-estado" style="color:${color}; font-size:0.7rem; margin-top:2px; text-align:right;">${icono}</div>`;
      }

      const categorias = {
        general: { emoji: '💬', texto: 'General', clase: 'categoria-general' },
        noticia: { emoji: '📰', texto: 'Noticia', clase: 'categoria-noticia' },
        investigacion: { emoji: '🔍', texto: 'Investigación', clase: 'categoria-investigacion' },
        urgente: { emoji: '🚨', texto: 'Urgente', clase: 'categoria-urgente' },
        anuncio: { emoji: '📢', texto: 'Anuncio', clase: 'categoria-anuncio' }
      };
      const cat = categorias[m.categoria || 'general'];
      const categoriaHtml = `<span class="categoria-prefijo ${cat.clase}">${cat.emoji} ${cat.texto}</span>`;

      let contenido = '';
      if (m.tipo === 'image') {
        contenido = `<img src="${API_URL.replace('/api','')}${m.file_path}" class="msg-img" alt="Imagen" />`;
      } else if (m.tipo === 'video') {
        contenido = `<video src="${API_URL.replace('/api','')}${m.file_path}" class="msg-video" controls></video>`;
      } else if (m.tipo === 'audio') {
        contenido = `<audio src="${API_URL.replace('/api','')}${m.file_path}" controls></audio>`;
      } else if (m.tipo === 'file') {
        const nombre = m.file_name || 'archivo';
        const tamano = (m.file_size / 1024).toFixed(1) + ' KB';
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
        contenido = `<div class="msg-texto">${escapeHtml(m.texto || '')}</div>`;
      }

      div.innerHTML = categoriaHtml + contenido + estadoHtml + `<div class="msg-meta">${fecha}</div>`;
      contenedor.appendChild(div);
    });

    contenedor.scrollTop = contenedor.scrollHeight;
  } catch (err) {
    console.error(err);
  }
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
  overlay.style.display = 'block';
});
overlay.addEventListener('click', () => {
  document.getElementById('tg-sidebar').classList.add('oculto');
  overlay.style.display = 'none';
});

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
    // Seleccionar el grupo recién creado
    const div = document.querySelector(`#lista-grupos .conv-item:last-child`);
    if (div) seleccionarGrupo(dataJson.grupo.id, div);
  } catch (err) {
    alert('Error de conexión');
  }
});

// Utils
function escapeHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto;
  return div.innerHTML;
}

// ---------- Tema oscuro ----------
function inicializarTema() {
  const temaGuardado = localStorage.getItem('tema');
  const btnTema = document.getElementById('btn-tema');
  const html = document.documentElement;

  // Determinar tema: preferencia guardada, luego sistema, luego claro por defecto
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

  // Cambiar icono del botón
  if (btn) {
    btn.textContent = tema === 'oscuro' ? '☀️' : '🌙';
    btn.title = tema === 'oscuro' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
  }
}

// Alternar tema al hacer clic
document.addEventListener('DOMContentLoaded', () => {
  const btnTema = document.getElementById('btn-tema');
  if (btnTema) {
    btnTema.addEventListener('click', () => {
      const html = document.documentElement;
      const temaActual = html.getAttribute('data-tema') || 'claro';
      const nuevoTema = temaActual === 'claro' ? 'oscuro' : 'claro';
      aplicarTema(nuevoTema, btnTema);
    });
  }
});

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
  const tok = localStorage.getItem('token');
  const user = localStorage.getItem('usuario');
  const dc = localStorage.getItem('deviceCode');

  inicializarTema();

  if (tok && user) {
    token = tok;
    usuarioActual = JSON.parse(user);
    deviceCode = dc;
    cargarApp();
  } else {
    mostrar('inicio');
  }
});
