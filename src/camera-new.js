export function createCamera(map) {

    let mode = "idle"; // intro | follow | outro | idle
    let running = false;

    let getPosition = null;
    let getDistance = null;
    let currentMode = "flight";

    let center = map.getCenter().toArray();
    let zoom = map.getZoom();

    let introTarget = null;
    let outroTarget = null;

    let phaseStart = 0;
    let phaseDuration = 0;

    const SETTINGS = {
        smooth: 0.06,
        zoomSmooth: 0.03,
        pitch: 0
    };

    function ease(t) {
        return t * t * (3 - 2 * t);
    }

    function frame(now) {
        if (!running) return;

        // =========================
        // INTRO / OUTRO animation
        // =========================
        // =========================
        // INTRO animation
        // =========================
        if (mode === "intro") {

            const t = Math.min((now - phaseStart) / phaseDuration, 1);
            const target = introTarget;

            // 🎬 INTRO: Just center the globe on start location
            // Let follow mode's km-based zoom logic handle the zoom smoothly

            // Ease-in: start very slow, gradually speed up
            const easeIn = t * t;
            const panSpeed = 0.01 + easeIn * 0.06;

            // Slowly pan center toward target
            center = [
                center[0] + (target[0] - center[0]) * panSpeed,
                center[1] + (target[1] - center[1]) * panSpeed
            ];

            map.jumpTo({
                center,
                zoom: 2,      // 🌍 stay at globe view
                pitch: 0,
                bearing: 0
            });

            if (t >= 1) {
                mode = "follow"; // follow mode will handle zoom based on km
            }

            requestAnimationFrame(frame);
            return;
        }

        // =========================
        // OUTRO animation
        // =========================
        if (mode === "outro") {

            const t = Math.min((now - phaseStart) / phaseDuration, 1);
            const e = ease(t);

            const target = outroTarget;

            // keep centered on final location
            center = [
                center[0] + (target[0] - center[0]) * 0.05,
                center[1] + (target[1] - center[1]) * 0.05
            ];

            // zoom out to globe view
            const targetZoom = 2;
            zoom += (targetZoom - zoom) * 0.05;

            // small slow rotation for drama
            const spin = t * 60;

            map.jumpTo({
                center,
                zoom,
                pitch: 0,
                bearing: 0 // 🔒 locked - no rotation
            });

            if (t >= 1) {
                running = false;
                return;
            }

            requestAnimationFrame(frame);
            return;
        }

        // =========================
        // FOLLOW animation
        // =========================
        if (mode === "follow" && getPosition) {

            const target = getPosition();

            if (target) {
                center = [
                    center[0] + (target[0] - center[0]) * SETTINGS.smooth,
                    center[1] + (target[1] - center[1]) * SETTINGS.smooth
                ];

                const km = getDistance ? getDistance() : 1000;

                let targetZoom;

                if (currentMode === "flight") {

                    // 🌍 ultra long haul (space view)
                    if (km > 25000) targetZoom = 1.2;
                    else if (km > 20000) targetZoom = 1.4;
                    else if (km > 15000) targetZoom = 1.6;
                    else if (km > 10000) targetZoom = 1.8;

                    // 🌎 continent
                    else if (km > 5000) targetZoom = 2.2;

                    // 🌏 country
                    else if (km > 2000) targetZoom = 2.8;

                    // 🗺 region
                    else if (km > 1000) targetZoom = 3.5;

                    // 🏙 metro
                    else if (km > 500) targetZoom = 4.2;

                    // 🛬 approach
                    else if (km > 100) targetZoom = 5;

                    // landing
                    else targetZoom = 6;
                }
                else if (currentMode === "train") {
                    if (km > 10000) targetZoom = 2;
                    else if (km > 8000) targetZoom = 3;
                    else if (km > 5000) targetZoom = 4;
                    else if (km > 2000) targetZoom = 5;
                    else if (km > 1000) targetZoom = 6;
                    else if (km > 500) targetZoom = 7;
                    else if (km > 250) targetZoom = 8;
                    else if (km > 100) targetZoom = 9;
                    else if (km > 50) targetZoom = 10;
                    else if (km > 20) targetZoom = 12;
                    else if (km > 5) targetZoom = 14;
                    else targetZoom = 16;
                }
                else { // car (long distance cinematic zoom)
                    if (km > 10000) targetZoom = 1.5;   // full globe
                    else if (km > 8000) targetZoom = 2;
                    else if (km > 5000) targetZoom = 3;
                    else if (km > 2000) targetZoom = 4;
                    else if (km > 1000) targetZoom = 5;
                    else if (km > 500) targetZoom = 6;
                    else if (km > 250) targetZoom = 7;
                    else if (km > 100) targetZoom = 8;
                    else if (km > 50) targetZoom = 9;
                    else if (km > 20) targetZoom = 11;
                    else if (km > 5) targetZoom = 13;
                    else targetZoom = 16; // street close
                }

                zoom += (targetZoom - zoom) * SETTINGS.zoomSmooth;
            }
        }

        map.jumpTo({
            center,
            zoom,
            pitch: SETTINGS.pitch
        });

        requestAnimationFrame(frame);
    }

    // =========================
    // PUBLIC API
    // =========================

    function startFollow(posFn, distFn, modeName) {
        getPosition = posFn;
        getDistance = distFn;
        currentMode = modeName;
        mode = "follow";
    }

    function playIntro(targetLngLat, duration = 3000) {

        introTarget = targetLngLat;

        phaseStart = performance.now();
        phaseDuration = duration;

        mode = "intro";

        if (!running) {
            running = true;
            requestAnimationFrame(frame);
        }
    }

    function playOutro(targetLngLat, duration = 2500) {
        outroTarget = targetLngLat;
        phaseStart = performance.now();
        phaseDuration = duration;
        mode = "outro";
    }

    function startOrbit() {
        mode = "orbit";

        if (!running) {
            running = true;
            requestAnimationFrame(frame);
        }
    }

    return {
        playIntro,
        startFollow,
        playOutro,
        startOrbit   // 👈 NEW
    };
}
