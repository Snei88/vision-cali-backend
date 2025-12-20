
/*
  === BACKEND VISIÓN CALI 500+ ===
  Servidor Unificado con Gestión de Archivos y Cuotas de Almacenamiento
*/

const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const cors = require('cors');
const { Readable } = require('stream'); 
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080; 

// --- MIDDLEWARE ---
app.use((req, res, next) => {
    if (req.originalUrl !== '/api/health') {
        console.log(`📨 [${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
    }
    next();
});

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }));
app.use(express.json({ limit: '30mb' })); // Aumentado para soportar base64 si es necesario

// --- MONGODB CONNECTION ---
const mongoURI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/cali500";
const conn = mongoose.createConnection(mongoURI, { serverSelectionTimeoutMS: 5000 });
let gridfsBucket;
let InstrumentModel;

// --- SCHEMAS (Tu versión completa) ---
const InstrumentSchema = new mongoose.Schema({
    id: { type: Number, required: true, unique: true },
    nombre: { type: String, required: true },
    tipo: String,
    eje: String,
    inicio: Number,
    fin: mongoose.Schema.Types.Mixed,
    temporalidad: mongoose.Schema.Types.Mixed,
    estado: String,
    seguimiento: String,
    observatorio: String,
    enlace: String,
    pdf_informe: String,
    description: String,
    archivo_nombre: String,
    archivo_base64: String,
    archivo_tipo: String,
    archivo_analisis_nombre: String,
    archivo_analisis_base64: String,
    archivo_analisis_tipo: String,
    archivo_ley_nombre: String,
    archivo_ley_base64: String,
    archivo_ley_tipo: String
}, { strict: false, collection: 'instruments' });

conn.on('connected', () => {
    console.log('✅ [DB] Conectado exitosamente a MongoDB');
    gridfsBucket = new mongoose.mongo.GridFSBucket(conn.db, { bucketName: 'uploads' });
    InstrumentModel = conn.model('Instrument', InstrumentSchema);
});

conn.on('error', (err) => console.error('❌ [DB ERROR]', err.message));

// --- UPLOAD CONFIG ---
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// --- ROUTES ---

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'online', 
        db: conn.readyState === 1 ? 1 : 0,
        mode: conn.readyState === 1 ? 'cloud' : 'waiting'
    });
});

// 1. Obtener todos los instrumentos
app.get('/api/instruments', async (req, res) => {
    if (conn.readyState !== 1) return res.status(503).json([]);
    try {
        const instruments = await InstrumentModel.find({}).sort({ id: 1 });
        res.json(instruments);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 2. Guardar/Actualizar con gestión de cuota (Lógica de espacio infinito local)
app.post('/api/instruments', async (req, res) => {
    if (conn.readyState !== 1) return res.status(503).json({ error: 'DB offline' });
    try {
        const item = req.body;
        const { _id, ...updateData } = item; // Limpiamos el ID interno de Mongo

        const result = await InstrumentModel.findOneAndUpdate(
            { id: item.id },
            updateData,
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        res.json(result);
    } catch (e) {
        // Detectar si el almacenamiento gratuito de MongoDB Atlas se llenó
        if (e.message.toLowerCase().includes('quota') || e.message.toLowerCase().includes('storage')) {
            console.warn("⚠️ [CUOTA] El servidor MongoDB está lleno. Avisando al frontend para usar modo local.");
            return res.status(507).json({ error: 'DB_FULL' });
        }
        res.status(500).json({ error: e.message });
    }
});

// 3. Eliminar Instrumento
app.delete('/api/instruments/:id', async (req, res) => {
    try {
        await InstrumentModel.deleteOne({ id: Number(req.params.id) });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 4. Mantenimiento: Purga total
app.delete('/api/instruments/purge', async (req, res) => {
    try {
        await InstrumentModel.deleteMany({});
        const files = await conn.db.collection('uploads.files').find().toArray();
        for (const file of files) {
            await gridfsBucket.delete(file._id);
        }
        res.json({ success: true, message: 'Servidor vaciado para liberar espacio.' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 5. Subida de Archivos con detección de cuota
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    if (conn.readyState !== 1) return res.status(503).json({ error: 'DB offline' });

    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filename = `${Date.now()}_${safeName}`;
    
    const uploadStream = gridfsBucket.openUploadStream(filename, {
        contentType: req.file.mimetype,
        metadata: { originalName: req.file.originalname }
    });

    const readable = new Readable();
    readable.push(req.file.buffer);
    readable.push(null);

    readable.pipe(uploadStream)
        .on('error', (e) => {
            if (e.message.toLowerCase().includes('quota') || e.message.toLowerCase().includes('storage')) {
                res.status(507).json({ error: 'DB_FULL' });
            } else {
                res.status(500).json({ error: e.message });
            }
        })
        .on('finish', () => {
            res.json({ filename, originalName: req.file.originalname });
        });
});

// 6. Descarga de Archivos
app.get('/api/files/:filename', async (req, res) => {
    try {
        if (!gridfsBucket) return res.status(503).send('Servicio no disponible');
        const file = await conn.db.collection('uploads.files').findOne({ filename: req.params.filename });
        if (!file) return res.status(404).send('Archivo no encontrado');

        res.set('Content-Type', file.contentType || 'application/pdf');
        gridfsBucket.openDownloadStream(file._id).pipe(res);
    } catch (err) {
        res.status(500).send('Error recuperando archivo');
    }
});

app.listen(port, () => console.log(`🚀 Servidor Visión Cali 500+ activo en puerto ${port}`));
