import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// Serve static files from the current directory
app.use(express.static(__dirname));

// Explicitly serve preview.html on root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'preview.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
