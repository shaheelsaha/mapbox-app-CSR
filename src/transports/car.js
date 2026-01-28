
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}


export async function drive(map, start, end, pathHistory = []) {

    console.log("🚗 Driving:", start, "→", end);

    // 1. Force Car Icon
    if (map.getLayer('plane-layer')) {
        map.setLayoutProperty('plane-layer', 'icon-image', 'car-icon');
    }

    // 2. Fetch Route
    async function getDrivingRoute(s, e) {
        const token = 'pk.eyJ1Ijoic2hhaGVlbDU1IiwiYSI6ImNta2Q0cTNqZTA2cGszZ3M2dzVucDdsOGwifQ.WGhIdum-usVYkJJZOfr9UA';
        const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${s[0]},${s[1]};${e[0]},${e[1]}?geometries=geojson&overview=full&access_token=${token}`;
        const res = await fetch(url);
        const data = await res.json();
        return data.routes[0].geometry.coordinates;
    }

    const fullPath = await getDrivingRoute(start, end);
    const routeSource = map.getSource('route');
    const carSource = map.getSource('plane-source');

    const duration = 10000;
    const startTime = performance.now();

    // Camera Settings
    const SETTINGS = {
        zoom: 5, // Closer for car
        pitch: 45,
        bearing: 0
    };

    return new Promise(resolve => {
        function frame(now) {
            let t = (now - startTime) / duration;
            if (t > 1) t = 1;

            const progress = t * (fullPath.length - 1);
            const i = Math.floor(progress);
            const frac = progress - i;
            const p1 = fullPath[i];
            const p2 = fullPath[Math.min(i + 1, fullPath.length - 1)];

            const lng = p1[0] + (p2[0] - p1[0]) * frac;
            const lat = p1[1] + (p2[1] - p1[1]) * frac;

            /* 🦅 eagle camera */
            map.easeTo({
                center: [lng, lat],
                zoom: SETTINGS.zoom,
                pitch: SETTINGS.pitch,
                bearing: SETTINGS.bearing,
                duration: 80,
                easing: x => x
            });

            /* bearing */
            const dLng = p2[0] - p1[0];
            const dLat = p2[1] - p1[1];
            const angle = Math.atan2(dLat, dLng) * 180 / Math.PI;

            if (carSource) {
                carSource.setData({
                    type: 'Feature',
                    properties: { bearing: angle }, // Handled by layout in main.js
                    geometry: {
                        type: 'Point',
                        coordinates: [lng, lat]
                    }
                });
            }

            // Progressive Line Drawing
            if (routeSource) {
                // Slice up to current integer index + 1
                const currentSegments = fullPath.slice(0, i + 1);
                // Can we add the interpolated point? Yes for super smooth.
                // But appending the raw segments is safer for now.
                const currentFull = [...pathHistory, ...currentSegments];

                routeSource.setData({
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: currentFull
                    }
                });
            }

            if (t < 1) {
                requestAnimationFrame(frame);
            } else {
                // Return accumulated history
                resolve([...pathHistory, ...fullPath]);
            }
        }
        requestAnimationFrame(frame);
    });
}
