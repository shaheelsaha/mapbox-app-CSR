import { renderVideo } from './render.js';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config'; // Load env vars

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mockRoute = [
    { name: "Chennai", lat: 13.0827, lng: 80.2707, vehicle: "plane" },
    { name: "Dubai", lat: 25.2048, lng: 55.2708, vehicle: "plane" },
    { name: "Sydney", lat: -33.8688, lng: 151.2093, vehicle: "plane" },
    { name: "Tokyo", lat: 35.6762, lng: 139.6503, vehicle: "plane" },
    { name: "New York", lat: 40.7128, lng: -74.0060, vehicle: "plane" }
];

const outputPath = path.join(__dirname, 'debug_output_road.mp4');
const baseUrl = 'http://localhost:8080'; // Server must be running for assets!

console.log("Starting Debug Render...");
// Passing 'plane' as default vehicle type
renderVideo(mockRoute, outputPath, baseUrl, 'plane')
    .then(() => console.log("Render Complete! Check debug_output_road.mp4"))
    .catch(err => console.error("Render Failed:", err));
