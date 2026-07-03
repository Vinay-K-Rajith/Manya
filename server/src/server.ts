import * as path from 'path';
import * as fs from 'fs';
import { app } from './app';

const port = process.env.PORT || 3000;

// Serve Frontend Static Assets in Production (local/non-Vercel deployments)
const clientDistPath = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDistPath)) {
  app.use(require('express').static(clientDistPath));

  // Single port SPA routing
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
