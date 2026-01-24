import './style.css';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

// Token from environment variables
mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

// 1. Arc Generator Function
function createArc(start, end, steps = 200, height = 50) {
    const points = [];
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        // linear interpolation
        const lng = start[0] + (end[0] - start[0]) * t;
        const lat = start[1] + (end[1] - start[1]) * t;
        // add curve (parabolic height)
        const curve = Math.sin(Math.PI * t) * height * 0.02;
        points.push([lng, lat + curve]);
    }
    return points;
}

const map = new mapboxgl.Map({
    container: 'map', // container ID
    style: 'mapbox://styles/shaheel55/cmkkb8oxs000w01qw84c8ao3n', // style URL
    center: [-34, 38], // starting position [lng, lat]
    zoom: 2, // starting zoom
    projection: 'globe' // Display the map as a globe, since zoom is low
});

map.on('load', () => {
    map.setFog({
        color: 'rgb(186, 210, 235)', // Lower atmosphere
        'high-color': 'rgb(36, 92, 223)', // Upper atmosphere
        'horizon-blend': 0.02, // Atmosphere thickness (default 0.2 at low zooms)
        'space-color': 'rgb(11, 11, 25)', // Background color
        'star-intensity': 0.6 // Background star brightness (default 0.35 at low zooms)
    });

    map.resize();

    // ⭐ Final plane marker setup (Symbol Layer)
    map.loadImage('/plane.png', (error, image) => {
        if (error) throw error;
        if (!map.hasImage('plane')) map.addImage('plane', image);
    });

    map.addSource('plane-source', {
        type: 'geojson',
        data: {
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [0, 0] // initial
            }
        }
    });

    map.addLayer({
        id: 'plane-layer',
        type: 'symbol',
        source: 'plane-source',
        layout: {
            'icon-image': 'plane',
            'icon-size': 0.05, // Adjusted for 1024px PNG
            'icon-rotate': ['+', ['get', 'bearing'], -45],
            'icon-rotation-alignment': 'map',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true
        }
    });
});

// 3. Flight Planner Logic

// Store selected coordinates to avoid re-fetching
const selectedCoordinates = new Map();

// Helper: Setup Autocomplete for an input group
function setupAutocomplete(inputGroup) {
    const input = inputGroup.querySelector('.location-input');
    const suggestionsDiv = inputGroup.querySelector('.suggestions');
    let debounceTimer;

    input.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        clearTimeout(debounceTimer);

        if (query.length < 3) {
            suggestionsDiv.classList.remove('visible');
            return;
        }

        debounceTimer = setTimeout(async () => {
            const results = await fetchSuggestions(query);
            showSuggestions(results, suggestionsDiv, input);
        }, 300);
    });

    // Hide suggestions on click outside
    document.addEventListener('click', (e) => {
        if (!inputGroup.contains(e.target)) {
            suggestionsDiv.classList.remove('visible');
        }
    });
}

async function fetchSuggestions(query) {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${mapboxgl.accessToken}&types=place,country,locality&limit=5`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        return data.features || [];
    } catch (error) {
        console.error('Error fetching suggestions:', error);
        return [];
    }
}

function showSuggestions(features, container, input) {
    container.innerHTML = '';
    if (features.length === 0) {
        container.classList.remove('visible');
        return;
    }

    features.forEach(feature => {
        const div = document.createElement('div');
        div.className = 'suggestion-item';
        div.textContent = feature.place_name;
        div.addEventListener('click', () => {
            input.value = feature.place_name;
            container.classList.remove('visible');
            // Store coordinates for this input text
            selectedCoordinates.set(feature.place_name, feature.center);
        });
        container.appendChild(div);
    });

    container.classList.add('visible');
}

// Helper: Geocode a city name to [lng, lat] (Fallback if not selected from dropdown)
async function geocodeCity(query) {
    // Check if we already have it
    if (selectedCoordinates.has(query)) {
        return selectedCoordinates.get(query);
    }

    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${mapboxgl.accessToken}&limit=1`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.features && data.features.length > 0) {
            return data.features[0].center;
        }
        throw new Error('Location not found');
    } catch (error) {
        alert(`Could not find location: "${query}"`);
        return null;
    }
}

// Initialize autocomplete for existing inputs
document.querySelectorAll('.input-group').forEach(setupAutocomplete);

// UI Event Listeners
document.getElementById('add-stop').addEventListener('click', () => {
    const inputsDiv = document.getElementById('inputs');
    const newGroup = document.createElement('div');
    newGroup.className = 'input-group';
    newGroup.innerHTML = `
        <input type="text" placeholder="Stop Location (e.g. London)" class="location-input" autocomplete="off">
        <div class="suggestions"></div>
    `;
    inputsDiv.appendChild(newGroup);
    setupAutocomplete(newGroup);
});

document.getElementById('generate-flight').addEventListener('click', async () => {
    const inputs = document.querySelectorAll('.location-input');
    const cities = Array.from(inputs).map(input => input.value.trim()).filter(val => val !== '');

    if (cities.length < 2) {
        alert('Please enter at least a start and end location.');
        return;
    }

    // Geocode all cities (sequentially to maintain order)
    const coordinates = [];
    for (const city of cities) {
        const coord = await geocodeCity(city);
        if (!coord) return;
        coordinates.push(coord);
    }

    // Generate multi-segment arc
    let fullPath = [];
    const segments = []; // Store segment metadata for animation

    for (let i = 0; i < coordinates.length - 1; i++) {
        const start = coordinates[i];
        const end = coordinates[i + 1];
        const segmentArc = createArc(start, end, 200, 40); // Increased steps and height

        const startIndex = fullPath.length;
        fullPath = fullPath.concat(segmentArc);
        const endIndex = fullPath.length - 1;

        segments.push({ start: startIndex, end: endIndex });
    }

    // Update Route Source
    const routeSource = map.getSource('route');
    const geoJsonData = {
        type: 'Feature',
        geometry: {
            type: 'LineString',
            coordinates: []
        }
    };

    if (routeSource) {
        routeSource.setData(geoJsonData);
    } else {
        map.addSource('route', {
            type: 'geojson',
            data: geoJsonData
        });
        map.addLayer({
            id: 'route-line',
            type: 'line',
            source: 'route',
            paint: {
                'line-color': '#FFD166',
                'line-width': 3,
                'line-opacity': 0.9,
                'line-blur': 1
            }
        });
    }

    // Start Animation Sequence
    startCinematicFlight(coordinates, fullPath, segments);
});

// Export Video Logic
document.getElementById('export-video').addEventListener('click', async () => {
    const btn = document.getElementById('export-video');
    const OriginalText = btn.textContent;
    btn.textContent = "Recording... (Wait) 🔴";
    btn.disabled = true;

    // Use the generate flight logic but with recording
    // Trigger the same inputs as generate
    const inputs = document.querySelectorAll('.location-input');
    const cities = Array.from(inputs).map(input => input.value.trim()).filter(val => val !== '');

    if (cities.length < 2) {
        alert('Please enter at least a start and end location.');
        btn.textContent = OriginalText;
        btn.disabled = false;
        return;
    }

    // Capture canvas stream
    const canvas = document.querySelector('canvas');
    if (!canvas) {
        alert('Map canvas not found');
        return;
    }

    const stream = canvas.captureStream(30); // 30 FPS
    const mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp9' });
    const chunks = [];

    mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'flight-video.webm';
        a.click();
        URL.revokeObjectURL(url);

        btn.textContent = OriginalText;
        btn.disabled = false;
        alert("Video exported! Check your downloads 📂");
    };

    mediaRecorder.start();

    // Run the flight logic again (duplicate logic for now, ideally refactor later if needing DRY)
    // For quick implementation, I'll programmatically click the generate button? 
    // No, that would trigger standard animation without knowing when to stop.
    // I need a way to hook into "animation finished".

    // Changing approach: Programmatically trigger generate, but hook into startCinematicFlight completion?
    // startCinematicFlight doesn't return a promise. 

    // SIMPLE HACK: Calculate total duration + buffer and stop recording then.

    // 1. Calculate duration
    // We need coordinates first.
    // Re-run geocoding here to get duration.
    const coordinates = [];
    for (const city of cities) {
        const coord = await geocodeCity(city);
        if (!coord) {
            mediaRecorder.stop();
            return;
        }
        coordinates.push(coord);
    }

    // Duplicate path gen logic needed?
    // Let's just run startCinematicFlight and guess duration.

    // Actually, startCinematicFlight takes (waypoints, fullPath, segments).
    // I should refactor the click handler to be reusable.
    // Ideally user clicks "Export", we run the setup, start recording, start flight, then stop after duration.

    // Let's manually trigger the flight generation logic by calling the existing logic
    // But I can't easily wait for it.

    // Better: Just click "Generate" programmatically?
    document.getElementById('generate-flight').click();

    // Estimate Duration: (cities - 1) * 8000ms + 2000ms buffer
    const duration = (cities.length - 1) * 8000 + 3000;

    setTimeout(() => {
        mediaRecorder.stop();
    }, duration);

});

function startCinematicFlight(waypoints, fullPath) {

    const durationPerSegment = 8000; // 8s between cities (cinematic slow)
    const totalDuration = durationPerSegment * (waypoints.length - 1);

    const startTime = performance.now();

    // Show plane when flight starts (if using layer opacity, but here we just update position)
    // If we wanted to hide/show, we could toggle layer visibility. 
    // For now, let's assume it jumps to start.



    const EAGLE_PITCH = 8;
    const CLOSE_ZOOM = 2.2;
    const TRAVEL_ZOOM = 1.6;

    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    function ease(t) {
        // smooth cinematic easing
        return t * t * (3 - 2 * t);
    }

    const routeSource = map.getSource('route');

    function updateFrame(t) {
        if (t > 1) t = 1;

        // which segment we are in
        const segmentFloat = t * (waypoints.length - 1);
        const segmentIndex = Math.floor(segmentFloat);
        const segmentT = segmentFloat - segmentIndex;

        const start = waypoints[segmentIndex];
        const end = waypoints[Math.min(segmentIndex + 1, waypoints.length - 1)];

        const et = ease(segmentT);

        // interpolate position
        // progress along arc
        const headIndex = Math.floor(t * (fullPath.length - 1));
        const lookAhead = Math.min(headIndex + 5, fullPath.length - 1);

        const head = fullPath[headIndex];
        const target = fullPath[lookAhead];

        const lng = head[0];
        const lat = head[1];

        // calculate bearing toward future point (smooth direction)
        const bearing = Math.atan2(target[0] - head[0], target[1] - head[1]) * (180 / Math.PI);

        // zoom logic (zoom in near cities, out mid flight)
        const distToEdge = Math.min(segmentT, 1 - segmentT);
        const zoomBlend = 1 - distToEdge * 2;

        const zoom = lerp(TRAVEL_ZOOM, CLOSE_ZOOM, zoomBlend);

        map.jumpTo({
            center: [lng, lat],
            zoom,
            pitch: 8,      // flatter = globe view
            bearing: 0     // stable, no rotation
        });

        // ✨ ARC DRAW PROGRESSIVELY
        if (routeSource) {
            const progressIndex = Math.floor(t * fullPath.length);
            routeSource.setData({
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: fullPath.slice(0, progressIndex)
                }
            });
        }

        // ⭐ Plane follow logic (Layer based)
        const planeSource = map.getSource('plane-source');
        if (planeSource) {

            // Calculate bearing
            // Note: atan2(dx, dy) = angle from North (Y axis), which is Mapbox bearing.
            // dLat is Y, dLng is X. 
            // Standard Math.atan2(y, x). 
            // We want bearing (0 is North, 90 is East).
            // Bearing = atan2(dLng, dLat) * 180 / PI. 
            // Wait, previous code used atan2(target[0] - lng, target[1] - lat). 
            // target[0]-lng = dLng (dx). target[1]-lat = dLat (dy).
            // atan2(dx, dy).
            // If x=0, y=1 (North), atan2(0, 1) = 0. Correct.
            // If x=1, y=0 (East), atan2(1, 0) = 90. Correct.
            // So the formula `Math.atan2(target[0] - lng, target[1] - lat)` is correct for Bearings.

            const angle = Math.atan2(target[0] - lng, target[1] - lat) * 180 / Math.PI;

            planeSource.setData({
                type: 'Feature',
                properties: {
                    bearing: angle
                },
                geometry: {
                    type: 'Point',
                    coordinates: [lng, lat]
                }
            });
        }
    }

    // Expose for manual control (Puppeteer)
    window.renderFrame = (seconds) => {
        const t = (seconds * 1000) / totalDuration;
        updateFrame(t);
    };

    function animate(now) {
        const elapsed = now - startTime;
        let t = elapsed / totalDuration;

        updateFrame(t);

        if (t < 1) requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);
}

// Add navigation controls
map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');

// ✅ EXPOSE FOR PUPPETEER
window.startFlightAutomatically = async () => {
    // 1. Geocode default route
    const cities = ["Dubai", "Sydney"];
    const coordinates = [];

    for (const city of cities) {
        const coord = await geocodeCity(city);
        if (!coord) return;
        coordinates.push(coord);
    }

    // 2. Generate Path
    let fullPath = [];
    const segments = [];

    for (let i = 0; i < coordinates.length - 1; i++) {
        const start = coordinates[i];
        const end = coordinates[i + 1];
        const segmentArc = createArc(start, end, 200, 40);

        const startIndex = fullPath.length;
        fullPath = fullPath.concat(segmentArc);
        const endIndex = fullPath.length - 1;

        segments.push({ start: startIndex, end: endIndex });
    }

    // 3. Set Route Source
    const routeSource = map.getSource('route');
    const geoJsonData = {
        type: 'Feature',
        geometry: {
            type: 'LineString',
            coordinates: []
        }
    };

    if (routeSource) {
        routeSource.setData(geoJsonData);
    } else {
        map.addSource('route', {
            type: 'geojson',
            data: geoJsonData
        });
        map.addLayer({
            id: 'route-line',
            type: 'line',
            source: 'route',
            paint: {
                'line-color': '#FFD166',
                'line-width': 3,
                'line-opacity': 0.9,
                'line-blur': 1
            }
        });
    }

    // 4. Start
    startCinematicFlight(coordinates, fullPath, segments);
};

// Resize map on load and window resize


window.addEventListener('resize', () => map.resize());
