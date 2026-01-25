import express from "express";
import puppeteer from "puppeteer";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import fs from "fs";
import path from "path";
import cors from "cors";
import admin from "firebase-admin";
import { fileURLToPath } from "url";

/* -------------------------------------------------- */
/* 🔹 Setup Paths */
/* -------------------------------------------------- */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* -------------------------------------------------- */
/* 🔹 Firebase (Cloud Run auto auth) */
/* -------------------------------------------------- */

if (!admin.apps.length) {
    admin.initializeApp({
        storageBucket: "map-animator-4a34c.firebasestorage.app"
    });
}

const bucket = admin.storage().bucket();

/* -------------------------------------------------- */
/* 🔹 Express */
/* -------------------------------------------------- */

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// serve built frontend (dist folder)
app.use(express.static(path.join(__dirname, "dist")));

/* -------------------------------------------------- */
/* 🔹 Config */
/* -------------------------------------------------- */

const WIDTH = 1920; // change to 3840 for 4K
const HEIGHT = 1080;
const FPS = 30;

let isRendering = false;

/* -------------------------------------------------- */
/* 🔹 Render Endpoint */
/* -------------------------------------------------- */

app.post("/render", async (req, res) => {

    if (isRendering) {
        return res.status(429).json({ error: "Renderer busy. Try again." });
    }

    isRendering = true;

    try {
        const { route = ["Dubai", "Sydney"], duration = 20 } = req.body;

        console.log("� Render request:", route);

        const TOTAL_FRAMES = FPS * duration;

        const TMP_DIR = process.env.K_SERVICE ? "/tmp" : "./tmp";
        const FRAMES_DIR = path.join(TMP_DIR, "frames");
        const OUTPUT = path.join(TMP_DIR, "output.mp4");

        /* ---------- cleanup ---------- */

        fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
        fs.mkdirSync(FRAMES_DIR, { recursive: true });

        /* ---------- launch chromium ---------- */

        const browser = await puppeteer.launch({
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH, // system chromium
            headless: "new",
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--single-process",
                "--no-zygote"
            ]
        });

        const page = await browser.newPage();

        await page.setViewport({
            width: WIDTH,
            height: HEIGHT
        });

        /* -------------------------------------------------- */
        /* ⭐ CRITICAL FIX: load LOCAL FILE (NOT URL)         */
        /* -------------------------------------------------- */

        const filePath = `file://${path.join(__dirname, "dist/index.html")}`;

        console.log("📂 Loading:", filePath);

        await page.goto(filePath, {
            waitUntil: "load",
            timeout: 0
        });

        /* ---------- wait for map ---------- */

        await page.waitForFunction(() => window.mapLoaded === true);

        /* ---------- start flight ---------- */

        await page.evaluate((cities) => {
            window.startFlightAutomatically(cities);
        }, route);

        console.log("📸 Capturing frames...");

        /* ---------- capture frames ---------- */

        for (let i = 0; i < TOTAL_FRAMES; i++) {

            const t = i / FPS;

            await page.evaluate(time => {
                window.renderFrame(time);
            }, t);

            await page.screenshot({
                path: path.join(FRAMES_DIR, `frame_${String(i).padStart(5, "0")}.jpg`),
                type: "jpeg",
                quality: 95
            });

            if (i % 30 === 0) {
                console.log(`Frame ${i}/${TOTAL_FRAMES}`);
            }
        }

        await browser.close();

        console.log("� Encoding video...");

        /* ---------- encode ---------- */

        await new Promise((resolve, reject) => {
            ffmpeg()
                .input(path.join(FRAMES_DIR, "frame_%05d.jpg"))
                .inputFPS(FPS)
                .setFfmpegPath(ffmpegPath)
                .outputOptions([
                    "-c:v libx264",
                    "-pix_fmt yuv420p",
                    "-crf 18",
                    "-preset fast"
                ])
                .save(OUTPUT)
                .on("end", resolve)
                .on("error", reject);
        });

        console.log("☁️ Uploading to Firebase...");

        /* ---------- upload ---------- */

        const filename = `videos/flight-${Date.now()}.mp4`;

        await bucket.upload(OUTPUT, {
            destination: filename,
            metadata: { contentType: "video/mp4" }
        });

        const [url] = await bucket.file(filename).getSignedUrl({
            action: "read",
            expires: Date.now() + 24 * 60 * 60 * 1000
        });

        console.log("✅ Done:", url);

        res.json({ url });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
    finally {
        isRendering = false;
    }
});

/* -------------------------------------------------- */
/* 🔹 Start Server */
/* -------------------------------------------------- */

const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Renderer running on port ${PORT}`);
});
