import express from "express";
import puppeteer from "puppeteer";

const app = express();
const PORT = process.env.PORT || 8080;

app.get("/render", async (req, res) => {
    try {
        const browser = await puppeteer.launch({
            headless: "new",
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--use-gl=swiftshader",   // ⭐ CRITICAL
                "--enable-webgl",
                "--ignore-gpu-blocklist"
            ]
        });

        const page = await browser.newPage();

        await page.setViewport({
            width: 1920,
            height: 1080
        });

        console.log("Opening site...");

        await page.goto(
            "https://map-animator-4a34c.web.app/",
            { waitUntil: "networkidle2" }
        );

        await page.waitForSelector("canvas");

        const output = "/tmp/test.png";

        await page.screenshot({
            path: output
        });

        await browser.close();

        console.log("✅ Screenshot captured");

        res.sendFile(output);

    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

app.listen(PORT, () => {
    console.log("Server running on", PORT);
});
