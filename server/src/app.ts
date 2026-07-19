import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { generateExcel, TabSpecRow, HeaderBanner } from './excelGen';
const { buildAP } = require('./engine/apEngine');

export const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Uploads are held in memory rather than on disk: the serverless function has no
// writable filesystem, and questionnaires are small enough to buffer.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

app.post('/api/parse', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Study-agnostic engine: segment -> title -> base filter.
    const questions = await buildAP(req.file.buffer);
    res.json({ questions });
  } catch (error: any) {
    console.error('Error parsing document:', error);
    res.status(500).json({ error: error.message || 'Failed to parse questionnaire' });
  }
});

app.post('/api/generate', async (req, res) => {
  try {
    const { tabSpec, banners } = req.body as {
      tabSpec: TabSpecRow[];
      banners: HeaderBanner[];
    };

    if (!tabSpec || !banners) {
      return res.status(400).json({ error: 'Missing tabSpec or banners parameters' });
    }

    const buffer = await generateExcel(tabSpec, banners);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=Analysis_Plan.xlsx');
    res.send(buffer);
  } catch (error: any) {
    console.error('Error generating Excel:', error);
    res.status(500).json({ error: error.message || 'Failed to generate Excel' });
  }
});
