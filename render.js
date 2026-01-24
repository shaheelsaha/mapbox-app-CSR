import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import os from "os";
import ffmpeg from "fluent-ffmpeg";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WIDTH = 1280;
const HEIGHT = 720;

/**
 * Renders a flight video for the given route.
 * @param {Array} routeData - Array of city objects with lat/lng/name.
 * @param {string} outputPath - Path to save the MP4 file.
 * @param {string} baseUrl - URL where assets (earth.jpg, plane.svg) are hosted (local server).
 */
export async function renderVideo(routeData, outputPath, baseUrl, vehicleType = 'plane') {
  console.log(`Starting render for route: ${routeData.map(c => c.name).join(" -> ")} [${vehicleType}]`);

  // ... (browser launch remains same) ...

  // 1. Launch Browser
  const browser = await puppeteer.launch({
    headless: "new",
    // Cloud Run args
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', // Fix for memory issues in Docker
      '--disable-web-security'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT });

  page.on('console', msg => {
    const text = msg.text();
    // Filter out known performance warnings that are expected during frame capture
    if (text.includes('GPU stall due to ReadPixels')) return;
    console.log('PAGE LOG:', text);
  });
  page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));

  // 2. Inject Content
  // We embed the JSON route directly
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
    import ThreeGlobe from 'https://esm.sh/three-globe@2.30.0?deps=three@0.158.0';

    const CITIES = ${JSON.stringify(routeData)};
    const WIDTH = ${WIDTH};
    const HEIGHT = ${HEIGHT};
    
    // --- SCENE SETUP ---
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(WIDTH, HEIGHT);
    renderer.setPixelRatio(1);
    document.getElementById('globeViz').appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    
    // Asset Loading State
    let globeReady = false;
    let bgReady = false;
    
    function checkReady() {
        if (globeReady && bgReady) {
            // Fix: Initial Camera Setup to avoid jump
            initialCameraSetup();
             
            window.ASSETS_READY = true;
            console.log("ALL ASSETS READY");
        }
    }

    // --- CAMERA CONSTANTS ---
    const START_FOCUS_END = 0.23;   // ~0.8s
    const ARRIVAL_START = 0.80;    // ~0.7s arrival
    const CAM_NEAR = 105; // closer city focus
    const CAM_FAR = 190;  // pulled-back travel view

    function initialCameraSetup() {
        if (!CITIES || CITIES.length === 0) return;
        
        // Match the logic for t=0 in renderFrame
        // At t=0, camDist = CAM_FAR (since t < START_FOCUS, localT=0, lerp(CAM_FAR, CAM_NEAR, 0) -> CAM_FAR)
        const startCity = CITIES[0];
        const globeRadius = 100; // Base radius
        
        const camDist = CAM_FAR;
        
        const camPos = latLngToVector3(
          startCity.lat, 
          startCity.lng, 
          globeRadius + camDist
        );
        
        camera.position.copy(camPos);
        camera.lookAt(latLngToVector3(startCity.lat, startCity.lng, globeRadius + 4)); // Look at start city "ground"
        
        // Force render
        renderer.render(scene, camera);
        console.log("Initial camera set to Start City");
    }

    // Background Stars
    new THREE.TextureLoader().load('https://cdn.jsdelivr.net/npm/three-globe/example/img/night-sky.png', texture => {
      scene.background = texture;
      bgReady = true;
      checkReady();
    }, undefined, (err) => {
        console.error("Error loading star texture:", err);
        // Fallback to ready anyway so we don't hang, but log error
        bgReady = true; 
        checkReady();
    });
    
    // Camera
    const camera = new THREE.PerspectiveCamera(45, WIDTH/HEIGHT, 1, 10000);
    camera.position.z = 400; 
    camera.position.y = 100;
    
    // --- GLOBE ---
    const Globe = new ThreeGlobe()
      .globeImageUrl('${baseUrl}/assets/earth-blue-marble.jpg')
      .bumpImageUrl('${baseUrl}/assets/earth-topology.png')
      .labelsData(CITIES)
      .labelLat(d => d.lat)
      .labelLng(d => d.lng)
      .labelText(d => d.name)
      .labelSize(1.5)
      .labelDotRadius(0) // Removed white dot
      .labelColor(() => 'rgba(255, 255, 255, 0.75)')
      .labelResolution(2)
      .onGlobeReady(() => {
          globeReady = true;
          checkReady();
      })
      .arcsData([]) // Initial empty
      .arcColor(d => d.color || 'orange')
      .arcAltitude(d => d.altitude || 0.25)
      .arcStroke(d => d.stroke || 1.2)
      .arcDashLength(0.001)      // tiny visible segment
      .arcDashGap(1)             // hide rest
      .arcDashInitialGap(d => d.gap) // dynamic control
      .arcDashAnimateTime(0);    // manual animate

    const globeMaterial = Globe.globeMaterial();
    globeMaterial.bumpScale = 10;
    
    new THREE.TextureLoader().load('${baseUrl}/assets/earth-water.png', texture => {
      globeMaterial.specularMap = texture;
      globeMaterial.specular = new THREE.Color('grey');
      globeMaterial.shininess = 15;
    });

    scene.add(Globe);

    // --- ATMOSPHERE ---
    const vertexShader = \`
      varying vec3 vNormal;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    \`;
    const fragmentShader = \`
      varying vec3 vNormal;
      void main() {
        float intensity = pow(0.6 - dot(vNormal, vec3(0, 0, 1.0)), 2.0);
        gl_FragColor = vec4(0.3, 0.6, 1.0, 1.0) * intensity; 
      }
    \`;
    
    // Atmosphere geometry should be slightly larger than the globe (Radius 100)
    const atmoGeometry = new THREE.SphereGeometry(100 + 15, 64, 64);
    const atmoMaterial = new THREE.ShaderMaterial({
      vertexShader: vertexShader,
      fragmentShader: fragmentShader,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      transparent: true
    });
    const atmosphere = new THREE.Mesh(atmoGeometry, atmoMaterial);
    scene.add(atmosphere);

    scene.add(new THREE.AmbientLight(0xcccccc, Math.PI));
    const sun = new THREE.DirectionalLight(0xffffff, 0.6 * Math.PI);
    sun.position.set(1, 1, 1);
    scene.add(sun);

    // --- UTILS ---
    function smoothstep(t) {
      return t * t * (3 - 2 * t);
    }

    function lerp(a, b, t) {
      return a + (b - a) * t;
    }

    function lerpVector(a, b, t) {
      return a.clone().lerp(b, t);
    }

    function getQuadraticBezierPoint(t, p0, p1, p2) {
      const oneMinusT = 1 - t;
      return new THREE.Vector3()
        .addScaledVector(p0, oneMinusT * oneMinusT)
        .addScaledVector(p1, 2 * oneMinusT * t)
        .addScaledVector(p2, t * t);
    }

    function getCameraOnSphere(startDir, endDir, t, radius) {
      // Linear interpolation of directions + normalize
      const dir = startDir.clone().lerp(endDir, t).normalize();
      return dir.multiplyScalar(radius);
    }

    function getGreatCirclePoint(t, startPos, endPos, peakAltitude) {
        // Linear interpolation of vectors + Normalize = Slerp approximation on sphere
        const base = startPos.clone().lerp(endPos, t).normalize();
        
        // Arc altitude: sin wave peaking at t=0.5
        // Basic altitude is 4 units (start/end) + peak
        // We assume startPos/endPos have radius ~104
        const radius = 100;
        const currentAlt = 0 + peakAltitude * Math.sin(t * Math.PI);
        
        return base.multiplyScalar(radius + 4 + currentAlt);
    }

    function getCameraTarget(startPos, endPos, t, globeRadius) {
      // Lock camera focus slightly AHEAD of the vehicle
      const lookT = Math.min(t + 0.015, 1);
      return getGreatCirclePoint(
        lookT,
        startPos,
        endPos,
        0 // NO altitude for target → stable
      );
    }

    function latLngToVector3(lat, lng, radius) {
      // Use ThreeGlobe's internal conversion to ensure alignment with the map
      // getCoords(lat, lng, altitude). Altitude is relative to radius (0 = surface).
      // We pass radius e.g. 104. Globe radius is 100.
      const altitude = (radius / 100) - 1;
      const coords = Globe.getCoords(lat, lng, altitude);
      return new THREE.Vector3(coords.x, coords.y, coords.z);
    }

    // --- CUSTOM PATH LINES ---
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffaa00, linewidth: 2 });
    const globeRadius = 100;
    
    // Global State for Arcs
    const ARC_DATA = [];

    for (let i = 0; i < CITIES.length - 1; i++) {
        const startCity = CITIES[i];
        const endCity = CITIES[i+1];
        
        const segmentVehicle = endCity.vehicle || 'plane';
        const isTrain = segmentVehicle === 'train';
        const isCar = segmentVehicle === 'car';

        if (isCar && endCity.pathGeometry) {
             // --- CAR PATH (Complex - Keep as Lines) ---
             // Lift slightly higher than car mesh (1.02 vs 1.01) to avoid Z-fighting and ensure visibility
             const pathPoints = endCity.pathGeometry;
             const roadAltitude = globeRadius * 1.02; 
             let points = [];
             pathPoints.forEach(p => {
                 const v = latLngToVector3(p[1], p[0], roadAltitude);
                 points.push(v);
             });
             const geometry = new THREE.BufferGeometry().setFromPoints(points);
             const line = new THREE.Line(geometry, lineMaterial);
             scene.add(line);
             
        } else {
             // --- PLANE / TRAIN (Arcs) ---
             // We use ThreeGlobe arcs for progressive animation
             ARC_DATA.push({
                 startLat: startCity.lat,
                 startLng: startCity.lng,
                 endLat: endCity.lat,
                 endLng: endCity.lng,
                 color: 'orange',
                 // Planes high (0.35 ~ 35km?), Trains low (0.01)
                 // Note: arcAltitude is relative to globe radius (1 = 1 radius high). 
                 // Our previous code used 35 units on 100 rad -> 0.35.
                 altitude: isTrain ? 0.01 : 0.35, 
                 stroke: 1.5,
                 gap: 1 // Start fully hidden
             });
        }
    }
    
    // Initial Load
    Globe.arcsData(ARC_DATA);
    
    // --- VEHICLE MARKERS ---
    const planeTex = new THREE.TextureLoader().load('${baseUrl}/assets/plane.svg');
    const trainTex = new THREE.TextureLoader().load('${baseUrl}/assets/train.svg');
    const carTex = new THREE.TextureLoader().load('${baseUrl}/assets/car.svg');

    const planeMat = new THREE.MeshBasicMaterial({ map: planeTex, transparent: true, side: THREE.DoubleSide });
    const trainMat = new THREE.MeshBasicMaterial({ map: trainTex, transparent: true, side: THREE.DoubleSide });
    const carMat = new THREE.MeshBasicMaterial({ map: carTex, transparent: true, side: THREE.DoubleSide });

    const planeMesh = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), planeMat);
    planeMesh.geometry.rotateX(-Math.PI / 2);
    planeMesh.geometry.rotateY(-Math.PI / 2); // Align Right-facing SVG to Forward (+Z)
    
    const trainMesh = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), trainMat);
    trainMesh.geometry.rotateX(-Math.PI / 2);
    trainMesh.geometry.rotateZ(Math.PI); // Train rotation

    const carMesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), carMat);
    carMesh.geometry.rotateX(-Math.PI / 2);
    // Car might need rotation
    carMesh.geometry.rotateZ(Math.PI); 

    // Group them
    const vehicleGroup = new THREE.Group();
    vehicleGroup.add(planeMesh);
    vehicleGroup.add(trainMesh);
    vehicleGroup.add(carMesh);
    scene.add(vehicleGroup);



    // --- RENDER FUNCTION ---
    let lastSegmentIndex = -1;

    window.renderFrame = async function(segmentIndex, localT, globalT) {
        // --- TIME MAPPING ---
        // Plane/Arc logic stays local (per segment)
        let travelT = localT;

        // Clamp travelT (safety)
        travelT = Math.min(Math.max(travelT, 0), 1);
        
        // --- SYNCED EASING ---
        // Apply smoothstep to travelT so Plane, Camera, and Arc all move in sync
        let easedTravelT = smoothstep(travelT);

        const startCity = CITIES[segmentIndex];
        const endCity = CITIES[segmentIndex + 1];
        
        const segmentVehicle = endCity.vehicle || 'plane';
        const isTrain = segmentVehicle === 'train';
        const isCar = segmentVehicle === 'car';
        
        // Toggle Meshes
        planeMesh.visible = !isTrain && !isCar;
        trainMesh.visible = isTrain;
        carMesh.visible = isCar;
        
        const globeRadius = Globe.getGlobeRadius() || 100; 
        const startPos = latLngToVector3(startCity.lat, startCity.lng, globeRadius + 4);
        const endPos = latLngToVector3(endCity.lat, endCity.lng, globeRadius + 4);
        
        // Path Altitude
        let altitudeScale = 1.35; // Plane default
        if (isTrain) altitudeScale = 1.05;
        if (isCar) altitudeScale = 1.01; // Closer to ground
        
        // Midpoint for Camera (High arc) and backup for path
        const midPoint = startPos.clone().add(endPos).multiplyScalar(0.5).normalize().multiplyScalar(globeRadius * altitudeScale);

        let pos, nextPos;

        if (isCar && endCity.pathGeometry) {
             // --- COMPLEX ROAD PATH ---
             const pathPoints = endCity.pathGeometry;
             // Use travelT instead of t
             const idx = Math.floor(travelT * (pathPoints.length - 1));
             const nextIdx = Math.min(idx + 1, pathPoints.length - 1);
             
             const p1 = pathPoints[idx];
             const p2 = pathPoints[nextIdx];
             
             // Interpolate
             const localT = (travelT * (pathPoints.length - 1)) - idx;
             
             const lng = p1[0] + (p2[0] - p1[0]) * localT;
             const lat = p1[1] + (p2[1] - p1[1]) * localT;
             
             pos = latLngToVector3(lat, lng, globeRadius * altitudeScale);
             
             // LookAt
             const lookLng = p2[0];
             const lookLat = p2[1];
             nextPos = latLngToVector3(lookLat, lookLng, globeRadius * altitudeScale);
             
             if (pos.distanceTo(nextPos) < 0.001 && idx > 0) {
                 const prev = pathPoints[idx-1];
                 nextPos = pos.clone().add(pos.clone().sub(latLngToVector3(prev[1], prev[0], globeRadius * altitudeScale)));
             }

        } else if (isTrain) {
             // --- TRAIN ---
             pos = getGreatCirclePoint(easedTravelT, startPos, endPos, 1);
             const nextT = Math.min(easedTravelT + 0.01, 1.0);
             nextPos = getGreatCirclePoint(nextT, startPos, endPos, 1);
             
        } else {
            // --- PLANE ---
            pos = getGreatCirclePoint(easedTravelT, startPos, endPos, 35);
            const nextT = easedTravelT + 0.01;
            nextPos = getGreatCirclePoint(nextT, startPos, endPos, 35);
        }

        vehicleGroup.position.copy(pos);
        
        // Stabilize orientation
        vehicleGroup.up.copy(pos).clone().normalize();
        vehicleGroup.lookAt(nextPos);
        
        // ---------------- CAMERA LOGIC ----------------

        // ---------------- CAMERA LOGIC ----------------

        // Camera phases over ENTIRE route (Global T)
        const CAM_GLOBE = 260; // Full globe (start & end ONLY)
        const CAM_MID   = 135; // Partial zoom-out (between cities)
        const CAM_NEAR  = 55;  // City focus

        const INTRO_END = 0.10;
        const OUTRO_START = 0.90;

        // --- CAMERA DISTANCE ---
        // 1. Calculate the "Flight" distance based on segment logic (Takeoff/Cruise/Landing)
        let flightDist;
        
        if (localT < 0.25) {
            // Takeoff: city → partial zoom-out
            const t = smoothstep(localT / 0.25);
            flightDist = lerp(CAM_NEAR, CAM_MID, t);

        } else if (localT > 0.75) {
            // Arrival: partial zoom-out → city
            const t = smoothstep((localT - 0.75) / 0.25);
            flightDist = lerp(CAM_MID, CAM_NEAR, t);

        } else {
            // Cruise: stay in partial zoom-out
            flightDist = CAM_MID;
        }

        // 2. Apply Global Intro/Outro Blending
        // This ensures NO SNAP, because we blend from Globe to whatever the current flightDist is.
        let camDist = flightDist;

        // INTRO – full globe → current flight view
        if (globalT < INTRO_END) {
          const t = smoothstep(globalT / INTRO_END);
          camDist = lerp(CAM_GLOBE, flightDist, t);

        // OUTRO – current flight view → full globe
        } else if (globalT > OUTRO_START) {
          const t = smoothstep((globalT - OUTRO_START) / (1 - OUTRO_START));
          camDist = lerp(flightDist, CAM_GLOBE, t);
        }

        // --- CAMERA POSITION ---
        // New Unified Rig: Camera follows SAME curve as vehicle
        const camPos = getGreatCirclePoint(
          smoothstep(localT),
          startPos,
          endPos,
          0 // camera rides sphere, altitude handled by camDist
        );

        camera.position.copy(
          camPos.normalize().multiplyScalar(globeRadius + camDist)
        );

        // --- CAMERA FOCUS ---
        // Always look at ONE stable target
        const camTarget = getCameraTarget(
          startPos,
          endPos,
          smoothstep(localT),
          globeRadius
        );

        camera.lookAt(camTarget);

        renderer.render(scene, camera);
        
        // Log progress occasionally
        if (segmentIndex === 0 && localT === 0) console.log("Initial camera set to Start City");
    };
    
    // Check when textures are ready
    window.ASSETS_READY = false;
    THREE.DefaultLoadingManager.onLoad = function ( ) {
        console.log("Values loaded");
        window.ASSETS_READY = true;
    };
  </script>
</body>
</html>
`);
  // 3. Smart Wait for assets
  try {
    await page.waitForFunction('window.ASSETS_READY === true', { timeout: 10000 });
    console.log("Assets loaded!");
  } catch (e) {
    console.log("Wait for assets timed out, proceeding anyway...");
  }

  // 4. Create Frames Directory
  const runId = Date.now().toString();
  const framesDir = path.join(os.tmpdir(), "frames", runId);
  if (!fs.existsSync(framesDir)) fs.mkdirSync(framesDir, { recursive: true });

  // 3. Render Loop
  console.log("Starting render loop...");

  // Calculate total frames
  const SEGMENTS = routeData.length - 1;
  const FRAMES_PER_SEGMENT = 105;
  const TOTAL_FRAMES = FRAMES_PER_SEGMENT * SEGMENTS;

  let frameCount = 0;


  try {
    for (let globalFrame = 0; globalFrame < TOTAL_FRAMES; globalFrame++) {
      // Calculate indices and time
      const segmentIndex = Math.floor(globalFrame / FRAMES_PER_SEGMENT);
      const localFrame = globalFrame % FRAMES_PER_SEGMENT;

      const localT = localFrame / (FRAMES_PER_SEGMENT - 1);
      const globalT = globalFrame / (TOTAL_FRAMES - 1);

      await page.evaluate(
        (segIdx, tLocal, tGlobal) => {
          window.renderFrame(segIdx, tLocal, tGlobal);
        },
        segmentIndex,
        localT,
        globalT
      );

      // Screenshot
      const buffer = await page.screenshot({ type: "jpeg", quality: 90 });

      // Write to file (matching original logic for stitching later)
      const padded = String(globalFrame).padStart(5, '0');
      const framePath = path.join(framesDir, `frame_${padded}.jpg`);
      await fs.promises.writeFile(framePath, buffer);

      // Log progress every 30 frames
      if (globalFrame % 30 === 0) {
        console.log(`Rendered frame ${globalFrame}/${TOTAL_FRAMES} (Seg ${segmentIndex})`);
      }
    }

  } catch (err) {
    console.error("Error generating frames:", err);
    await browser.close();
    throw err;
  }

  await browser.close();

  // 5. Stitch with FFMPEG
  console.log("Stitching video...");
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(path.join(framesDir, 'frame_%05d.jpg')) // Changed to .jpg
      .inputFPS(30)
      .output(outputPath)

      .videoCodec('libx264')
      .outputOptions('-pix_fmt yuv420p')
      .outputOptions('-preset ultrafast')
      .outputOptions('-threads 0') // Use all cores
      .on('end', () => {
        console.log('Video finished:', outputPath);
        // Cleanup frames
        fs.rm(framesDir, { recursive: true, force: true }, () => { });
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('FFmpeg error:', err);
        reject(err);
      })
      .run();
  });
}
