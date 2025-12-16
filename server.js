/*
  === BACKEND VISIÓN CALI 500+ ===
  Servidor de Archivos y Base de Datos
*/

const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const cors = require('cors');
const { Readable } = require('stream'); 
require('dotenv').config();

const app = express();

// IMPORTANTE: Render asigna un puerto dinámico en process.env.PORT
const port = process.env.PORT || 8080; 

// --- CONFIGURACIÓN DE SEGURIDAD Y LOGS ---

// 1. Logging de Solicitudes (Auditoría básica)
app.use((req, res, next) => {
    // Solo loguear si no es un check de salud para no llenar la consola
    if (req.originalUrl !== '/api/health') {
        console.log(`📨 [${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
    }
    next();
});

// 2. CORS (Permitir conexión desde Vercel y Localhost)
app.use(cors({
    origin: '*', // En producción estricta, aquí pondrías tu dominio de Vercel
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// --- BASE DE DATOS ---

const mongoURI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/cali500";
// Ocultar contraseña en los logs
const safeMongoURI = mongoURI.includes('@') 
    ? mongoURI.replace(/:([^:@]+)@/, ':****@') 
    : 'mongodb://localhost...';

console.log("---------------------------------------------------");
console.log("🚀 [SERVER] Iniciando Backend Visión Cali 500+");
console.log(`🔌 [DB] Conectando a: ${safeMongoURI}`);
console.log("---------------------------------------------------");

const conn = mongoose.createConnection(mongoURI, {
    serverSelectionTimeoutMS: 5000,
});

let gridfsBucket;

conn.on('connected', () => {
    console.log('✅ [DB] ¡CONEXIÓN EXITOSA A MONGODB!');
    gridfsBucket = new mongoose.mongo.GridFSBucket(conn.db, {
        bucketName: 'uploads'
    });
});

conn.on('error', (err) => {
    console.error('❌ [DB ERROR] No se pudo conectar a la base de datos.');
    console.error('   Detalle:', err.message);
});

// --- SUBIDA DE ARCHIVOS (RAM) ---
const storage = multer.memoryStorage();
const upload = multer({ 
    storage,
    limits: { fileSize: 50 * 1024 * 1024 } // Límite de 50MB
});

// --- RUTAS ---

// Ruta raíz para verificar que el servidor vive
app.get('/', (req, res) => {
    res.status(200).send(`
        <h1>Backend Operativo</h1>
        <p>Servicio de gestión documental Visión Cali 500+</p>
        <p>Estado DB: ${conn.readyState === 1 ? 'Conectado 🟢' : 'Desconectado 🔴'}</p>
    `);
});

// Check de salud para el Frontend
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'online', 
        timestamp: new Date(),
        dbState: conn.readyState,
        service: 'Vision Cali API'
    });
});

// Subir Archivo
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se envió ningún archivo' });
    if (conn.readyState !== 1) return res.status(503).json({ error: 'Base de datos no disponible' });

    // Sanitizar nombre de archivo
    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filename = `${Date.now()}_${safeName}`;
    
    console.log(`📤 [UPLOAD] Iniciando carga: ${filename} (${(req.file.size / 1024 / 1024).toFixed(2)} MB)`);

    const readableStream = new Readable();
    readableStream.push(req.file.buffer);
    readableStream.push(null);

    const uploadStream = gridfsBucket.openUploadStream(filename, {
        contentType: req.file.mimetype,
        metadata: { originalName: req.file.originalname }
    });

    readableStream.pipe(uploadStream)
        .on('error', (error) => {
            console.error('❌ [UPLOAD ERROR]', error);
            return res.status(500).json({ error: 'Error interno al guardar archivo' });
        })
        .on('finish', () => {
            console.log(`✅ [UPLOAD OK] Archivo guardado correctamente.`);
            res.json({ 
                message: 'Archivo subido exitosamente',
                filename: filename,
                originalName: req.file.originalname,
                size: req.file.size
            });
        });
});

// Descargar Archivo
app.get('/api/files/:filename', async (req, res) => {
    try {
        if (!gridfsBucket || conn.readyState !== 1) return res.status(503).json({ error: 'Servicio no disponible' });

        const file = await conn.db.collection('uploads.files').findOne({ filename: req.params.filename });
        
        if (!file) return res.status(404).json({ error: 'Archivo no encontrado' });

        // Forzar descarga o visualización según tipo
        let contentType = file.contentType || 'application/octet-stream';
        if(file.filename.endsWith('.pdf')) contentType = 'application/pdf';
        
        res.set('Content-Type', contentType);
        // 'inline' permite verlo en el navegador, 'attachment' fuerza la descarga
        res.set('Content-Disposition', `inline; filename="${file.filename}"`);

        const readStream = gridfsBucket.openDownloadStream(file._id);
        readStream.pipe(res);

    } catch (err) {
        console.error('🔥 [DOWNLOAD ERROR]', err);
        res.status(500).json({ error: 'Error recuperando el archivo' });
    }
});

app.listen(port, () => {
    console.log(`\n🚀 [SERVIDOR LISTO] Escuchando solicitudes en puerto ${port}`);
});