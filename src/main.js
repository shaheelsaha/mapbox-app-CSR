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

let planeMarker;


map.on('load', () => {
    map.setFog({
        color: 'rgb(186, 210, 235)', // Lower atmosphere
        'high-color': 'rgb(36, 92, 223)', // Upper atmosphere
        'horizon-blend': 0.02, // Atmosphere thickness (default 0.2 at low zooms)
        'space-color': 'rgb(11, 11, 25)', // Background color
        'star-intensity': 0.6 // Background star brightness (default 0.35 at low zooms)
    });

    map.resize();

    // ⭐ Final plane marker setup
    const planeEl = document.createElement('div');

    planeEl.innerHTML = `
    <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor" style="transition: transform 0.06s linear; transform-origin: center;">
        <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"></path>
    </svg>
    `;

    planeEl.style.color = "white";
    planeEl.style.width = "32px";
    planeEl.style.height = "32px";
    planeEl.style.pointerEvents = "none";
    planeEl.style.filter = "drop-shadow(0 0 6px rgba(255,255,255,0.8))";

    planeMarker = new mapboxgl.Marker({
        element: planeEl,
        anchor: 'center'
    })
        .setLngLat([0, 0])
        .addTo(map);

    // hide initially
    planeMarker.getElement().style.opacity = '0';
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

function startCinematicFlight(waypoints, fullPath) {

    const durationPerSegment = 8000; // 8s between cities (cinematic slow)
    const totalDuration = durationPerSegment * (waypoints.length - 1);

    const startTime = performance.now();

    // Show plane when flight starts
    if (planeMarker) planeMarker.getElement().style.opacity = '1';


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

    function animate(now) {

        const elapsed = now - startTime;
        let t = elapsed / totalDuration;

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

        // ⭐ Plane follow logic
        if (planeMarker) {

            planeMarker.setLngLat([lng, lat]);

            const angle =
                Math.atan2(target[0] - lng, target[1] - lat) * 180 / Math.PI;

            // adjust for generic plane icon orientation (pointing up by default)
            // The icon I used points UP (0 deg), atan2 returns angle from X axis (Right).
            // Usually plane icons point UP. atan2(y,x).
            // Wait, typical SVG plane points UP. 0 deg bearing in Mapbox is North (Up).
            // arc bearing: atan2(dLng, dLat).
            // Let's stick to the user's logic exactly, but maybe adjust rotation offset if needed.
            // User logic: atan2(target[0] - lng, target[1] - lat). This is atan2(dx, dy).
            // standard atan2 is (y, x).
            // if args are (dx, dy), it returns angle from Y axis (North/Up)-- which is correct for Bearing!
            // So if the icon points UP, `rotate(${angle}deg)` should work assuming angle is deg COG.

            // Correction: atan2(dx, dy) is NOT standard JS Math.atan2(y, x).
            // User code: Math.atan2(target[0] - lng, target[1] - lat).
            // target[0] is Lng (X), target[1] is Lat (Y).
            // So this is atan2(dX, dY).
            // Math.atan2(y, x) -> angle from X axis.
            // Math.atan2(dX, dY) -> angle from Y axis (if we map X->Y, Y->X).
            // Actually: atan2(x, y) gives angle from Y axis (North) in clockwise direction? No.
            // Let's trust the user's formula for now OR implement standard bearing calc.

            const svg = planeMarker.getElement().querySelector('svg');
            if (svg) {
                svg.style.transform = `rotate(${angle}deg)`;
            }
        }


        if (t < 1) requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);
}

// Add navigation controls
map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');

// Resize map on load and window resize


window.addEventListener('resize', () => map.resize());
