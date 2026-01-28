// camera.js
// 🎬 All cinematic camera behavior lives here
// Angle locked • Smooth zooms • Cinematic travel

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function ease(t) {
    return t * t * (3 - 2 * t); // smoothstep
}

export function createCamera(map) {

    /* =====================================================
       🎯 GLOBAL CAMERA SETTINGS
    ===================================================== */
    const SETTINGS = {
        pitch: 30,            // 🔒 fixed angle (never changes)
        bearing: 0,           // 🔒 fixed rotation
        introZoomStart: 0.7,
        introZoomEnd: 1.2,
        focusZoom: 6,
        introDuration: 2200,
        focusDuration: 2200
    };


    /* =====================================================
       🌍 FULL GLOBE INTRO  (ORIGINAL — untouched)
    ===================================================== */
    async function intro(center) {
        console.log("🎬 Camera Intro triggered");

        map.flyTo({
            center,
            zoom: 0.8,
            pitch: 20,
            bearing: 0,
            duration: 2000,
            essential: true
        });

        await sleep(2000);
    }


    /* =====================================================
       🎯 FOCUS CITY (smooth cinematic zoom-in)
    ===================================================== */
    async function focus(coords, zoom = SETTINGS.focusZoom) {
        console.log("🎬 Focus", coords);

        map.easeTo({
            center: coords,
            zoom,
            pitch: SETTINGS.pitch,
            bearing: SETTINGS.bearing,
            duration: SETTINGS.focusDuration,
            easing: t => 1 - Math.pow(1 - t, 3)
        });

        await sleep(SETTINGS.focusDuration);
    }


    /* =====================================================
       🌍 OUTRO (return to globe like intro)
    ===================================================== */
    async function outro(center) {
        console.log("🎬 Outro (return to globe)");

        map.easeTo({
            center,
            zoom: 0.8,     // same as intro
            pitch: 20,     // same as intro
            bearing: 0,
            duration: 2000,
            easing: t => 1 - Math.pow(1 - t, 3)
        });

        await sleep(2000);
    }


    return {
        intro,
        focus,
        outro
    };
}
