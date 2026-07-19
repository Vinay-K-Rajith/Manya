import * as path from 'path';
import * as fs from 'fs';
import express from 'express';
import { app } from './app';

const port = process.env.PORT || 3000;

// Local single-port mode: serve the built client alongside the API.
// On Vercel the client is served from the CDN and this file never runs.
const clientDistPath = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));

  // SPA routing: unmatched paths fall through to index.html
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
  console.log(`Serving client static files from: ${clientDistPath}`);
} else {
  console.log('Client build directory not found. Server running in API-only mode.');
}

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
