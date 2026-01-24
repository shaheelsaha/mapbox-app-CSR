import express from "express";
import puppeteer from "puppeteer";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
import cors from "cors";

// Fix __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Explicit CORS config
app.use(cors({
    origin: '*', // Allow all origins (including localhost)
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    credentials: true
}));

app.options('*', cors()); // Enable pre-flight for all routes

app.use(express.json({ limit: "10mb" }));

// Serves the static build of the app (needed so Puppeteer can visit localhost)
app.use(express.static(path.join(__dirname, 'dist')));

const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;

app.post("/render", async (req, res) => {
    // Default to Dubai -> Sydney if no route provided
    const { route = ["Dubai", "Sydney"], duration = 20 } = req.body;

    console.log(`🎥 Starting render for route: ${route.join(" -> ")} (${duration}s)`);

    const TOTAL_FRAMES = FPS * duration;

    // In Cloud Run, write to /tmp. Locally, write to ./tmp
    const TMP_DIR = process.env.K_SERVICE ? "/tmp" : "./tmp";
    const FRAMES_DIR = path.join(TMP_DIR, "frames");
    const OUTPUT = path.join(TMP_DIR, "output.mp4");

    try {
        if (fs.existsSync(FRAMES_DIR)) fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
        fs.mkdirSync(FRAMES_DIR, { recursive: true });

        const browser = await puppeteer.launch({
            headless: "new",
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--use-gl=egl" // Hardware acceleration for WebGL in container
            ]
        });

        const page = await browser.newPage();

        await page.setViewport({ width: WIDTH, height: HEIGHT });

        // Visit the app served by THIS express server (localhost)
        // Ensure PORT is set
        const port = process.env.PORT || 8080;
        await page.goto(`http://localhost:${port}`);

        // Wait for map loaded signal (we should add this to main.js if not present, or wait for #map)
        await page.waitForSelector("#map");

        // Hide UI for clean render
        await page.evaluate(() => {
            const ui = document.querySelector('#planner');
            if (ui) ui.style.display = 'none';
            const controls = document.querySelector('.mapboxgl-control-container');
            if (controls) controls.style.display = 'none';
            document.body.style.cursor = "none";
        });

        // Start flight via exposed API
        await page.evaluate((cities) => {
            if (window.startFlightAutomatically) {
                window.startFlightAutomatically(cities);
            } else {
                console.error("❌ window.startFlightAutomatically not found!");
            }
        }, route);

        console.log("📸 Capturing frames...");

        // Deterministic Render Loop
        for (let i = 0; i < TOTAL_FRAMES; i++) {
            const t = i / FPS;

            await page.evaluate((time) => {
                window.renderFrame?.(time);
            }, t);

            // Small buffer to ensure WebGL repaint (if needed)
            // with deterministic rendering usually not needed but 1ms is safe
            // await new Promise(r => setTimeout(r, 1)); 

            await page.screenshot({
                path: path.join(FRAMES_DIR, `frame_${String(i).padStart(5, "0")}.png`)
            });

            // Log progress every second (30 frames)
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

        console.log("✅ Video generated!");

        // Send file back
        res.download(OUTPUT, "flight.mp4", (err) => {
            if (err) console.error("Error sending file:", err);
            // Cleanup happens after response? Or we can leave it for next run (Cloud Run usually cleans up /tmp on restart)
        });

    } catch (err) {
        console.error("RENDER ERROR:", err);
        res.status(500).send("Render failed: " + err.message);
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 Render Server running on port ${PORT}`);
});
