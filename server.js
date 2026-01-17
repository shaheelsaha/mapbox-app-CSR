import express from 'express';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { renderVideo } from './render.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors()); // Enable CORS for all origins
app.use(express.static(__dirname));
app.use(express.json());

// Public URL for assets (Cloud Run URL or localhost)
// We need to pass this to the renderer so it can load assets via http
// Using request headers to determine host
const getBaseUrl = (req) => `${req.protocol}://${req.get('host')}`;

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'preview.html'));
});

app.post('/render', async (req, res) => {
    try {
        const routeData = req.body;
        if (!routeData || !Array.isArray(routeData)) {
            return res.status(400).send("Invalid route data. Expected an array of cities.");
        }

        console.log("Received render request for cities:", routeData.length);

        const timestamp = Date.now();
        const outputPath = path.join(__dirname, `output_${timestamp}.mp4`);
        const baseUrl = getBaseUrl(req); // e.g., http://localhost:8080

        // Increase timeout for this request if possible (Cloud Run limits apply)
        // Note: Client connection might timeout so client needs to handle long-polling or waits.
        // For now, we wait and stream at the end.

        const videoPath = await renderVideo(routeData, outputPath, baseUrl);

        console.log("Video generated at:", videoPath);

        // Stream back the file
        res.sendFile(videoPath, (err) => {
            if (err) {
                console.error("Error sending file:", err);
            } else {
                // Delete file after sending
                fs.unlink(videoPath, (e) => {
                    if (e) console.log("Failed to cleanup video:", e);
                });
            }
        });

    } catch (e) {
        console.error("Render failed:", e);
        res.status(500).send("Render failed: " + e.message);
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
