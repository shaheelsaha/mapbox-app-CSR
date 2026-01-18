import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
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
export async function renderVideo(routeData, outputPath, baseUrl) {
  console.log("Starting render for route:", routeData.map(c => c.name).join(" -> "));

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

  // 2. Inject Content (Same HTML/Three.js logic)
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
            window.ASSETS_READY = true;
            console.log("ALL ASSETS READY");
        }
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
      .labelDotRadius(0.8)
      .labelColor(() => 'rgba(255, 255, 255, 0.75)')
      .labelResolution(2)
      .onGlobeReady(() => {
          globeReady = true;
          checkReady();
      });

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
      
      const x = -radius * Math.sin(phi) * Math.cos(theta);
      const y = radius * Math.cos(phi);
      const z = radius * Math.sin(phi) * Math.sin(theta);

      return new THREE.Vector3(-z, y, x);
    }

    // --- CUSTOM PATH LINES ---
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffaa00, linewidth: 2 });
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
    const planeTexture = new THREE.TextureLoader().load('${baseUrl}/assets/plane.svg');
    const planeGeometry = new THREE.PlaneGeometry(5, 5);
    const planeMaterial = new THREE.MeshBasicMaterial({ 
        map: planeTexture, 
        transparent: true, 
        side: THREE.DoubleSide 
    });
    const plane = new THREE.Mesh(planeGeometry, planeMaterial);
    
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
        const midPoint = startPos.clone().add(endPos).multiplyScalar(0.5).normalize().multiplyScalar(globeRadius * 1.25);
        
        const pos = getQuadraticBezierPoint(t, startPos, midPoint, endPos);
        plane.position.copy(pos);
        
        const nextT = Math.min(t + 0.01, 1.0);
        const nextPos = getQuadraticBezierPoint(nextT, startPos, midPoint, endPos);
        
        const upVec = pos.clone().normalize();
        plane.up.copy(upVec);
        plane.lookAt(nextPos);

        const baseAlt = 20;   
        const peakAlt = 90;   
        const sinVal = Math.sin(t * Math.PI);
        const altitude = baseAlt + (peakAlt * sinVal);

        const cameraPos = pos.clone().normalize().multiplyScalar(globeRadius + altitude);
        camera.position.copy(cameraPos);
        camera.lookAt(pos);

        renderer.render(scene, camera);
    }
    
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
  const framesDir = path.join(__dirname, "frames", runId);
  if (!fs.existsSync(framesDir)) fs.mkdirSync(framesDir, { recursive: true });

  const FRAMES_THIS_SEGMENT = 60; // 2 seconds per segment
  let frameCount = 0;
  const writePromises = [];

  try {
    for (let i = 0; i < routeData.length - 1; i++) {
      for (let f = 0; f < FRAMES_THIS_SEGMENT; f++) {
        const t = f / (FRAMES_THIS_SEGMENT - 1);
        await page.evaluate((segIdx, time) => {
          return window.renderFrame && window.renderFrame(segIdx, time);
        }, i, t);

        const padded = String(frameCount).padStart(5, '0');
        const framePath = path.join(framesDir, `frame_${padded}.jpg`);

        // Capture buffer instead of writing directly
        const buffer = await page.screenshot({ type: 'jpeg', quality: 90 });

        // Write file asynchronously without blocking loop
        writePromises.push(fs.promises.writeFile(framePath, buffer));

        // Optional: throttle promises if too many pending (e.g. > 100) to avoid RAM spike
        if (writePromises.length > 50) {
          await Promise.all(writePromises.splice(0, 50));
        }

        frameCount++;
      }
    }
    // Wait for remaining writes
    await Promise.all(writePromises);

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
