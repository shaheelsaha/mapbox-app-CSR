import './style.css';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import './export.js';
import { createCamera } from './camera.js';
import { drive } from './transports/car.js';
import { fly } from './transports/flight.js';

// Token from environment variables
mapboxgl.accessToken = 'pk.eyJ1Ijoic2hhaGVlbDU1IiwiYSI6ImNta2Q0cTNqZTA2cGszZ3M2dzVucDdsOGwifQ.WGhIdum-usVYkJJZOfr9UA';

// 1. Arc Generator Function
function createArc(start, end, steps = 200, height = 50) {
    console.log(`📐 createArc: ${start} -> ${end}`);
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
    console.log(`✅ Arc generated: ${points.length} points`);
    return { geometry: { coordinates: points } };
}

const map = window.map = new mapboxgl.Map({
    container: 'map', // container ID
    style: 'mapbox://styles/shaheel55/cmkkb8oxs000w01qw84c8ao3n', // style URL
    center: [-34, 38], // starting position [lng, lat]
    zoom: 2, // starting zoom
    projection: 'globe', // Display the map as a globe, since zoom is low
    preserveDrawingBuffer: true, // Required for canvas recording
    attributionControl: false
});

map.on('load', () => {
    window.mapLoaded = true;
    console.log("✅ Map loaded signal sent");

    map.setFog({
        color: 'rgb(186, 210, 235)', // Lower atmosphere
        'high-color': 'rgb(36, 92, 223)', // Upper atmosphere
        'horizon-blend': 0.02, // Atmosphere thickness (default 0.2 at low zooms)
        'space-color': 'rgb(11, 11, 25)', // Background color
        'star-intensity': 0.6 // Background star brightness (default 0.35 at low zooms)
    });

    map.resize();

    map.resize();

    /* ===============================
       🚗 CAR & PLANE ICON SETUP
    =============================== */

    // Load Plane Image
    map.loadImage('/assets/plane.png', (error, image) => {
        if (error) console.error("❌ Failed to load plane image", error);
        else if (!map.hasImage('plane-icon')) map.addImage('plane-icon', image);
    });

    // Load Car Image (User's Robust Setup)
    map.loadImage('/assets/car.png', (error, image) => {
        if (error) throw error;

        // add image to map
        if (!map.hasImage('car-icon')) map.addImage('car-icon', image);

        // source (moving point)
        if (!map.getSource('plane-source')) {
            map.addSource('plane-source', {
                type: 'geojson',
                data: {
                    type: 'Feature',
                    properties: { bearing: 0 },
                    geometry: {
                        type: 'Point',
                        coordinates: [0, 0]
                    }
                }
            });
        }

        // layer
        if (!map.getLayer('plane-layer')) {
            map.addLayer({
                id: 'plane-layer', // Keeping ID 'plane-layer' for compatibility
                type: 'symbol',
                source: 'plane-source',
                layout: {
                    'icon-image': 'car-icon', // Default to car for now, or change dynamically

                    // Hidden by default (size 0)
                    'icon-size': 0,

                    'icon-rotate': ['+', ['get', 'bearing'], -45],
                    'icon-rotation-alignment': 'map',
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true
                }
            });
        }
        console.log("✅ Car/Plane layer added");
    });
    console.log("✅ Map fully loaded");
    window.mapLoaded = true; // Signal for Puppeteer
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

    // Find the destination group (Last input group) to insert before
    const inputGroups = inputsDiv.querySelectorAll('.input-group');
    const destinationGroup = inputGroups[inputGroups.length - 1];

    // 1. Create Stop Input
    const newGroup = document.createElement('div');
    newGroup.className = 'input-group';
    newGroup.innerHTML = `
        <input type="text" placeholder="Stop Location (e.g. London)" class="location-input" autocomplete="off">
        <div class="suggestions"></div>
    `;

    // 2. Create Connection Line
    const connectionDiv = document.createElement('div');
    connectionDiv.className = 'connection-line';
    connectionDiv.innerHTML = `
        <select class="travel-mode">
          <option value="flight">✈️ Flight</option>
          <option value="drive">🚗 Drive</option>
        </select>
    `;

    // INSERT ORDER: Start -> Mode -> Dest -> [Mode] -> [Stop]
    // Append to end
    inputsDiv.appendChild(connectionDiv);
    inputsDiv.appendChild(newGroup);

    setupAutocomplete(newGroup);
});

document.getElementById('generate-flight').addEventListener('click', async () => {
    const btn = document.getElementById('generate-flight');
    const originalText = btn.textContent;

    // 1. Immediate UI Feedback
    btn.textContent = "Calculating Path... ⏳";
    btn.disabled = true;
    btn.style.opacity = "0.7";
    btn.style.cursor = "not-allowed";

    try {
        const inputs = document.querySelectorAll('.location-input');
        const cities = Array.from(inputs).map(input => input.value.trim()).filter(val => val !== '');

        if (cities.length < 2) {
            alert('Please enter at least a start and end location.');
            return; // Finally block will handle reset
        }


        // Geocode all cities (sequentially to maintain order)
        const coordinates = [];
        for (const city of cities) {
            const coord = await geocodeCity(city);
            if (!coord) return;
            coordinates.push(coord);
        }

        // Collect Modes
        // The first mode connector is between input 0 and 1. 
        // Selects are dynamic.
        const modeSelects = document.querySelectorAll('.travel-mode');
        const modes = Array.from(modeSelects).map(s => s.value);

        // Fallback if mismatch (should equal coords.length - 1)
        // If user deleted inputs uniquely, might desync, but assuming 'add stop' flow is linear.
        // Actually, modeSelects might be 0 if only 2 inputs and using default? 
        // Wait, index.html has one hardcoded mode selector now.
        // So if 2 cities, we have 1 selector. Correct.

        // 1. Build Segments & Full Path for Visuals
        let fullRouteGeoJson = [];
        const journeySegments = [];
        let totalDistanceKm = 0;

        for (let i = 0; i < coordinates.length - 1; i++) {
            const start = coordinates[i];
            const end = coordinates[i + 1];
            const mode = modes[i] || 'flight'; // default fallback

            // Distance
            totalDistanceKm += getDistanceFromLatLonInKm(start[1], start[0], end[1], end[0]);

            // Route Geometry
            // For visualization line: 
            // If Flight -> Arc
            // If Drive -> Road (async fetch needed)

            let segmentPath = [];
            if (mode === 'drive') {
                // We need to fetch the road path for the visual line 'route' source
                // drive.drive() fetches it again, but that's okay for now.
                // Or we can pre-fetch here.
                // Let's create a helper in drive.js or use createDrive instance to fetch.
                // We need to export `getDrivingRoute` or assume simple line for now? 
                // Better to show real route. fetch it.
                // We can reuse the `drive` instance if we instantiate it early.

                // Quick localized fetch since we can't easily access drive internals without refactor
                // Or just instantiate drive here.

                // We need to expose getDrivingRoute or just fetch.
                // Let's just fetch here for the static line.
                const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${start[0]},${start[1]};${end[0]},${end[1]}?geometries=geojson&overview=full&access_token=${mapboxgl.accessToken}`;
                const res = await fetch(url);
                const data = await res.json();
                if (data.routes && data.routes[0]) {
                    segmentPath = data.routes[0].geometry.coordinates;
                } else {
                    segmentPath = [start, end]; // API fail fallback
                }

            } else {
                // Flight: Arc
                const arc = createArc(start, end, 200, 50); // Height 50
                segmentPath = arc.geometry.coordinates;
            }

            // Segments for visual only
            fullRouteGeoJson = fullRouteGeoJson.concat(segmentPath);

            journeySegments.push({
                start,
                end,
                mode
            });
        }

        // Show Stats
        const statsContainer = document.getElementById('planner');
        let statsEl = document.getElementById('flight-stats');
        if (!statsEl) {
            statsEl = document.createElement('div');
            statsEl.id = 'flight-stats';
            statsEl.style.marginTop = '15px';
            statsEl.style.padding = '10px';
            statsEl.style.background = 'rgba(255, 255, 255, 0.1)';
            statsEl.style.borderRadius = '8px';
            statsEl.style.fontSize = '0.9rem';
            statsEl.style.display = 'flex';
            statsEl.style.alignItems = 'center';
            statsEl.style.gap = '8px';
            statsContainer.appendChild(statsEl);
        }
        statsEl.innerHTML = `<span>📏 Total Distance:</span> <strong>${Math.round(totalDistanceKm).toLocaleString()} km</strong>`;


        // Update Route Source (Visual Line on Map)
        const routeSource = map.getSource('route');
        const geoJsonData = {
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: [] // Start empty for progressive draw
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

        /* =========================================
           🚀 MIXED MODE ORCHESTRATOR
        ========================================= */
        /* =========================================
           🚀 MIXED MODE ORCHESTRATOR
        ========================================= */
        const camera = createCamera(map, createArc);


        // 1. INTRO
        if (journeySegments.length > 0) {
            await camera.intro(journeySegments[0].start);
        }
        await new Promise(r => setTimeout(r, 1000));

        // Track path history for progressive drawing
        let pathHistory = [];

        // 2. LOOP SEGMENTS
        for (let i = 0; i < journeySegments.length; i++) {
            const leg = journeySegments[i];

            console.log(`🎬 Starting Leg ${i + 1}: ${leg.mode.toUpperCase()}`);

            if (leg.mode === 'drive') {
                map.setLayoutProperty('plane-layer', 'icon-image', 'car-icon');
                map.setLayoutProperty('plane-layer', 'icon-size', [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    4, 0.1,
                    8, 0.18,
                    12, 0.25
                ]);
                pathHistory = await drive(map, leg.start, leg.end, pathHistory);
            }
            else if (leg.mode === 'flight') {
                map.setLayoutProperty('plane-layer', 'icon-image', 'plane-icon');
                map.setLayoutProperty('plane-layer', 'icon-size', [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    2, 0.05,
                    4, 0.1,
                    6, 0.15
                ]);
                pathHistory = await fly(map, leg.start, leg.end, createArc, pathHistory);
            }

            // Slight pause between segments
            await new Promise(r => setTimeout(r, 500));
        }

        // 3. OUTRO
        if (journeySegments.length > 0) {
            await camera.outro(journeySegments[journeySegments.length - 1].end);
        }

        // Hide vehicle after animation
        map.setLayoutProperty('plane-layer', 'icon-size', 0);

    } catch (error) {
        console.error("❌ Flight generation error:", error);
        alert("An error occurred while generating the flight path. Please check the console.");
    } finally {
        // Reset Button
        btn.textContent = originalText;
        btn.disabled = false;
        btn.style.opacity = "1";
        btn.style.cursor = "pointer";
    }
});

// Helper: Haversine Distance
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    var R = 6371; // Radius of the earth in km
    var dLat = deg2rad(lat2 - lat1);
    var dLon = deg2rad(lon2 - lon1);
    var a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2)
        ;
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    var d = R * c; // Distance in km
    return d;
}

function deg2rad(deg) {
    return deg * (Math.PI / 180)
}


// Cloud Render removed - Export Video is now the primary method.
// Firebase import kept for export.js usage.
import { storage, ref, uploadBytes, getDownloadURL } from './firebase.js';

let currentBlobUrl = null; // For modal controls

// Modal Controls
document.getElementById('close-preview').addEventListener('click', () => {
    const modal = document.getElementById('video-modal');
    const player = document.getElementById('preview-player');
    player.pause();
    modal.style.display = 'none';
});

document.getElementById('download-preview').addEventListener('click', () => {
    if (!currentBlobUrl) return;
    const a = document.createElement('a');
    a.href = currentBlobUrl;
    a.download = `cloud-flight-${Date.now()}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
});

function startCinematicFlight(waypoints, fullPath) {

    const durationPerSegment = 8000; // 8s between cities (cinematic slow)
    const totalDuration = durationPerSegment * (waypoints.length - 1);

    const startTime = performance.now();

    // Show plane when flight starts (if using layer opacity, but here we just update position)
    // If we wanted to hide/show, we could toggle layer visibility. 
    // For now, let's assume it jumps to start.



    const EAGLE_PITCH = 8;
    const CLOSE_ZOOM = 3.5;  // Much closer at cities (Dramatic)
    const TRAVEL_ZOOM = 1.25; // Wider view mid-flight

    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    function ease(t) {
        // smooth cinematic easing
        return t * t * (3 - 2 * t);
    }

    const routeSource = map.getSource('route');

    // State for smooth camera lag
    let cameraLng = fullPath[0][0];
    let cameraLat = fullPath[0][1];

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

        if (!head || !target) {
            console.error(`❌ Head or Target undefined in updateFrame. t=${t}, headIndex=${headIndex}, lookAhead=${lookAhead}, fullPathLen=${fullPath.length}`);
            return;
        }

        const lng = head[0];
        const lat = head[1];

        // Smooth Camera Lag (Drone Follow Effect)
        // We lerp current camera position towards the plane's position
        cameraLng = lerp(cameraLng, lng, 0.05);
        cameraLat = lerp(cameraLat, lat, 0.05);

        // LOGGING CAMERA MOVEMENT (Sampled)
        if (Math.random() < 0.05) {
            console.log(`🎥 Camera Move: t=${t.toFixed(3)}, lng=${lng.toFixed(2)}, lat=${lat.toFixed(2)}`);
        }

        // calculate bearing toward future point (smooth direction)
        const bearing = Math.atan2(target[0] - head[0], target[1] - head[1]) * (180 / Math.PI);

        // zoom logic (zoom in near cities, out mid flight)
        const distToEdge = Math.min(segmentT, 1 - segmentT);
        const zoomBlend = 1 - distToEdge * 2;

        const zoom = lerp(TRAVEL_ZOOM, CLOSE_ZOOM, zoomBlend);

        // Cinematic Camera: Smooth easeTo + Drone-like tilt & rotation
        map.easeTo({
            center: [cameraLng, cameraLat], // Use smoothed camera position
            zoom,
            pitch: 60,      // steeper 3D drone view
            bearing: bearing, // rotate with flight direction
            duration: 80,   // smooth frame-to-frame smoothing
            easing: t => t
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

        if (t < 1) {
            requestAnimationFrame(animate);
        } else {
            console.log("✅ Animation Complete");
            window.animationState = 'completed';
        }
    }

    requestAnimationFrame(animate);
}

// Add navigation controls
map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');

// Expose for export.js
window.executeJourney = executeJourney;

// ✅ EXPOSE FOR PUPPETEER & EXPORT
// Now accepts either:
//   1. Array of segment objects: [{ start: [lng, lat], end: [lng, lat], mode: 'flight'|'drive' }, ...]
//   2. Array of city names (legacy, defaults to 'flight' for all): ['Dubai', 'London', 'Paris']
window.startFlightAutomatically = async (input) => {
    console.log("✈️ startFlightAutomatically called with:", input);

    // 🎥 CINEMATIC CLEAN MODE: Hide UI
    const card = document.getElementById('planner');
    if (card) card.style.display = 'none';

    const controls = document.querySelector('.mapboxgl-control-container');
    if (controls) controls.style.display = 'none';

    let segments = [];

    // Detect input type
    if (input && input.length > 0 && typeof input[0] === 'object' && input[0].start) {
        // It's already a segments array
        segments = input;
    } else {
        // It's an array of city names (legacy), geocode and default to 'flight'
        const cities = (input && input.length >= 2) ? input : ["Dubai", "Sydney"];
        console.log("Geocoding cities:", cities);
        const coordinates = [];

        for (const city of cities) {
            const coord = await geocodeCity(city);
            if (!coord) {
                console.error("Failed to geocode:", city);
                return;
            }
            coordinates.push(coord);
        }

        for (let i = 0; i < coordinates.length - 1; i++) {
            segments.push({
                start: coordinates[i],
                end: coordinates[i + 1],
                mode: 'flight' // Default for legacy calls
            });
        }
    }

    // Setup route source (empty initially for progressive draw)
    const routeSource = map.getSource('route');
    const geoJsonData = {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [] }
    };

    if (routeSource) {
        routeSource.setData(geoJsonData);
    } else {
        map.addSource('route', { type: 'geojson', data: geoJsonData });
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

    // Execute journey and RETURN the promise
    await executeJourney(segments);
};

/* =========================================
   🚀 UNIFIED JOURNEY EXECUTOR
   Used by both Preview and Export.
   Returns a Promise that resolves when animation is complete.
========================================= */
async function executeJourney(segments) {
    const camera = createCamera(map, createArc);

    console.log("🚀 executeJourney called with segments:", segments);

    // Track path history for progressive drawing
    let pathHistory = [];

    // 1. INTRO
    if (segments.length > 0) {
        await camera.intro(segments[0].start);
    }
    await new Promise(r => setTimeout(r, 1000));

    // 2. LOOP SEGMENTS
    for (let i = 0; i < segments.length; i++) {
        const leg = segments[i];

        console.log(`🎬 Starting Leg ${i + 1}: ${leg.mode.toUpperCase()}`);

        if (leg.mode === 'drive') {
            map.setLayoutProperty('plane-layer', 'icon-image', 'car-icon');
            map.setLayoutProperty('plane-layer', 'icon-size', [
                'interpolate',
                ['linear'],
                ['zoom'],
                4, 0.1,
                8, 0.18,
                12, 0.25
            ]);
            // Drive returns new history
            pathHistory = await drive(map, leg.start, leg.end, pathHistory);
        }
        else if (leg.mode === 'flight') {
            map.setLayoutProperty('plane-layer', 'icon-image', 'plane-icon');
            map.setLayoutProperty('plane-layer', 'icon-size', [
                'interpolate',
                ['linear'],
                ['zoom'],
                2, 0.05,
                4, 0.1,
                6, 0.15
            ]);
            // Fly returns new history
            pathHistory = await fly(map, leg.start, leg.end, createArc, pathHistory);
        }

        await new Promise(r => setTimeout(r, 500));
    }

    await new Promise(r => setTimeout(r, 500));

    // 3. OUTRO
    if (segments.length > 0) {
        await camera.outro(segments[segments.length - 1].end);
    }

    // Hide vehicle after animation
    map.setLayoutProperty('plane-layer', 'icon-size', 0);

    console.log("✅ Journey Complete");
    window.animationState = 'completed';
}


// ✅ EXPOSE ROTATION FOR SERVER
window.startRotation = () => {
    console.log("🌍 window.startRotation called");

    // Hide UI
    const card = document.getElementById('planner');
    if (card) card.style.display = 'none';
    const controls = document.querySelector('.mapboxgl-control-container');
    if (controls) controls.style.display = 'none';

    // Start a continuous rotation
    const rotateOrbit = () => {
        const center = map.getCenter();
        center.lng += 0.5; // Rotate longitude
        map.easeTo({
            center,
            duration: 100,
            easing: n => n
        });
        requestAnimationFrame(rotateOrbit);
    };
    rotateOrbit();
};

// ✅ COORDINATE FLIGHT FOR SERVER RENDER
window.startFlightFromCoords = async (routeStr) => {
    console.log("✈️ startFlightFromCoords called with:", routeStr);

    // Hide UI
    const card = document.getElementById('planner');
    if (card) card.style.display = 'none';
    const controls = document.querySelector('.mapboxgl-control-container');
    if (controls) controls.style.display = 'none';

    // Parse coordinates "lat,lng|lat,lng" -> [[lng, lat], [lng, lat]]
    const coordinates = routeStr.split('|').map(pair => {
        const [lat, lng] = pair.split(',').map(Number);
        return [lng, lat]; // Mapbox uses [lng, lat]
    });

    console.log("Parsed coordinates:", coordinates);

    // Generate Path
    let fullPath = [];
    const segments = [];

    for (let i = 0; i < coordinates.length - 1; i++) {
        const start = coordinates[i];
        const end = coordinates[i + 1];
        // Reuse existing createArc function
        const segmentArc = createArc(start, end, 200, 40);

        const startIndex = fullPath.length;
        fullPath = fullPath.concat(segmentArc.geometry.coordinates);
        const endIndex = fullPath.length - 1;

        segments.push({ start: startIndex, end: endIndex });
    }

    // Set Route Source
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

    // Ensure plane layer is on top
    if (map.getLayer('plane-layer')) {
        map.moveLayer('plane-layer');
    }

    // Reuse startCinematicFlight
    startCinematicFlight(coordinates, fullPath, segments);
};

// ✅ ZOOM ANIMATION FOR PUPPETEER
window.startZoomAnimation = async (cityName, duration = 10000) => {
    console.log(`🔍 Starting zoom animation for: ${cityName}, duration: ${duration}ms`);

    // Hide UI
    const card = document.getElementById('planner');
    if (card) card.style.display = 'none';
    const controls = document.querySelector('.mapboxgl-control-container');
    if (controls) controls.style.display = 'none';

    // Geocode city
    const coords = await geocodeCity(cityName);
    if (!coords) {
        console.error("Failed to geocode:", cityName);
        return;
    }

    console.log(`Zooming to coordinates: ${JSON.stringify(coords)}`);

    // Animation parameters
    const startZoom = 0.5;   // Space view
    const endZoom = 15;      // Street level
    const startPitch = 0;
    const endPitch = 60;
    const startTime = performance.now();

    // Smooth easing function
    function easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    function animate(now) {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / duration, 1);
        const easedT = easeInOutCubic(t);

        const currentZoom = startZoom + (endZoom - startZoom) * easedT;
        const currentPitch = startPitch + (endPitch - startPitch) * easedT;

        map.jumpTo({
            center: coords,
            zoom: currentZoom,
            pitch: currentPitch,
            bearing: 0
        });

        // Log progress occasionally
        if (Math.random() < 0.05) {
            console.log(`🎥 Zoom progress: ${(t * 100).toFixed(1)}%, zoom: ${currentZoom.toFixed(2)}`);
        }

        if (t < 1) {
            requestAnimationFrame(animate);
        } else {
            console.log("✅ Zoom Animation Complete");
            window.animationState = 'completed';
        }
    }

    requestAnimationFrame(animate);
};

// ✅ CANVAS STREAM RECORDING FOR SMOOTH VIDEO
let mediaRecorder = null;
let recordedChunks = [];

window.startCanvasRecording = () => {
    console.log("🎥 Starting canvas stream recording...");

    const canvas = document.querySelector('canvas');
    if (!canvas) {
        console.error("❌ Canvas not found");
        return;
    }

    // Capture canvas stream at 30 FPS
    const stream = canvas.captureStream(30);

    // Create MediaRecorder
    const options = {
        mimeType: 'video/webm;codecs=vp9',
        videoBitsPerSecond: 5000000 // 5 Mbps
    };

    try {
        mediaRecorder = new MediaRecorder(stream, options);
    } catch (e) {
        // Fallback to default codec
        console.log("VP9 not supported, using default codec");
        mediaRecorder = new MediaRecorder(stream);
    }

    recordedChunks = [];

    mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
            recordedChunks.push(event.data);
        }
    };

    mediaRecorder.onstop = () => {
        console.log("✅ Canvas recording stopped");
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        window.recordedVideoBlob = blob;
        console.log(`📹 Video blob size: ${blob.size} bytes`);
    };

    mediaRecorder.start();
    console.log("✅ Canvas recording started");
};

window.stopCanvasRecording = () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        console.log("🛑 Stopping canvas recording...");
    }
};

window.getRecordedVideo = () => {
    return window.recordedVideoBlob;
};

// Resize map on load and window resize


window.addEventListener('resize', () => map.resize());

console.log("✅ Main.js loaded. window.startFlightAutomatically is:", typeof window.startFlightAutomatically);
console.log("✅ Main.js loaded. window.startZoomAnimation is:", typeof window.startZoomAnimation);
console.log("✅ Main.js loaded. window.startCanvasRecording is:", typeof window.startCanvasRecording);
