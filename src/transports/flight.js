// flight.js
export async function fly(map, start, end, createArc, pathHistory = []) {

    const arc = createArc(start, end, 150);
    const points = arc.geometry.coordinates;

    const planeSource = map.getSource('plane-source');
    const routeSource = map.getSource('route');

    let i = 0;

    // 🔒 SETTINGS (exposed globally for manual control)
    const SETTINGS = window.flightSettings = {
        zoom: 4,
        pitch: 35,
        bearing: 0,
        speed: 1      // 👈 Change via console: window.flightSettings.speed = 1
    };

    return new Promise(resolve => {

        function frame() {

            if (i >= points.length) {
                // Return updated history (previous + this leg)
                resolve([...pathHistory, ...points]);
                return;
            }

            const [lng, lat] = points[i];

            window.currentPos = [lng, lat];

            // 1. Update Plane Icon
            const next = points[i + 1] || points[i];
            const angle = Math.atan2(next[0] - lng, next[1] - lat) * 180 / Math.PI;

            if (planeSource) {
                planeSource.setData({
                    type: 'Feature',
                    properties: {
                        bearing: angle // Handled by layout in main.js now
                    },
                    geometry: {
                        type: 'Point',
                        coordinates: [lng, lat]
                    }
                });
            }

            // 2. Progressive Line Drawing (Indiana Jones Style)
            if (routeSource) {
                const currentPath = [...pathHistory, ...points.slice(0, i + 1)];
                routeSource.setData({
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: currentPath
                    }
                });
            }

            i += SETTINGS.speed;
            requestAnimationFrame(frame);
        }

        frame();
    });
}
