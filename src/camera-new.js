// camera-new.js
// 🎬 TRUE SINGLE-SHOT CAMERA (no cuts ever)

export function createCamera(map) {

    let running = false;

    function start(getPosition, options = {}) {

        const SETTINGS = {
            zoomStart: 1,      // intro zoom (far)
            zoomFollow: 5,     // normal zoom
            pitch: 40,
            smooth: 0.08
        };

        let zoom = SETTINGS.zoomStart;
        let current = map.getCenter().toArray();

        running = true;

        function frame() {

            if (!running) return;

            const target = getPosition();

            if (target) {

                const [clng, clat] = current;
                const [tlng, tlat] = target;

                // smooth follow
                current = [
                    clng + (tlng - clng) * SETTINGS.smooth,
                    clat + (tlat - clat) * SETTINGS.smooth
                ];

                // smooth zoom-in (intro blend)
                zoom += (SETTINGS.zoomFollow - zoom) * 0.02;

                map.jumpTo({
                    center: current,
                    zoom,
                    pitch: SETTINGS.pitch,
                    bearing: 0
                });
            }

            requestAnimationFrame(frame);
        }

        frame();
    }

    function stop() {
        running = false;
    }

    return { start, stop };
}
