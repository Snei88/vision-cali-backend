/*
  === BACKEND VISIÓN CALI 500+ ===
  Servidor de Archivos y Base de Datos (Sincronizado)
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
app.use(express.json({ limit: '10mb' })); // Aumentado límite para JSON grandes si es necesario

// --- MONGODB CONNECTION ---
const mongoURI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/cali500";
const safeMongoURI = mongoURI.includes('@') ? mongoURI.replace(/:([^:@]+)@/, ':****@') : 'mongodb://localhost...';

console.log("---------------------------------------------------");
console.log("🚀 [SERVER] Iniciando Backend Visión Cali 500+");
console.log(`🔌 [DB] Conectando a: ${safeMongoURI}`);

const conn = mongoose.createConnection(mongoURI, { serverSelectionTimeoutMS: 5000 });
let gridfsBucket;
let InstrumentModel;

// --- SCHEMAS ---
const InstrumentSchema = new mongoose.Schema({
    id: { type: Number, required: true, unique: true },
    nombre: String,
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
    // Campos de Archivos
    archivo_nombre: String,
    archivo_base64: String,
    archivo_tipo: String,
    archivo_analisis_nombre: String,
    archivo_analisis_base64: String,
    archivo_analisis_tipo: String,
    archivo_ley_nombre: String,
    archivo_ley_base64: String,
    archivo_ley_tipo: String
}, { strict: false, collection: 'instruments' }); // 'strict: false' para flexibilidad futura

conn.on('connected', () => {
    console.log('✅ [DB] Conectado exitosamente');
    gridfsBucket = new mongoose.mongo.GridFSBucket(conn.db, { bucketName: 'uploads' });
    InstrumentModel = conn.model('Instrument', InstrumentSchema);
});

conn.on('error', (err) => console.error('❌ [DB ERROR]', err.message));

// --- UPLOAD CONFIG ---
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// --- ROUTES ---

app.get('/', (req, res) => res.send(`<h1>API Visión Cali 500+</h1><p>DB State: ${conn.readyState}</p>`));

app.get('/api/health', (req, res) => res.json({ status: 'online', dbState: conn.readyState }));

// 1. OBTENER TODOS LOS INSTRUMENTOS
app.get('/api/instruments', async (req, res) => {
    if (conn.readyState !== 1) return res.status(503).json([]);
    try {
        const instruments = await InstrumentModel.find({}).sort({ id: 1 });
        res.json(instruments);
    } catch (e) {
        console.error("Error fetching instruments:", e);
        res.status(500).json({ error: e.message });
    }
});

// 2. GUARDAR/ACTUALIZAR UN INSTRUMENTO
app.post('/api/instruments', async (req, res) => {
    if (conn.readyState !== 1) return res.status(503).json({ error: 'DB offline' });
    try {
        const item = req.body;
        if (!item.id) return res.status(400).json({ error: 'ID is required' });

        const result = await InstrumentModel.findOneAndUpdate(
            { id: item.id },
            item,
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        res.json(result);
    } catch (e) {
        console.error("Error saving instrument:", e);
        res.status(500).json({ error: e.message });
    }
});

// 3. SEED INICIAL (Para cuando la DB está vacía)
app.post('/api/instruments/seed', async (req, res) => {
    if (conn.readyState !== 1) return res.status(503).json({ error: 'DB offline' });
    try {
        const count = await InstrumentModel.countDocuments();
        if (count > 0) return res.json({ message: 'DB already has data', count });

        const data = req.body;
        if (!Array.isArray(data)) return res.status(400).json({ error: 'Data must be an array' });

        await InstrumentModel.insertMany(data);
        console.log(`🌱 [SEED] Base de datos poblada con ${data.length} registros.`);
        res.json({ success: true, count: data.length });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 4. ELIMINAR INSTRUMENTO
app.delete('/api/instruments/:id', async (req, res) => {
    try {
        await InstrumentModel.deleteOne({ id: req.params.id });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 5. SUBIR ARCHIVO (GridFS)
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    if (conn.readyState !== 1) return res.status(503).json({ error: 'DB offline' });

    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filename = `${Date.now()}_${safeName}`;
    
    console.log(`📤 [UPLOAD] ${filename}`);

    const uploadStream = gridfsBucket.openUploadStream(filename, {
        contentType: req.file.mimetype,
        metadata: { originalName: req.file.originalname }
    });

    const readable = new Readable();
    readable.push(req.file.buffer);
    readable.push(null);

    readable.pipe(uploadStream)
        .on('error', (e) => res.status(500).json({ error: e.message }))
        .on('finish', () => res.json({ filename, originalName: req.file.originalname }));
});

// 6. DESCARGAR ARCHIVO
app.get('/api/files/:filename', async (req, res) => {
    try {
        if (!gridfsBucket) return res.status(503).json({ error: 'Service unavailable' });
        const file = await conn.db.collection('uploads.files').findOne({ filename: req.params.filename });
        if (!file) return res.status(404).json({ error: 'File not found' });

        let contentType = file.contentType || 'application/octet-stream';
        if(file.filename.endsWith('.pdf')) contentType = 'application/pdf';
        
        res.set('Content-Type', contentType);
        res.set('Content-Disposition', `inline; filename="${file.filename}"`);
        gridfsBucket.openDownloadStream(file._id).pipe(res);
    } catch (err) {
        res.status(500).json({ error: 'Error retrieving file' });
    }
});

app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
