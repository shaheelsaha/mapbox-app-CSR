import puppeteer from "puppeteer";
import fs from "fs";

const WIDTH = 1920;
const HEIGHT = 1080;
const FRAMES_PER_SEGMENT = 60; // Frames per flight segment
const BASE_URL = "http://localhost:8000"; // Assuming your python server is running

(async () => {
  // 1. Read User Input
  let route;
  try {
    route = JSON.parse(fs.readFileSync("route.json", "utf8"));
  } catch (e) {
    console.error("Error reading route.json:", e);
    process.exit(1);
  }
  console.log(`Loaded route with ${route.length} stops.`);

  // 2. Launch Browser
  const browser = await puppeteer.launch({
    headless: "new",
    defaultViewport: { width: WIDTH, height: HEIGHT },
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security' // Bypass CORS
    ]
  });

  const page = await browser.newPage();

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));

  // 3. Inject Content
  await page.setContent(`
<!DOCTYPE html>
<html>
<head>
  <style> body { margin: 0; overflow: hidden; background: black; } </style>
  <script type="importmap">{ "imports": {
    "three": "https://esm.sh/three@0.158.0",
    "three/": "https://esm.sh/three@0.158.0/"
  }}</script>
</head>
<body>
  <div id="globeViz"></div>
  <script type="module">
    import * as THREE from 'https://esm.sh/three@0.158.0';
    window.THREE = THREE;
    // Use bundled build from esm.sh with pinned dependency
    import ThreeGlobe from 'https://esm.sh/three-globe@2.30.0?deps=three@0.158.0';

    // --- INPUT DATA ---
    const CITIES = ${JSON.stringify(route)};
    
    // --- SCENE SETUP ---
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(${WIDTH}, ${HEIGHT});
    renderer.setPixelRatio(1);
    document.getElementById('globeViz').appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    
    // Camera
    const camera = new THREE.PerspectiveCamera(45, ${WIDTH}/${HEIGHT}, 1, 10000);
    camera.position.z = 400; 
    camera.position.y = 100;
    
    // --- GLOBE ---
    const arcsData = [];
    for (let i = 0; i < CITIES.length - 1; i++) {
        arcsData.push({
            startLat: CITIES[i].lat,
            startLng: CITIES[i].lng,
            endLat: CITIES[i+1].lat,
            endLng: CITIES[i+1].lng,
            color: ['#ffaa00', '#aa00ff']
        });
    }

    const Globe = new ThreeGlobe()
      .globeImageUrl('${BASE_URL}/assets/earth-blue-marble.jpg')
      .bumpImageUrl('${BASE_URL}/assets/earth-topology.png')
      // .arcsData(arcsData) // DISABLE DEFAULT ARCS
      .labelsData(CITIES)
      .labelLat(d => d.lat)
      .labelLng(d => d.lng)
      .labelText(d => d.name)
      .labelSize(1.5)
      .labelDotRadius(0.8)
      .labelColor(() => 'rgba(255, 255, 255, 0.75)')
      .labelResolution(2);

    const globeMaterial = Globe.globeMaterial();
    globeMaterial.bumpScale = 10;
    
    new THREE.TextureLoader().load('${BASE_URL}/assets/earth-water.png', texture => {
      globeMaterial.specularMap = texture;
      globeMaterial.specular = new THREE.Color('grey');
      globeMaterial.shininess = 15;
    });

    scene.add(Globe);
    scene.add(new THREE.AmbientLight(0xcccccc, Math.PI));
    const sun = new THREE.DirectionalLight(0xffffff, 0.6 * Math.PI);
    sun.position.set(1, 1, 1);
    scene.add(sun);

    // --- UTILS ---
    function getQuadraticBezierPoint(t, p0, p1, p2) {
      const oneMinusT = 1 - t;
      return new THREE.Vector3()
        .addScaledVector(p0, oneMinusT * oneMinusT)
        .addScaledVector(p1, 2 * oneMinusT * t)
        .addScaledVector(p2, t * t);
    }

    function latLngToVector3(lat, lng, radius) {
      const phi = (90 - lat) * Math.PI / 180;
      const theta = (lng + 180) * Math.PI / 180;
      // Original standard mapping:
      // x = -r * sin(phi) * cos(theta)
      // y = +r * cos(phi)
      // z = +r * sin(phi) * sin(theta)
      
      const x = -radius * Math.sin(phi) * Math.cos(theta);
      const y = radius * Math.cos(phi);
      const z = radius * Math.sin(phi) * Math.sin(theta);

      // ThreeGlobe alignment correction:
      // Official X = -My Z
      // Official Y = My Y
      // Official Z = My X
      return new THREE.Vector3(-z, y, x);
    }

    // --- CUSTOM PATH LINES ---
    // Draw lines exactly where the plane will fly
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffaa00, linewidth: 2 });
    
    // We need to wait for Globe radius? Or just assume it.
    // ThreeGlobe defaults radius to 100.
    const globeRadius = 100;

    for (let i = 0; i < CITIES.length - 1; i++) {
        const startCity = CITIES[i];
        const endCity = CITIES[i+1];
        
        const startPos = latLngToVector3(startCity.lat, startCity.lng, globeRadius + 4);
        const endPos = latLngToVector3(endCity.lat, endCity.lng, globeRadius + 4);
        const midPoint = startPos.clone().add(endPos).multiplyScalar(0.5).normalize().multiplyScalar(globeRadius * 1.5);
        
        const points = [];
        for(let t=0; t<=1; t+=0.01) {
             points.push(getQuadraticBezierPoint(t, startPos, midPoint, endPos));
        }
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(geometry, lineMaterial);
        scene.add(line);
    }
    
    // --- PLANE MARKER ---
    // Use the custom SVG texture
    const planeTexture = new THREE.TextureLoader().load('${BASE_URL}/assets/plane.svg');
    const planeGeometry = new THREE.PlaneGeometry(5, 5);
    const planeMaterial = new THREE.MeshBasicMaterial({ 
        map: planeTexture, 
        transparent: true, 
        side: THREE.DoubleSide 
    });
    const plane = new THREE.Mesh(planeGeometry, planeMaterial);
    
    // Correction for typical icon rotation?
    // Let's rotate geometry Z by -45 degrees just to be safe? 
    // Actually, let's look at the SVG d path: M12... L10...
    // It looks symmetric around automatic axis?
    // The previous user request showed an icon that was pointing North-East (45 deg).
    // The user reported "opposite" direction.
    // Analysis: 
    // - Texture Up (+Y) becomes Mesh Back (-Z) with rotateX(-90).
    // - We want SVG Nose to point Mesh Forward (+Z).
    // - So SVG Nose needs to point Texture Down (-Y) [-90 deg].
    // - SVG Nose starts at +45 deg.
    // - Rotate needed: -90 - 45 = -135 deg = -3 * PI / 4.
    planeGeometry.rotateZ(-3 * Math.PI / 4);
    planeGeometry.rotateX(-Math.PI / 2);
    
    scene.add(plane);

// --- RENDER FUNCTION ---
    window.renderFrame = async function(segmentIndex, t) {
        const startCity = CITIES[segmentIndex];
        const endCity = CITIES[segmentIndex + 1];

        const globeRadius = Globe.getGlobeRadius() || 100; 
        const startPos = latLngToVector3(startCity.lat, startCity.lng, globeRadius + 4);
        const endPos = latLngToVector3(endCity.lat, endCity.lng, globeRadius + 4);
        // Lower arc for more realistic flight (1.5 -> 1.25)
        const midPoint = startPos.clone().add(endPos).multiplyScalar(0.5).normalize().multiplyScalar(globeRadius * 1.25);
        
        // Plane Position (Quadratic Bezier)
        const pos = getQuadraticBezierPoint(t, startPos, midPoint, endPos);
        plane.position.copy(pos);
        
        // Plane Rotation (Look ahead)
        // Look at a point slightly ahead on the curve
        const nextT = Math.min(t + 0.01, 1.0);
        const nextPos = getQuadraticBezierPoint(nextT, startPos, midPoint, endPos);
        
        // FIX: Set "up" vector to be the normal from center of earth
        // This ensures the plane flies "belly down" relative to surface
        const upVec = pos.clone().normalize();
        plane.up.copy(upVec);
        
        plane.lookAt(nextPos);

        // --- CINEMATIC CAMERA ---
        // 1. Altitude Calculation: Zoom In -> Out -> In
        // sin(t * PI) gives a dome shape (0 -> 1 -> 0)
        // We invert logic: Start Low, Go High, End Low
        const baseAlt = 20;   // Close up / Zoom In
        const peakAlt = 90;   // Lower ceiling (was 180) to keep plane visible and "flying"
        
        // Ease the sine wave for smoother start/stop
        const sinVal = Math.sin(t * Math.PI);
        const altitude = baseAlt + (peakAlt * sinVal);

        // 2. Camera Latitude/Longitude Tracking
        // Follow the plane's ground position but stay "behind" or "above" it?
        // Simple "God View": Just follow the plane's position vector, extended by altitude
        const cameraPos = pos.clone().normalize().multiplyScalar(globeRadius + altitude);
        
        // Optional: Add a slight "lag" or angle? 
        // Let's add a slight Y-offset (up) so we look down at the plane
        // Actually, just normalizing and multipling scalar puts us directly above the plane (nadir view)
        // If we want a "trailing" view, we need to substract the direction vector.
        
        // For a clean overview:
        camera.position.copy(cameraPos);
        
        // 3. LookAt Target
        // Look slightly ahead of the plane, or at the plane itself?
        // Looking at the plane keeps it centered.
        // Looking at the destination makes it feel like we are traveling there.
        // Let's interpolate lookAt from Start -> Plane -> End? 
        // No, simple "Look at Plane" is most robust for keeping subject in frame.
        camera.lookAt(pos);

        // Force scene update
        renderer.render(scene, camera);
    }

  </script>
</body>
</html>
  `);

  // 4. Wait for textures
  await new Promise(r => setTimeout(r, 3000));

  // 5. Render Loop
  if (!fs.existsSync("frames")) fs.mkdirSync("frames");

  // Clean old frames?
  // fs.rmSync("frames", { recursive: true, force: true });
  // fs.mkdirSync("frames");

  // Update: use more frames for cinematic feel
  // 300 frames @ 30fps = 10 seconds. Slower flight.
  const FRAMES_THIS_SEGMENT = 240; // 8 seconds

  let frameCount = 0;
  for (let i = 0; i < route.length - 1; i++) {
    console.log(`Rendering segment ${i}: ${route[i].name} -> ${route[i + 1].name}`);

    for (let f = 0; f < FRAMES_THIS_SEGMENT; f++) {
      const t = f / (FRAMES_THIS_SEGMENT - 1);

      await page.evaluate((segIdx, time) => {
        return window.renderFrame && window.renderFrame(segIdx, time);
      }, i, t);

      const padded = String(frameCount).padStart(5, '0');
      await page.screenshot({ path: `frames/frame_${padded}.png` });
      if (f % 10 === 0) process.stdout.write(`\rSaved frame ${padded}`);
      frameCount++;
    }
    console.log("");
  }

  console.log("Rendering complete. Run ffmpeg.");
  await browser.close();
})();
