
/*
  === BACKEND VISIÓN CALI 500+ ===
  Servidor robusto con Logging detallado para depuración.
*/

console.log("---------------------------------------------------");
console.log("🚀 [BACKEND] Iniciando script del servidor...");
console.log("---------------------------------------------------");

const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const { GridFsStorage } = require('multer-gridfs-storage');
const cors = require('cors');
const Grid = require('gridfs-stream');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

// 1. LOGGING DE PETICIONES (Middleware Global)
app.use((req, res, next) => {
    console.log(`📨 [REQUEST] ${req.method} ${req.originalUrl}`);
    console.log(`   👉 Origen: ${req.headers.origin || 'Desconocido'}`);
    next();
});

// 2. CONFIGURACIÓN CORS ROBUSTA
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Authorization, X-API-KEY, Origin, X-Requested-With, Content-Type, Accept, Access-Control-Allow-Request-Method');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.header('Allow', 'GET, POST, OPTIONS, PUT, DELETE');
    
    if (req.method === 'OPTIONS') {
        console.log(`✅ [CORS] Respondiendo OK a Preflight OPTIONS`);
        return res.sendStatus(200);
    }
    next();
});

app.use(express.json());

// 3. CONEXIÓN MONGODB ATLAS
const mongoURI = "mongodb+srv://Snei88:Sneider1112039944.@cluster0.1hhkn.mongodb.net/vision_cali_db?appName=Cluster0";

console.log("🔌 [DB] Intentando conectar a MongoDB Atlas...");

const conn = mongoose.createConnection(mongoURI, {
    serverSelectionTimeoutMS: 5000, 
    socketTimeoutMS: 45000,
});

let gfs, gridfsBucket;

conn.on('connected', () => {
    console.log('✅ [DB] ¡Conexión exitosa a MongoDB Atlas!');
    gridfsBucket = new mongoose.mongo.GridFSBucket(conn.db, {
        bucketName: 'uploads'
    });
    gfs = Grid(conn.db, mongoose.mongo);
    gfs.collection('uploads');
});

conn.on('error', (err) => {
    console.error('❌ [DB] Error crítico de conexión:', err.message);
});

conn.on('disconnected', () => {
    console.warn('⚠️ [DB] Desconectado de MongoDB');
});

// 4. CONFIGURACIÓN MULTER
const storage = new GridFsStorage({
    url: mongoURI,
    options: { useUnifiedTopology: true },
    file: (req, file) => {
        return new Promise((resolve, reject) => {
            console.log(`💾 [STORAGE] Preparando guardado para: ${file.originalname}`);
            const filename = `${Date.now()}_${file.originalname.replace(/\s+/g, '_')}`;
            const fileInfo = {
                filename: filename,
                bucketName: 'uploads'
            };
            resolve(fileInfo);
        });
    }
});

const upload = multer({ 
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }
});

// --- RUTAS ---

app.get('/', (req, res) => {
    console.log("👋 [ROOT] Visita a la raíz del servidor");
    res.send(`
        <div style="font-family: monospace; padding: 20px;">
            <h1>🚀 Backend Visión Cali 500+</h1>
            <p>Estado Servidor: <strong>ONLINE</strong></p>
            <p>Estado DB: <strong>${conn.readyState === 1 ? '🟢 CONECTADA' : '🔴 DESCONECTADA'}</strong></p>
            <hr>
            <p>Logs activos. Revisa la consola de Zeabur.</p>
        </div>
    `);
});

app.get('/api/health', (req, res) => {
    console.log(`💓 [HEALTH] Chequeo de salud solicitado. Estado DB: ${conn.readyState}`);
    res.json({ 
        status: 'online', 
        dbState: conn.readyState,
        message: conn.readyState === 1 ? 'System Operational' : 'DB Connecting...'
    });
});

app.post('/api/upload', (req, res) => {
    console.log("📤 [UPLOAD] Iniciando proceso de subida...");
    
    const uploadSingle = upload.single('file');

    uploadSingle(req, res, function (err) {
        if (err) {
            console.error('❌ [UPLOAD ERROR]', err);
            return res.status(500).json({ error: err.message });
        }

        if (!req.file) {
            console.warn('⚠️ [UPLOAD] Petición recibida pero sin archivo.');
            return res.status(400).json({ error: 'No se envió ningún archivo' });
        }

        console.log(`✅ [UPLOAD SUCCESS] Archivo guardado: ${req.file.filename}`);
        res.json({ 
            file: req.file, 
            message: 'Subida exitosa',
            filename: req.file.filename
        });
    });
});

app.get('/api/files/:filename', async (req, res) => {
    console.log(`📥 [DOWNLOAD] Solicitud para archivo: ${req.params.filename}`);
    try {
        if (!gridfsBucket) {
            console.error('❌ [DOWNLOAD] Bucket no inicializado (DB no lista)');
            return res.status(503).json({ error: 'DB no inicializada' });
        }

        const file = await gfs.files.findOne({ filename: req.params.filename });
        
        if (!file) {
            console.warn('⚠️ [DOWNLOAD] Archivo no encontrado en DB');
            return res.status(404).json({ error: 'Archivo no encontrado' });
        }

        let contentType = file.contentType || 'application/octet-stream';
        if(file.filename.endsWith('.pdf')) contentType = 'application/pdf';
        
        console.log(`✅ [DOWNLOAD] Enviando flujo de datos...`);
        res.set('Content-Type', contentType);
        res.set('Content-Disposition', `inline; filename="${file.filename}"`);

        const readStream = gridfsBucket.openDownloadStream(file._id);
        readStream.pipe(res);

    } catch (err) {
        console.error('🔥 [DOWNLOAD ERROR]', err);
        res.status(500).json({ error: 'Error descargando archivo' });
    }
});

app.listen(port, () => {
    console.log(`---------------------------------------------------`);
    console.log(`🚀 [SERVER] Servidor escuchando en el puerto ${port}`);
    console.log(`---------------------------------------------------`);
});
