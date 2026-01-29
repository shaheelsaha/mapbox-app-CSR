// camera.js
// 🎬 All cinematic camera behavior lives here
// Angle locked • Smooth zooms • Cinematic travel

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function ease(t) {
    return t * t * (3 - 2 * t); // smoothstep
}

// 🔥 Distance calculator (Haversine)
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
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
       🎯 AUTO ZOOM (based on distance)
    ===================================================== */
    function getAutoZoom(start, end) {
        const km = getDistanceFromLatLonInKm(
            start[1], start[0],
            end[1], end[0]
        );

        if (km < 50) return 11;
        if (km < 300) return 8;
        if (km < 1500) return 5;
        return 2.5;
    }


    /* =====================================================
       🚀 MOVE TO SEGMENT (smart zoom + smooth transition)
    ===================================================== */
    async function moveToSegment(start, end, pitch = SETTINGS.pitch) {
        const zoom = getAutoZoom(start, end);

        map.easeTo({
            center: start,
            zoom,
            pitch,
            duration: 1200
        });

        await sleep(1200);
    }


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


    /* =====================================================
       🎬 PLAY JOURNEY (full cinematic experience)
    ===================================================== */
    async function playJourney(segments, driveHandler, flyHandler) {
        if (!segments || segments.length === 0) return;

        // 1. INTRO
        await intro(segments[0].start);
        await sleep(1000);

        // 2. LOOP SEGMENTS
        for (const leg of segments) {
            // 🎬 camera handles zoom automatically
            await moveToSegment(leg.start, leg.end);

            if (leg.mode === 'drive') {
                map.setLayoutProperty('plane-layer', 'icon-image', 'car-icon');
                map.setLayoutProperty('plane-layer', 'icon-size', 0.2);
                await driveHandler(leg.start, leg.end);
            } else {
                map.setLayoutProperty('plane-layer', 'icon-image', 'plane-icon');
                map.setLayoutProperty('plane-layer', 'icon-size', 0.15);
                await flyHandler(leg.start, leg.end);
            }

            await sleep(500);
        }

        await sleep(500);

        // 3. OUTRO
        await outro(segments[segments.length - 1].end);

        // Hide vehicle after animation
        map.setLayoutProperty('plane-layer', 'icon-size', 0);
    }


    /* =====================================================
       🎬 FOLLOW CAMERA (MAIN ENGINE)
       Smooth continuous camera — no cuts ever
    ===================================================== */
    function followPath(getPosition, options = {}) {

        const SETTINGS = {
            zoom: options.zoom ?? 5,
            pitch: options.pitch ?? 35,
            bearing: 0,
            smooth: 0.12
        };

        // FIX: always use [lng, lat] array (not LngLat object)
        let current = map.getCenter().toArray();

        function frame() {

            const target = getPosition();

            if (!target) {
                requestAnimationFrame(frame);
                return;
            }

            const [clng, clat] = current;
            const [tlng, tlat] = target;

            current = [
                clng + (tlng - clng) * SETTINGS.smooth,
                clat + (tlat - clat) * SETTINGS.smooth
            ];

            map.jumpTo({
                center: current,
                zoom: SETTINGS.zoom,
                pitch: SETTINGS.pitch,
                bearing: SETTINGS.bearing
            });

            requestAnimationFrame(frame);
        }

        frame();
    }


    return {
        intro,
        focus,
        moveToSegment,
        outro,
        playJourney,
        followPath   // 🔥 NEW
    };
}
