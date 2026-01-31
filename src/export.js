import { storage, ref, uploadBytes, getDownloadURL } from './firebase.js';

// ✅ CLIENT-SIDE VIDEO EXPORT
// Now properly awaits the full journey animation
window.startExport = async function () {
    // 0. Validate Inputs FIRST
    const inputs = document.querySelectorAll('.location-input');
    let cities = Array.from(inputs).map(input => input.value.trim()).filter(val => val !== '');
    if (cities.length < 2) {
        alert("Please enter a start and end location first!");
        return;
    }

    // Collect travel modes from the UI
    const modeSelects = document.querySelectorAll('.travel-mode');
    const modes = Array.from(modeSelects).map(s => s.value);

    const overlay = document.getElementById("renderOverlay");
    overlay.style.display = "flex";
    overlay.innerText = "Preparing export...";

    const canvas = document.querySelector("canvas");
    const mapContainer = document.getElementById("map");

    /*
    ==============================
    PICK QUALITY HERE
    ==============================
    */
    const width = 1920;  // 1080p Full HD
    const height = 1080;

    // 1. Hide UI
    document.body.classList.add("rendering");

    // 2. Resize CONTAINER (Mapbox Best Practice)
    const originalWidth = mapContainer.style.width;
    const originalHeight = mapContainer.style.height;

    mapContainer.style.width = `${width}px`;
    mapContainer.style.height = `${height}px`;

    if (window.map) {
        map.resize();
        // Force center to prevent cropping
        map.jumpTo({ center: map.getCenter(), zoom: map.getZoom() });

        // Wait for map to fully idle (tiles loaded)
        await new Promise(resolve => {
            map.once('idle', resolve);
            // Backup timeout in case idle takes too long
            setTimeout(resolve, 5000);
        });
    }

    /*
    ==============================
    RECORD FROM CANVAS
    ==============================
    */
    const fps = 60;

    const stream = canvas.captureStream(fps);

    // Try to use MP4 format, fall back to WebM if not supported
    let mimeType = "video/webm;codecs=vp9";
    if (MediaRecorder.isTypeSupported("video/mp4")) {
        mimeType = "video/mp4";
    } else if (MediaRecorder.isTypeSupported("video/webm;codecs=h264")) {
        mimeType = "video/webm;codecs=h264";
    }

    const recorder = new MediaRecorder(stream, {
        mimeType: mimeType,
        videoBitsPerSecond: 8_000_000  // 8 Mbps for 1080p
    });

    const chunks = [];

    recorder.ondataavailable = e => chunks.push(e.data);

    const recordingDonePromise = new Promise(resolve => {
        recorder.onstop = async () => {
            // Restore UI and Map Size
            document.body.classList.remove("rendering");
            mapContainer.style.width = originalWidth || '';
            mapContainer.style.height = originalHeight || '';
            map.resize();

            overlay.innerText = "Uploading to Firebase... 📤";

            const blob = new Blob(chunks, { type: mimeType });

            try {
                // Upload to Firebase Storage
                const timestamp = Date.now();
                const filename = `renders/globe-${timestamp}.mp4`;
                const storageRef = ref(storage, filename);

                await uploadBytes(storageRef, blob);
                const downloadURL = await getDownloadURL(storageRef);

                overlay.style.display = "none";

                // Show in modal
                const modal = document.getElementById("video-modal");
                const player = document.getElementById("preview-player");
                const downloadBtn = document.getElementById("download-preview");
                const closeBtn = document.getElementById("close-preview");

                player.src = downloadURL;
                modal.style.display = "flex";

                downloadBtn.onclick = async () => {
                    try {
                        downloadBtn.innerText = "Downloading...";
                        const response = await fetch(downloadURL);
                        const blob = await response.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `globe-video-${Date.now()}.mp4`;
                        document.body.appendChild(a);
                        a.click();
                        window.URL.revokeObjectURL(url);
                        document.body.removeChild(a);
                        downloadBtn.innerText = "Download ⬇️";
                    } catch (e) {
                        console.error(e);
                        alert("Download failed. Please try again.");
                        downloadBtn.innerText = "Download ⬇️";
                    }
                };

                closeBtn.onclick = () => {
                    modal.style.display = "none";
                    player.src = "";
                };

                resolve();
            } catch (error) {
                console.error("Upload failed:", error);
                overlay.innerText = "Upload failed. Click to close.";
                overlay.onclick = () => {
                    overlay.style.display = "none";
                    overlay.onclick = null;
                };
                resolve();
            }
        };
    });

    /*
    ==============================
    START RECORDING & JOURNEY
    ==============================
    */
    recorder.start();
    overlay.innerText = "Recording video... 🎬";

    console.log("Exporting flight for:", cities, "with modes:", modes);

    // Build segments array from UI (same as Preview button does)
    // startFlightAutomatically now accepts segments or city names
    // We'll pass city names for simplicity - modes are applied if we pass full segments
    // Let's geocode and build proper segments to respect modes

    try {
        // Geocode cities
        const coordinates = [];
        for (const city of cities) {
            // Use the same geocoding as main.js (via window or inline fetch)
            const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(city)}.json?access_token=${window.mapboxgl?.accessToken || import.meta.env.VITE_MAPBOX_TOKEN}&limit=1`;
            const resp = await fetch(url);
            const data = await resp.json();
            if (data.features && data.features[0]) {
                coordinates.push(data.features[0].center);
            } else {
                throw new Error(`Could not geocode: ${city}`);
            }
        }

        // Build segments with modes
        const segments = [];
        for (let i = 0; i < coordinates.length - 1; i++) {
            segments.push({
                start: coordinates[i],
                end: coordinates[i + 1],
                mode: modes[i] || 'flight'
            });
        }

        // Start the journey animation and AWAIT it
        await window.startFlightAutomatically(segments);

        // Animation complete! Stop recording
        console.log("✅ Animation complete, stopping recorder");
        recorder.stop();

        // Wait for upload to complete
        await recordingDonePromise;

    } catch (e) {
        console.error("Export error:", e);
        alert("Export failed: " + e.message);
        recorder.stop();
        overlay.style.display = "none";
        document.body.classList.remove("rendering");
        mapContainer.style.width = originalWidth || '';
        mapContainer.style.height = originalHeight || '';
        if (window.map) map.resize();
    }
};

