const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'cambiar_en_produccion_clave_secreta_123';
const EMPRESA_DOMINIO = 'tuempresa.com'; // <-- Cambia por el dominio de tu empresa

// Carpetas
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOADS_DIR = path.join(ROOT, 'uploads');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Archivos JSON (base de datos simple sin dependencias nativas)
const ARCHIVOS = {
  usuarios: path.join(DATA_DIR, 'usuarios.json'),
  dispositivos: path.join(DATA_DIR, 'dispositivos.json'),
  mensajes: path.join(DATA_DIR, 'mensajes.json')
};

function leerArchivo(archivo, defecto = []) {
  try {
    if (!fs.existsSync(archivo)) return defecto;
    const contenido = fs.readFileSync(archivo, 'utf8');
    if (!contenido.trim()) return defecto;
    return JSON.parse(contenido);
  } catch (e) {
    return defecto;
  }
}

function escribirArchivo(archivo, datos) {
  fs.writeFileSync(archivo, JSON.stringify(datos, null, 2));
}

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(UPLOADS_DIR)); // servir archivos subidos

// ---------- Helpers ----------
const crypto = require('crypto');
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function generarCodigoUnico() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let codigo = '';
  for (let i = 0; i < 8; i++) {
    codigo += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${codigo.slice(0,4)}-${codigo.slice(4)}`;
}

function autenticar(req, res, next) {
  const authHeader = req.headers['authorization'];
  const deviceCode = req.headers['x-device-code'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de acceso requerido' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.usuario = decoded;

    if (deviceCode) {
      const dispositivos = leerArchivo(ARCHIVOS.dispositivos);
      const dispositivo = dispositivos.find(d =>
        d.codigo_unico === deviceCode && d.usuario_id === decoded.usuarioId
      );
      if (!dispositivo) {
        return res.status(403).json({ error: 'Código de dispositivo inválido' });
      }
      req.dispositivo = dispositivo;
    }

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

// ---------- Multer para archivos ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const permitidos = /jpeg|jpg|png|gif|webp|mp4|webm|ogg|pdf|doc|docx|zip|mp3|wav/;
    const extOk = permitidos.test(path.extname(file.originalname).toLowerCase());
    if (extOk) cb(null, true);
    else cb(new Error('Tipo de archivo no permitido'), false);
  }
);

// ---------- Rutas ----------

app.post('/api/register', (req, res) => {
  const { email, password, nombre } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña requeridos' });
  }

  if (!email.endsWith(`@${EMPRESA_DOMINIO}`)) {
    return res.status(403).json({
      error: `Solo se permiten correos de @${EMPRESA_DOMINIO}`
    });
  }

  try {
    const usuarios = leerArchivo(ARCHIVOS.usuarios);
    if (usuarios.find(u => u.email === email)) {
      return res.status(409).json({ error: 'El usuario ya existe' });
    }

    const id = uuidv4();
    const hash = hashPassword(password);
    const nuevo = { id, email, password_hash: hash, nombre: nombre || '', avatar: null };
    usuarios.push(nuevo);
    escribirArchivo(ARCHIVOS.usuarios, usuarios);

    const token = jwt.sign({ usuarioId: id, email }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      mensaje: 'Usuario registrado',
      token,
      usuario: { id, email, nombre: nombre || '' }
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al registrar' });
  }
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña requeridos' });
  }

  try {
    const usuarios = leerArchivo(ARCHIVOS.usuarios);
    const usuario = usuarios.find(u => u.email === email);
    if (!usuario) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    if (usuario.password_hash !== hashPassword(password)) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const token = jwt.sign({ usuarioId: usuario.id, email: usuario.email }, JWT_SECRET, { expiresIn: '7d' });

    const dispositivos = leerArchivo(ARCHIVOS.dispositivos);
    const misDispositivos = dispositivos.filter(d => d.usuario_id === usuario.id);

    res.json({
      mensaje: 'Inicio de sesión exitoso',
      token,
      usuario: {
        id: usuario.id,
        email: usuario.email,
        nombre: usuario.nombre,
        avatar: usuario.avatar
      },
      dispositivos: misDispositivos,
      requiereCodigo: misDispositivos.length === 0
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

app.post('/api/dispositivo/registrar', autenticar, (req, res) => {
  const { nombreDispositivo } = req.body;
  const usuarioId = req.usuario.usuarioId;

  const codigoUnico = generarCodigoUnico();
  const id = uuidv4();

  const dispositivos = leerArchivo(ARCHIVOS.dispositivos);
  dispositivos.push({
    id,
    usuario_id: usuarioId,
    codigo_unico: codigoUnico,
    nombre_dispositivo: nombreDispositivo || 'Dispositivo'
  });
  escribirArchivo(ARCHIVOS.dispositivos, dispositivos);

  res.json({
    mensaje: 'Dispositivo registrado',
    codigoUnico,
    dispositivo: { id, codigoUnico, nombreDispositivo }
  });
});

app.get('/api/dispositivos', autenticar, (req, res) => {
  const dispositivos = leerArchivo(ARCHIVOS.dispositivos);
  const misDispositivos = dispositivos.filter(d => d.usuario_id === req.usuario.usuarioId);
  res.json({ dispositivos: misDispositivos });
});

// Enviar mensaje (texto y/o archivo) — requiere código de dispositivo
app.post('/api/mensajes', autenticar, upload.single('archivo'), (req, res) => {
  const { texto, destinatarioId } = req.body;
  const archivo = req.file;

  if (!texto && !archivo) {
    return res.status(400).json({ error: 'Mensaje o archivo requerido' });
  }

  let tipo = 'text';
  let filePath = null, fileName = null, fileSize = null, mimeType = null;

  if (archivo) {
    const ext = path.extname(archivo.originalname).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) tipo = 'image';
    else if (['.mp4', '.webm', '.ogg'].includes(ext)) tipo = 'video';
    else if (['.mp3', '.wav'].includes(ext)) tipo = 'audio';
    else tipo = 'file';

    filePath = `/uploads/${archivo.filename}`;
    fileName = archivo.originalname;
    fileSize = archivo.size;
    mimeType = archivo.mimetype;
  }

  const id = uuidv4();
  const mensaje = {
    id,
    remitente_id: req.usuario.usuarioId,
    destinatario_id: destinatarioId || null,
    tipo,
    texto: texto || null,
    file_path: filePath,
    file_name: fileName,
    file_size: fileSize,
    mime_type: mimeType,
    leido: 0,
    creado_en: new Date().toISOString()
  };

  const mensajes = leerArchivo(ARCHIVOS.mensajes);
  mensajes.push(mensaje);
  escribirArchivo(ARCHIVOS.mensajes, mensajes);

  res.json({ mensaje: 'Mensaje enviado', mensaje });
});

// Obtener mensajes — requiere código de dispositivo
app.get('/api/mensajes', autenticar, (req, res) => {
  const mensajes = leerArchivo(ARCHIVOS.mensajes);
  const usuarios = leerArchivo(ARCHIVOS.usuarios);

  const filtrados = mensajes.filter(m =>
    m.remitente_id === req.usuario.usuarioId ||
    m.destinatario_id === req.usuario.usuarioId ||
    m.destinatario_id === null
  ).sort((a, b) => new Date(a.creado_en) - new Date(b.creado_en));

  const resultado = filtrados.map(m => {
    const autor = usuarios.find(u => u.id === m.remitente_id);
    return {
      ...m,
      remitente_email: autor ? autor.email : '',
      remitente_nombre: autor ? autor.nombre : '',
      remitente_avatar: autor ? autor.avatar : null
    };
  });

  res.json({ mensajes: resultado });
});

// Contactos (todos los usuarios menos yo)
app.get('/api/contactos', autenticar, (req, res) => {
  const usuarios = leerArchivo(ARCHIVOS.usuarios);
  const contactos = usuarios.filter(u => u.id !== req.usuario.usuarioId).map(u => ({
    id: u.id,
    email: u.email,
    nombre: u.nombre,
    avatar: u.avatar
  }));
  res.json({ contactos });
});

// Perfil
app.get('/api/perfil', autenticar, (req, res) => {
  const usuarios = leerArchivo(ARCHIVOS.usuarios);
  const usuario = usuarios.find(u => u.id === req.usuario.usuarioId);
  if (!usuario) {
    return res.status(404).json({ error: 'Usuario no encontrado' });
  }
  res.json({ usuario: { id: usuario.id, email: usuario.email, nombre: usuario.nombre, avatar: usuario.avatar } });
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
  console.log(`Dominio empresa permitido: @${EMPRESA_DOMINIO}`);
  console.log(`Archivos en: ${UPLOADS_DIR}`);
  console.log(`Datos JSON en: ${DATA_DIR}`);
});

module.exports = app;
