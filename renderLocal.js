import puppeteer from "puppeteer";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import fs from "fs";

const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;
const DURATION = 20;

const TOTAL_FRAMES = FPS * DURATION;

const FRAMES_DIR = "./frames";
const OUTPUT = "./output.mp4";

(async () => {

    fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
    fs.mkdirSync(FRAMES_DIR);

    const browser = await puppeteer.launch({
        headless: "new"
    });

    const page = await browser.newPage();

    await page.setViewport({ width: WIDTH, height: HEIGHT });

    await page.goto("http://localhost:5173");
    await page.waitForSelector("#map");

    // Hide UI elements for cleaner video
    await page.evaluate(() => {
        const ui = document.querySelector('#planner');
        if (ui) ui.style.display = 'none';
        document.body.style.cursor = "none";
    });

    // Start flight logic
    await page.evaluate(async () => {
        if (window.startFlightAutomatically) {
            await window.startFlightAutomatically();
        }
    });

    console.log("Rendering frames...");

    for (let i = 0; i < TOTAL_FRAMES; i++) {

        const time = i / FPS;

        await page.evaluate((t) => {
            window.renderFrame?.(t);
        }, time);

        await page.screenshot({
            path: `${FRAMES_DIR}/frame_${String(i).padStart(5, "0")}.png`
        });
    }

    await browser.close();

    console.log("Encoding video...");

    ffmpeg()
        .input(`${FRAMES_DIR}/frame_%05d.png`)
        .inputFPS(FPS)
        .setFfmpegPath(ffmpegPath)
        .outputOptions([
            "-c:v libx264",
            "-pix_fmt yuv420p",
            "-crf 18"
        ])
        .save(OUTPUT)
        .on("end", () => {
            console.log("✅ Done! Saved to output.mp4");
        });

})();
