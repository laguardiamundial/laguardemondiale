const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');
const SQL = require('sql.js');

const app = express();
const PORT = 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'cambiar_en_produccion_clave_secreta_123';
const EMPRESA_DOMINIO = 'tuempresa.com'; // <-- Cambia por el dominio de tu empresa

// Carpetas
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOADS_DIR = path.join(ROOT, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'database.sqlite');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(UPLOADS_DIR));

// Servir el frontend (www) desde el mismo servidor
const FRONTEND_DIR = path.join(ROOT, '..', 'frontend', 'www');
app.use(express.static(FRONTEND_DIR));

// ---------- Base de datos SQLite (sql.js) ----------
let db;
let server;
let io;
const usuarioSockets = {}; // usuarioId -> socket.id

async function initDatabase() {
  const SQLPromise = SQL();
  const SQLLibrary = await SQLPromise;

  let existingDb = null;
  if (fs.existsSync(DB_FILE)) {
    const filebuffer = fs.readFileSync(DB_FILE);
    existingDb = new SQLLibrary.Database(filebuffer);
  } else {
    existingDb = new SQLLibrary.Database();
  }

  // Crear tablas si no existen
  existingDb.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nombre TEXT,
      avatar TEXT,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS dispositivos (
      id TEXT PRIMARY KEY,
      usuario_id TEXT NOT NULL,
      codigo_unico TEXT NOT NULL,
      nombre_dispositivo TEXT,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    );

    CREATE TABLE IF NOT EXISTS mensajes (
      id TEXT PRIMARY KEY,
      remitente_id TEXT NOT NULL,
      destinatario_id TEXT,
      grupo_id TEXT,
      tipo TEXT NOT NULL DEFAULT 'text',
      categoria TEXT DEFAULT 'general',
      texto TEXT,
      file_path TEXT,
      file_name TEXT,
      file_size INTEGER,
      mime_type TEXT,
      leido INTEGER DEFAULT 0,
      estado TEXT DEFAULT 'enviado',
      leido_en DATETIME,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (remitente_id) REFERENCES usuarios(id)
    );

    CREATE TABLE IF NOT EXISTS grupos (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      creado_por TEXT NOT NULL,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (creado_por) REFERENCES usuarios(id)
    );

    CREATE TABLE IF NOT EXISTS grupo_miembros (
      grupo_id TEXT NOT NULL,
      usuario_id TEXT NOT NULL,
      rol TEXT DEFAULT 'miembro',
      unirse_en DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (grupo_id, usuario_id),
      FOREIGN KEY (grupo_id) REFERENCES grupos(id),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    );
  `);

  // Guardar la base de datos inicial si es nueva
  if (!fs.existsSync(DB_FILE)) {
    saveDatabase(existingDb);
  }

  return existingDb;
}

function saveDatabase(database) {
  const data = database.export();
  fs.writeFileSync(DB_FILE, Buffer.from(data));
}

function run(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.run(params);
  stmt.free();
}

// Devuelve un array de objetos (filas) con nombres de columna
function all(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// Devuelve un objeto (fila) o undefined si no existe
function get(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  let result;
  if (stmt.step()) {
    result = stmt.getAsObject();
  }
  stmt.free();
  return result;
}

// ---------- Socket.io helpers ----------

function emitirNuevoMensaje(mensaje) {
  if (!io) return;

  const salas = [];

  // Sala personal del remitente (para que se vea en tiempo real en su pantalla)
  salas.push(`usuario_${mensaje.remitente_id}`);

  if (mensaje.grupo_id) {
    // Mensaje de grupo: emitir a la sala del grupo
    salas.push(`grupo_${mensaje.grupo_id}`);
  } else if (mensaje.destinatario_id) {
    // Mensaje individual: emitir a la sala personal del destinatario
    salas.push(`usuario_${mensaje.destinatario_id}`);
  }

  // Obtener datos del remitente para incluirlos en el evento
  const autor = get(db, 'SELECT id, email, nombre, avatar FROM usuarios WHERE id = ?', [mensaje.remitente_id]);

  const mensajeConAutor = {
    ...mensaje,
    remitente_email: autor ? autor.email : '',
    remitente_nombre: autor ? autor.nombre : '',
    remitente_avatar: autor ? autor.avatar : null
  };

  // Emitir a todas las salas relevantes
  salas.forEach(sala => {
    io.to(sala).emit('nuevo_mensaje', mensajeConAutor);
  });
}

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
      const dispositivo = get(
        db,
        'SELECT * FROM dispositivos WHERE codigo_unico = ? AND usuario_id = ?',
        [deviceCode, decoded.usuarioId]
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
});

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
    const existe = get(db, 'SELECT id FROM usuarios WHERE email = ?', [email]);
    if (existe) {
      return res.status(409).json({ error: 'El usuario ya existe' });
    }

    const id = uuidv4();
    const hash = hashPassword(password);
    run(db, 'INSERT INTO usuarios (id, email, password_hash, nombre) VALUES (?, ?, ?, ?)', [id, email, hash, nombre || '']);

    const token = jwt.sign({ usuarioId: id, email }, JWT_SECRET, { expiresIn: '7d' });

    saveDatabase(db);

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
    const usuario = get(db, 'SELECT * FROM usuarios WHERE email = ?', [email]);
    if (!usuario) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    if (usuario.password_hash !== hashPassword(password)) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const token = jwt.sign({ usuarioId: usuario.id, email: usuario.email }, JWT_SECRET, { expiresIn: '7d' });

    const dispositivos = all(db, 'SELECT * FROM dispositivos WHERE usuario_id = ?', [usuario.id]);

    res.json({
      mensaje: 'Inicio de sesión exitoso',
      token,
      usuario: {
        id: usuario.id,
        email: usuario.email,
        nombre: usuario.nombre,
        avatar: usuario.avatar
      },
      dispositivos,
      requiereCodigo: dispositivos.length === 0
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

  run(db, 'INSERT INTO dispositivos (id, usuario_id, codigo_unico, nombre_dispositivo) VALUES (?, ?, ?, ?)', [id, usuarioId, codigoUnico, nombreDispositivo || 'Dispositivo']);
  saveDatabase(db);

  res.json({
    mensaje: 'Dispositivo registrado',
    codigoUnico,
    dispositivo: { id, codigoUnico, nombreDispositivo }
  });
});

app.get('/api/dispositivos', autenticar, (req, res) => {
  const dispositivos = all(db, 'SELECT * FROM dispositivos WHERE usuario_id = ?', [req.usuario.usuarioId]);
  res.json({ dispositivos });
});

// Enviar mensaje (texto y/o archivo) — requiere código de dispositivo
app.post('/api/mensajes', autenticar, upload.single('archivo'), (req, res) => {
  const { texto, destinatarioId, grupoId } = req.body;
  const archivo = req.file;

  if (!texto && !archivo) {
    return res.status(400).json({ error: 'Mensaje o archivo requerido' });
  }

  if (grupoId) {
    const esMiembro = get(
      db,
      'SELECT 1 FROM grupo_miembros WHERE grupo_id = ? AND usuario_id = ?',
      [grupoId, req.usuario.usuarioId]
    );
    if (!esMiembro) {
      return res.status(403).json({ error: 'No eres miembro de este grupo' });
    }
  }

  let tipo = 'text';
  let categoria = 'general';
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

  if (req.body.categoria) {
    categoria = req.body.categoria;
  }

  const id = uuidv4();
  const creado_en = new Date().toISOString();

  run(db, `
    INSERT INTO mensajes (id, remitente_id, destinatario_id, grupo_id, tipo, categoria, texto, file_path, file_name, file_size, mime_type, leido, estado, creado_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [id, req.usuario.usuarioId, destinatarioId || null, grupoId || null, tipo, categoria, texto || null, filePath, fileName, fileSize, mimeType, 0, 'enviado', creado_en]);

  saveDatabase(db);

  const mensaje = {
    id,
    remitente_id: req.usuario.usuarioId,
    destinatario_id: destinatarioId || null,
    grupo_id: grupoId || null,
    tipo,
    categoria,
    texto: texto || null,
    file_path: filePath,
    file_name: fileName,
    file_size: fileSize,
    mime_type: mimeType,
    leido: 0,
    estado: 'enviado',
    leido_en: null,
    creado_en
  };

  // Emitir en tiempo real via WebSocket
  emitirNuevoMensaje(mensaje);

  res.json({ mensaje: 'Mensaje enviado', mensaje });
});

// Obtener mensajes — requiere código de dispositivo
app.get('/api/mensajes', autenticar, (req, res) => {
  const misGrupos = all(
    db,
    'SELECT grupo_id FROM grupo_miembros WHERE usuario_id = ?',
    [req.usuario.usuarioId]
  ).map(r => r.grupo_id);

  const placeholders = misGrupos.length > 0 ? misGrupos.map(() => '?').join(',') : 'NULL';

  const mensajes = all(
    db,
    `
    SELECT m.*, u.email as remitente_email, u.nombre as remitente_nombre, u.avatar as remitente_avatar
    FROM mensajes m
    JOIN usuarios u ON m.remitente_id = u.id
    WHERE m.remitente_id = ?
       OR m.destinatario_id = ?
       OR m.destinatario_id IS NULL
       OR (m.grupo_id IS NOT NULL AND m.grupo_id IN (${placeholders}))
    ORDER BY m.creado_en ASC
  `,
    [req.usuario.usuarioId, req.usuario.usuarioId, ...misGrupos]
  );

  res.json({ mensajes });
});

// Marcar un mensaje como leído (solo el destinatario)
app.post('/api/mensajes/:id/leer', autenticar, (req, res) => {
  const mensaje = get(db, 'SELECT * FROM mensajes WHERE id = ?', [req.params.id]);
  if (!mensaje) {
    return res.status(404).json({ error: 'Mensaje no encontrado' });
  }
  if (mensaje.destinatario_id !== req.usuario.usuarioId) {
    return res.status(403).json({ error: 'No autorizado' });
  }

  const ahora = new Date().toISOString();
  run(db, `UPDATE mensajes SET estado = 'leido', leido = 1, leido_en = ? WHERE id = ?`, [ahora, req.params.id]);
  saveDatabase(db);

  const actualizado = get(db, 'SELECT * FROM mensajes WHERE id = ?', [req.params.id]);
  res.json({ ok: true, mensaje: actualizado });
});

// Marcar todos los mensajes de un remitente como leídos
app.post('/api/mensajes/marcar-leidos', autenticar, (req, res) => {
  const { remitente_id } = req.body;
  if (!remitente_id) {
    return res.status(400).json({ error: 'remitente_id requerido' });
  }

  const ahora = new Date().toISOString();
  run(
    db,
    `UPDATE mensajes SET estado = 'leido', leido = 1, leido_en = ? WHERE remitente_id = ? AND destinatario_id = ? AND estado != 'leido'`,
    [ahora, remitente_id, req.usuario.usuarioId]
  );
  saveDatabase(db);

  res.json({ ok: true });
});

// ---------- Grupos ----------

app.post('/api/grupos', autenticar, (req, res) => {
  const { nombre, miembros } = req.body;
  const creadorId = req.usuario.usuarioId;

  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: 'Nombre del grupo requerido' });
  }

  const id = uuidv4();
  const creado_en = new Date().toISOString();

  run(db, 'INSERT INTO grupos (id, nombre, creado_por, creado_en) VALUES (?, ?, ?, ?)', [id, nombre.trim(), creadorId, creado_en]);
  run(db, 'INSERT INTO grupo_miembros (grupo_id, usuario_id, rol, unirse_en) VALUES (?, ?, ?, ?)', [id, creadorId, 'admin', creado_en]);

  if (Array.isArray(miembros)) {
    miembros.forEach(uid => {
      if (uid !== creadorId) {
        run(db, 'INSERT INTO grupo_miembros (grupo_id, usuario_id, rol, unirse_en) VALUES (?, ?, ?, ?)', [id, uid, 'miembro', creado_en]);
      }
    });
  }

  saveDatabase(db);

  res.json({ mensaje: 'Grupo creado', grupo: { id, nombre: nombre.trim(), creado_por: creadorId, creado_en } });
});

app.get('/api/grupos', autenticar, (req, res) => {
  const misGrupos = all(
    db,
    `
    SELECT g.*, COUNT(gm.usuario_id) as totalMiembros,
           MAX(CASE WHEN gm.usuario_id = ? AND gm.rol = 'admin' THEN 1 ELSE 0 END) as esAdmin
    FROM grupos g
    JOIN grupo_miembros gm ON g.id = gm.grupo_id
    WHERE gm.usuario_id = ?
    GROUP BY g.id
    `,
    [req.usuario.usuarioId, req.usuario.usuarioId]
  );

  res.json({ grupos: misGrupos });
});

app.get('/api/grupos/:id', autenticar, (req, res) => {
  const grupo = get(db, 'SELECT * FROM grupos WHERE id = ?', [req.params.id]);
  if (!grupo) {
    return res.status(404).json({ error: 'Grupo no encontrado' });
  }

  const esMiembro = get(
    db,
    'SELECT 1 FROM grupo_miembros WHERE grupo_id = ? AND usuario_id = ?',
    [grupo.id, req.usuario.usuarioId]
  );
  if (!esMiembro) {
    return res.status(403).json({ error: 'No eres miembro de este grupo' });
  }

  const grupoMiembros = all(
    db,
    `
    SELECT u.id as usuarioId, u.email, u.nombre, gm.rol
    FROM grupo_miembros gm
    JOIN usuarios u ON gm.usuario_id = u.id
    WHERE gm.grupo_id = ?
    `,
    [grupo.id]
  );

  res.json({ grupo: { ...grupo, miembros: grupoMiembros } });
});

app.post('/api/grupos/:id/miembros', autenticar, (req, res) => {
  const { usuarioId } = req.body;

  const grupo = get(db, 'SELECT * FROM grupos WHERE id = ?', [req.params.id]);
  if (!grupo) {
    return res.status(404).json({ error: 'Grupo no encontrado' });
  }

  const soyAdmin = get(
    db,
    "SELECT 1 FROM grupo_miembros WHERE grupo_id = ? AND usuario_id = ? AND rol = 'admin'",
    [grupo.id, req.usuario.usuarioId]
  );
  if (!soyAdmin) {
    return res.status(403).json({ error: 'Solo el administrador puede agregar miembros' });
  }

  const yaExiste = get(
    db,
    'SELECT 1 FROM grupo_miembros WHERE grupo_id = ? AND usuario_id = ?',
    [grupo.id, usuarioId]
  );
  if (yaExiste) {
    return res.status(409).json({ error: 'El usuario ya es miembro' });
  }

  const ahora = new Date().toISOString();
  run(db, 'INSERT INTO grupo_miembros (grupo_id, usuario_id, rol, unirse_en) VALUES (?, ?, ?, ?)', [grupo.id, usuarioId, 'miembro', ahora]);
  saveDatabase(db);

  res.json({ mensaje: 'Miembro agregado' });
});

// Contactos (todos los usuarios menos yo)
app.get('/api/contactos', autenticar, (req, res) => {
  const contactos = all(db, 'SELECT id, email, nombre, avatar FROM usuarios WHERE id != ?', [req.usuario.usuarioId]);
  res.json({ contactos });
});

// Subir foto de perfil (avatar)
app.post('/api/usuario/avatar', autenticar, upload.single('avatar'), (req, res) => {
  const archivo = req.file;
  const usuarioId = req.usuario.usuarioId;

  if (!archivo) {
    return res.status(400).json({ error: 'No se seleccionó ninguna imagen' });
  }

  // Validar que sea imagen
  const ext = path.extname(archivo.originalname).toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
    return res.status(400).json({ error: 'Solo se permiten imágenes (jpg, png, gif, webp)' });
  }

  const avatarUrl = `/uploads/${archivo.filename}`;

  run(db, 'UPDATE usuarios SET avatar = ? WHERE id = ?', [avatarUrl, usuarioId]);
  saveDatabase(db);

  res.json({ mensaje: 'Avatar actualizado', avatar: avatarUrl });
});

// Perfil
app.get('/api/perfil', autenticar, (req, res) => {
  const usuario = get(db, 'SELECT id, email, nombre, avatar, creado_en FROM usuarios WHERE id = ?', [req.usuario.usuarioId]);
  if (!usuario) {
    return res.status(404).json({ error: 'Usuario no encontrado' });
  }
  res.json({ usuario });
});

// Ruta raíz: servir la app (sin caché para evitar versiones viejas)
app.get('/', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// Guardar BD al cerrar proceso
process.on('SIGINT', () => {
  if (db) saveDatabase(db);
  process.exit(0);
});

// Inicializar base de datos y servidor con Socket.io
initDatabase().then(database => {
  db = database;

  // Crear servidor HTTP y adjuntar Socket.io
  server = http.createServer(app);
  io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  // Middleware de autenticación para Socket.io
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    const deviceCode = socket.handshake.auth?.deviceCode;

    if (!token) {
      return next(new Error('Token de acceso requerido'));
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.usuarioId = decoded.usuarioId;
      socket.email = decoded.email;

      // Verificar código de dispositivo si se proporciona
      if (deviceCode) {
        const dispositivo = get(
          db,
          'SELECT * FROM dispositivos WHERE codigo_unico = ? AND usuario_id = ?',
          [deviceCode, decoded.usuarioId]
        );
        if (!dispositivo) {
          return next(new Error('Código de dispositivo inválido'));
        }
      }

      next();
    } catch (err) {
      return next(new Error('Token inválido o expirado'));
    }
  });

  io.on('connection', (socket) => {
    const usuarioId = socket.usuarioId;
    usuarioSockets[usuarioId] = socket.id;

    // Unir al usuario a su sala personal
    socket.join(`usuario_${usuarioId}`);

    // Unir a salas de grupos donde es miembro
    const misGrupos = all(
      db,
      'SELECT grupo_id FROM grupo_miembros WHERE usuario_id = ?',
      [usuarioId]
    );
    misGrupos.forEach(g => {
      socket.join(`grupo_${g.grupo_id}`);
    });

    console.log(`Usuario conectado: ${usuarioId} (${socket.id})`);

    socket.on('disconnect', () => {
      delete usuarioSockets[usuarioId];
      console.log(`Usuario desconectado: ${usuarioId}`);
    });
  });

  server.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
    console.log(`Socket.io escuchando en puerto ${PORT}`);
    console.log(`Dominio empresa permitido: @${EMPRESA_DOMINIO}`);
    console.log(`Base de datos SQLite: ${DB_FILE}`);
    console.log(`Archivos en: ${UPLOADS_DIR}`);
  });
}).catch(err => {
  console.error('Error iniciando base de datos:', err);
  process.exit(1);
});

module.exports = app;
