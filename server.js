import express from "express";
import puppeteer from "puppeteer";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
import cors from "cors";
import admin from "firebase-admin";

// Initialize Firebase Admin (Auto-discovers credentials in Cloud Run)
if (!admin.apps.length) {
    admin.initializeApp();
}

const bucket = admin.storage().bucket();

// Fix __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Explicit CORS config
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    credentials: true
}));

app.options('*', cors());

app.use(express.json({ limit: "10mb" }));

// Serves the static build of the app
app.use(express.static(path.join(__dirname, 'dist')));

const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;

// Simple Concurrency Lock
let isRendering = false;

app.post("/render", async (req, res) => {
    if (isRendering) {
        return res.status(429).json({ error: "Renderer is busy. Please try again in a minute." });
    }

    isRendering = true;

    try {
        const { route = ["Dubai", "Sydney"], duration = 20 } = req.body;
        console.log(`🎥 Starting render for route: ${route.join(" -> ")} (${duration}s)`);

        const TOTAL_FRAMES = FPS * duration;
        const TMP_DIR = process.env.K_SERVICE ? "/tmp" : "./tmp";
        const FRAMES_DIR = path.join(TMP_DIR, "frames");
        const OUTPUT = path.join(TMP_DIR, "output.mp4");

        // Cleanup previous run
        if (fs.existsSync(FRAMES_DIR)) fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
        if (fs.existsSync(OUTPUT)) fs.rmSync(OUTPUT, { force: true });
        fs.mkdirSync(FRAMES_DIR, { recursive: true });

        const browser = await puppeteer.launch({
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH, // Use installed Chrome
            headless: "new",
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--use-gl=egl"
            ]
        });

        const page = await browser.newPage();
        await page.setViewport({ width: WIDTH, height: HEIGHT });

        const port = process.env.PORT || 8080;
        await page.goto(`http://localhost:${port}`);

        // FIX 1: Wait for Mapbox fully loaded signal
        await page.waitForFunction(() => window.mapLoaded === true, { timeout: 60000 });

        // Hide UI
        await page.evaluate(() => {
            const ui = document.querySelector('#planner');
            if (ui) ui.style.display = 'none';
            const controls = document.querySelector('.mapboxgl-control-container');
            if (controls) controls.style.display = 'none';
            document.body.style.cursor = "none";
        });

        // Start flight
        await page.evaluate((cities) => {
            if (window.startFlightAutomatically) {
                window.startFlightAutomatically(cities);
            }
        }, route);

        console.log("📸 Capturing frames...");

        for (let i = 0; i < TOTAL_FRAMES; i++) {
            const t = i / FPS;

            await page.evaluate((time) => {
                window.renderFrame?.(time);
            }, t);

            // FIX 2: GPU Flush Wait
            await new Promise(r => setTimeout(r, 8));

            await page.screenshot({
                path: path.join(FRAMES_DIR, `frame_${String(i).padStart(5, "0")}.png`)
            });

            if (i % 30 === 0) console.log(`   Frame ${i}/${TOTAL_FRAMES}`);
        }

        await browser.close();

        console.log("🎬 Encoding video...");

        await new Promise((resolve, reject) => {
            ffmpeg()
                .input(path.join(FRAMES_DIR, "frame_%05d.png"))
                .inputFPS(FPS)
                .setFfmpegPath(ffmpegPath)
                .outputOptions(["-c:v libx264", "-pix_fmt yuv420p", "-crf 18", "-preset fast"])
                .save(OUTPUT)
                .on("end", resolve)
                .on("error", reject);
        });

        console.log("☁️ Uploading to Firebase Storage...");

        const destination = `videos/flight-${Date.now()}.mp4`;

        await bucket.upload(OUTPUT, {
            destination,
            metadata: { contentType: "video/mp4" }
        });

        const [url] = await bucket.file(destination).getSignedUrl({
            action: "read",
            expires: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
        });

        console.log("✅ Render Success! URL:", url);

        // FIX 3: Return JSON URL
        res.json({ url });

        // Cleanup Disk
        fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
        fs.rmSync(OUTPUT, { force: true });

    } catch (err) {
        console.error("RENDER ERROR:", err);
        res.status(500).json({ error: err.message });
    } finally {
        isRendering = false; // Release lock
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Render Server running on port ${PORT}`);
});
