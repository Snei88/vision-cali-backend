const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const { GridFsStorage } = require('multer-gridfs-storage');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// 1. Conexión a MongoDB Atlas
// NOTA: He limpiado los caracteres '<' y '>' de la contraseña y agregado el nombre de la DB 'vision_cali_db'
const mongoURI = "mongodb+srv://Snei88:Sneider1112039944.@cluster0.1hhkn.mongodb.net/vision_cali_db?appName=Cluster0";

const conn = mongoose.createConnection(mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Inicializar GridFS (Sistema de archivos de Mongo)
let gfs, gridfsBucket;

conn.once('open', () => {
  gridfsBucket = new mongoose.mongo.GridFSBucket(conn.db, {
    bucketName: 'uploads'
  });
  gfs = Grid(conn.db, mongoose.mongo);
  gfs.collection('uploads');
  console.log('✅ Conectado a MongoDB Atlas y GridFS inicializado');
});

// 2. Configurar Motor de Almacenamiento (Storage Engine)
const storage = new GridFsStorage({
  url: mongoURI,
  file: (req, file) => {
    return {
      filename: `${Date.now()}-vis-cali-${file.originalname}`,
      bucketName: 'uploads' // Coincide con la colección
    };
  }
});

const upload = multer({ storage });

// --- RUTAS DE LA API ---

// 0. Health Check (Para verificar estado desde el Frontend)
app.get('/api/health', (req, res) => {
  const dbState = mongoose.connection.readyState; // 0: disconnected, 1: connected
  res.json({ 
    status: 'ok', 
    message: 'Backend Online',
    dbConnected: conn.readyState === 1 
  });
});

// A. Subir Archivo (Soporta archivos grandes por stream)
app.post('/api/upload', upload.single('file'), (req, res) => {
  if(!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });
  
  res.json({ 
    file: req.file, 
    message: 'Archivo subido exitosamente a Atlas' 
  });
});

// B. Descargar Archivo (Stream directo desde Mongo al navegador)
app.get('/api/files/:filename', async (req, res) => {
  try {
    const file = await gfs.files.findOne({ filename: req.params.filename });
    
    if (!file) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    // Check if image or pdf to set correct header
    if (file.contentType === 'application/pdf' || file.contentType === 'image/jpeg' || file.contentType === 'image/png') {
       res.set('Content-Type', file.contentType);
    } else {
       res.set('Content-Disposition', `attachment; filename="${file.filename}"`);
    }

    const readStream = gridfsBucket.openDownloadStream(file._id);
    readStream.pipe(res);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// C. Eliminar Archivo
app.delete('/api/files/:id', async (req, res) => {
  try {
    await gridfsBucket.delete(new mongoose.Types.ObjectId(req.params.id));
    res.json({ message: 'Archivo eliminado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Iniciar Servidor
app.listen(port, () => console.log(`🚀 Servidor Backend corriendo en puerto ${port}`));

// Helper function for GridFS stream
const Grid = require('gridfs-stream');
