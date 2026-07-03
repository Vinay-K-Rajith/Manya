import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { generateExcel, TabSpecRow, HeaderBanner } from './excelGen';
// New study-agnostic engine (segmenter + title + base-filter + self-check)
const { buildAP } = require('./engine/apEngine');

export const app = express();

// Enable CORS for development
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Set up Multer for memory storage of file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// 1. File Upload & Parsing Endpoint
app.post('/api/parse', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Study-agnostic engine: segment -> title -> base-filter -> self-check
    const questions = await buildAP(req.file.buffer);
    res.json({ questions });
  } catch (error: any) {
    console.error('Error parsing document:', error);
    res.status(500).json({ error: error.message || 'Failed to parse questionnaire' });
  }
});

// 2. Excel Generation Endpoint
app.post('/api/generate', async (req, res) => {
  try {
    const { tabSpec, banners, templateName } = req.body as {
      tabSpec: TabSpecRow[];
      banners: HeaderBanner[];
      templateName?: string;
    };

    if (!tabSpec || !banners) {
      return res.status(400).json({ error: 'Missing tabSpec or banners parameters' });
    }

    // Call ExcelJS generation (templateDir is unused now, kept for signature compatibility)
    const buffer = await generateExcel('', tabSpec, banners, templateName);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=Analysis_Plan.xlsx');
    res.send(buffer);
  } catch (error: any) {
    console.error('Error generating Excel:', error);
    res.status(500).json({ error: error.message || 'Failed to generate Excel' });
  }
});
