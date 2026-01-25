import express from "express";
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import cors from "cors";
import admin from "firebase-admin";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

/* -------------------------------------------------- */
/* 🔹 Config */
/* -------------------------------------------------- */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 8080;
const PUBLIC_URL = "https://map-animator-4a34c.web.app/"; // ⭐ Hosting URL

const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;

/* -------------------------------------------------- */
/* 🔹 Firebase */
/* -------------------------------------------------- */

if (!admin.apps.length) {
    admin.initializeApp({
        storageBucket: "map-animator-4a34c.firebasestorage.app"
    });
}
const bucket = admin.storage().bucket();

/* -------------------------------------------------- */
/* 🔹 Express App */
/* -------------------------------------------------- */

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Serve static build if needed (local fallback), but main renderer uses public URL
app.use(express.static(path.join(__dirname, "dist")));

let isRendering = false;

/* -------------------------------------------------- */
/* 🔹 Render Logic */
/* -------------------------------------------------- */

app.post("/render", async (req, res) => {
    if (isRendering) {
        return res.status(429).json({ error: "Renderer busy. Try again." });
    }

    isRendering = true;

    try {
        const { route = ["Dubai", "Tokyo"], duration = 20 } = req.body;
        console.log("🎬 Render request:", route);

        const TOTAL_FRAMES = FPS * duration;

        // Always use /tmp on Cloud Run (K_SERVICE), fallback to ./tmp locally
        const TMP_DIR = process.env.K_SERVICE ? "/tmp" : path.join(__dirname, "tmp");
        const FRAMES_DIR = path.join(TMP_DIR, "frames");
        const OUTPUT = path.join(TMP_DIR, "output.mp4");

        // Cleanup
        if (fs.existsSync(FRAMES_DIR)) fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
        if (fs.existsSync(OUTPUT)) fs.rmSync(OUTPUT, { force: true });
        fs.mkdirSync(FRAMES_DIR, { recursive: true });

        // Launch Chromium
        const launchArgs = [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage"
        ];

        // Only use SwiftShader on Cloud Run (headless CPU environment)
        if (process.env.K_SERVICE) {
            launchArgs.push("--use-gl=swiftshader");
        }

        const browser = await puppeteer.launch({
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
            headless: "new",
            args: launchArgs
        });

        const page = await browser.newPage();

        // Log browser errors
        page.on("console", msg => console.log("BROWSER:", msg.text()));
        page.on("pageerror", err => console.log("PAGE ERROR:", err));

        await page.setViewport({ width: WIDTH, height: HEIGHT });

        console.log("🌍 Opening site:", PUBLIC_URL);

        // Load Public Site
        await page.goto(PUBLIC_URL, { waitUntil: "networkidle2", timeout: 120000 });

        // Wait for Canvas (Mapbox)
        await page.waitForSelector("canvas", { timeout: 60000 });
        console.log("✅ Canvas detected. Map loaded.");

        // 🟢 WAIT for the global function to be exposed (fixes race conditions)
        try {
            await page.waitForFunction(() => typeof window.startFlightAutomatically === 'function', { timeout: 30000 });
            console.log("✅ Function 'startFlightAutomatically' found!");
        } catch (e) {
            console.error("❌ Timed out waiting for startFlightAutomatically!");
        }

        // Start Flight
        await page.evaluate((cities) => {
            if (window.startFlightAutomatically) {
                window.startFlightAutomatically(cities);
            } else {
                console.error("❌ window.startFlightAutomatically NOT FOUND even after wait!");
            }
        }, route);

        console.log("📸 Capturing frames...");

        // Capture Frames
        for (let i = 0; i < TOTAL_FRAMES; i++) {
            const t = i / FPS; // Time in seconds

            await page.evaluate((time) => {
                if (window.renderFrame) window.renderFrame(time);
            }, t);

            await page.screenshot({
                path: path.join(FRAMES_DIR, `frame_${String(i).padStart(4, "0")}.png`),
                type: "png"
            });

            // Log progress occasionally
            if (i % 30 === 0) console.log(`Frame ${i}/${TOTAL_FRAMES}`);
        }

        await browser.close();

        // Sanity Check: Log number of frames captured
        const frameCount = fs.readdirSync(FRAMES_DIR).length;
        console.log(`📊 Sanity Check: Found ${frameCount} frames in ${FRAMES_DIR}`);

        console.log("🎞 Encoding video with ffmpeg...");

        // Encode using ffmpeg (using system ffmpeg installed in Docker)
        // STRICT PATH FIX: Use absolute path for input to avoid confusion
        execSync(
            `ffmpeg -y -framerate ${FPS} -i ${path.join(FRAMES_DIR, "frame_%04d.png")} -pix_fmt yuv420p ${OUTPUT}`
        );

        console.log("✅ Video saved. Uploading...");

        // Upload to Firebase
        const filename = `videos/flight-${Date.now()}.mp4`;
        await bucket.upload(OUTPUT, {
            destination: filename,
            metadata: { contentType: "video/mp4" }
        });

        const [url] = await bucket.file(filename).getSignedUrl({
            action: "read",
            expires: Date.now() + 24 * 60 * 60 * 1000
        });

        console.log("🚀 Success:", url);
        res.json({ url });

    } catch (err) {
        console.error("❌ Render Error:", err);
        res.status(500).json({ error: err.message });
    } finally {
        isRendering = false;
    }
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Render Server running on port ${PORT}`);
});
